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

    def put_layout(self, k, friday, layout, seats, guard):
        new, _ = self._guarded_put(k, f'SEATLAY#{friday}', {**layout, 'seats': seats, 'effectiveFrom': friday},
                                   guard, 'layout_changed')
        return new

    def prune_assignments(self, k, friday, seat_ids):
        """Drop assignments of seats the layout no longer has, as a guarded write that bumps updatedAt (so a
        stale assignment save conflicts). Idempotent; reads filter the same way."""
        for _ in range(4):
            item = self.get_assignments(k, friday)
            if not item:
                return
            keep = {s: r for s, r in item['assignments'].items() if s in seat_ids}
            if len(keep) == len(item['assignments']):
                return
            try:
                self.put_assignments(k, friday, keep, item['updatedAt'])
                return
            except ApiError:
                continue  # someone saved meanwhile: read again

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
        self._rewrite_assignments(k, lambda a: {s: r for s, r in a.items() if r != ref})

    def _rewrite_assignments(self, k, change):
        """Apply change(assignments) -> assignments to every version's item that it alters; guarded, retried."""
        for friday in self.list_assignments(k):
            for _ in range(4):
                item = self.get_assignments(k, friday)
                if not item:
                    break
                new = change(item['assignments'])
                if new == item['assignments']:
                    break
                try:
                    self.put_assignments(k, friday, new, item['updatedAt'])
                    break
                except ApiError:
                    continue

    def clear_family_seats(self, k, family_id):
        """A family is gone: free its seats in every layout version."""
        ref = f'family:{family_id}'
        self._rewrite_assignments(k, lambda a: {s: r for s, r in a.items() if r != ref})

    def move_family_seats(self, k, from_id, to_id):
        """Two families merged: the seats of `from_id` go to `to_id` in every layout version."""
        old, new = f'family:{from_id}', f'family:{to_id}'
        self._rewrite_assignments(k, lambda a: {s: (new if r == old else r) for s, r in a.items()})
