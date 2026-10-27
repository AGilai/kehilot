"""Seating items under K#<k>: SEATLAY#<friday> (one layout version), SEATASG#<friday> (its assignments),
SEATHOLDER#<id> (a seat holder without an account: personal data, gabbai-only, never logged)."""
import time

from botocore.exceptions import ClientError

from .errors import ApiError
from .ids import new_id
from .schedule_rules import plain, stored


def _next(old):
    return max(int(time.time() * 1000), (old or 0) + 1)


class SeatingRepo:
    def _seat_get(self, k, sk):
        item = self.table.get_item(Key=self._key(k, sk), ConsistentRead=True).get('Item')
        return plain(item) if item else None

    def _guarded_put(self, k, sk, fields, guard, conflict):
        """Optimistic put: succeeds only when the stored updatedAt equals `guard` (None = nothing stored yet)."""
        current = self._seat_get(k, sk)
        old = current['updatedAt'] if current else None
        if guard != old:
            raise ApiError(409, conflict)
        new = _next(old)
        try:
            self.table.put_item(Item={**self._key(k, sk), **stored(fields), 'updatedAt': new},
                                ConditionExpression='attribute_not_exists(sk)' if old is None else 'updatedAt = :old',
                                **({} if old is None else {'ExpressionAttributeValues': {':old': old}}))
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            raise ApiError(409, conflict)
        return new, current

    # layouts
    def get_layout(self, k, friday):
        return self._seat_get(k, f'SEATLAY#{friday}')

    def list_layouts(self, k):
        return [plain(i) for i in self._query_prefix(k, 'SEATLAY#', consistent=True)]

    def earlier_layout(self, k, friday):
        before = [i for i in self.list_layouts(k) if i['sk'][len('SEATLAY#'):] < friday]
        return before[-1] if before else None

    def put_layout(self, k, friday, layout, seats, guard):
        new, _ = self._guarded_put(k, f'SEATLAY#{friday}', {**layout, 'seats': seats, 'effectiveFrom': friday},
                                   guard, 'layout_changed')
        return new

    def prune_assignments(self, k, friday, seat_ids):
        """Drop assignments of seats the layout no longer has (idempotent; reads filter the same way)."""
        item = self.get_assignments(k, friday)
        if not item:
            return
        keep = {s: r for s, r in item['assignments'].items() if s in seat_ids}
        if len(keep) != len(item['assignments']):
            self.table.update_item(Key=self._key(k, f'SEATASG#{friday}'), UpdateExpression='SET assignments = :a',
                                   ExpressionAttributeValues={':a': keep})

    # assignments
    def get_assignments(self, k, friday):
        return self._seat_get(k, f'SEATASG#{friday}')

    def list_assignments(self, k):
        return {i['sk'][len('SEATASG#'):]: plain(i) for i in self._query_prefix(k, 'SEATASG#', consistent=True)}

    def put_assignments(self, k, friday, assignments, guard):
        return self._guarded_put(k, f'SEATASG#{friday}', {'assignments': assignments}, guard, 'assignments_changed')[0]

    # holders
    def list_holders(self, k):
        return [plain(i) for i in self._query_prefix(k, 'SEATHOLDER#', consistent=True)]

    def get_holder(self, k, holder_id):
        return self._seat_get(k, f'SEATHOLDER#{holder_id}')

    def put_holder(self, k, holder_id, name, phone, created=None):
        now = int(time.time())
        item = {**self._key(k, f'SEATHOLDER#{holder_id}'), 'holderId': holder_id, 'name': name,
                'createdAt': created or now, 'updatedAt': now}
        if phone:
            item['phone'] = phone
        self.table.put_item(Item=item)
        return plain(item)

    def delete_holder(self, k, holder_id):
        """Remove the holder and every assignment of it, in every layout version."""
        ref = f'holder:{holder_id}'
        self.table.delete_item(Key=self._key(k, f'SEATHOLDER#{holder_id}'))
        for friday, item in self.list_assignments(k).items():
            kept = {s: r for s, r in item['assignments'].items() if r != ref}
            if len(kept) != len(item['assignments']):
                self.table.update_item(Key=self._key(k, f'SEATASG#{friday}'), UpdateExpression='SET assignments = :a',
                                       ExpressionAttributeValues={':a': kept})
