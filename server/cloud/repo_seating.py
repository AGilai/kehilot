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

    def put_holder(self, k, holder_id, name, phone, created=None, old_updated=None):
        now = int(time.time())
        item = {**self._key(k, f'SEATHOLDER#{holder_id}'), 'holderId': holder_id, 'name': name,
                'createdAt': created or now, 'updatedAt': _next(old_updated)}
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
            else:
                raise ApiError(409, 'try_again')

    def clear_family_seats(self, k, family_id):
        """A family is gone: free its seats in every layout version."""
        ref = f'family:{family_id}'
        self._rewrite_assignments(k, lambda a: {s: r for s, r in a.items() if r != ref})

    def move_family_seats(self, k, from_id, to_id):
        """Two families merged: the seats of `from_id` go to `to_id` in every layout version."""
        old, new = f'family:{from_id}', f'family:{to_id}'
        self._rewrite_assignments(k, lambda a: {s: (new if r == old else r) for s, r in a.items()})

    def move_holder_seats(self, k, holder_id, family_id):
        """A holder is linked to a family: its seats go to the family in every version (union with its own)."""
        old, new = f'holder:{holder_id}', f'family:{family_id}'
        self._rewrite_assignments(k, lambda a: {s: (new if r == old else r) for s, r in a.items()})

    def add_seat_link_notice(self, k, user_id, holder_id, seats, now):
        """One-time Home card for an adult: seats that came to the family from linked holders. Idempotent per holder
        (a retried link does not count twice); several links before it is dismissed add up."""
        member = self.get_membership(k, user_id)
        if not member:
            return
        old = member.get('seatLinkNotice') or {}
        linked = list(old.get('linked') or [])
        if holder_id in linked:
            return
        self.table.update_item(Key=self._key(k, f'M#{user_id}'), UpdateExpression='SET seatLinkNotice = :n',
                               ConditionExpression='attribute_exists(sk)',
                               ExpressionAttributeValues={':n': {'seats': int(old.get('seats', 0)) + seats,
                                                                 'at': now, 'linked': linked + [holder_id]}})

    def clear_seat_link_notice(self, k, user_id):
        self.table.update_item(Key=self._key(k, f'M#{user_id}'), UpdateExpression='REMOVE seatLinkNotice')

    def holder_ref_left(self, k, holder_id):
        """True while any layout version still assigns a seat to the holder."""
        ref = f'holder:{holder_id}'
        return any(ref in item['assignments'].values() for item in self.list_assignments(k).values())

    def delete_holder_record(self, k, holder_id):
        """Only the holder item: its seats were moved already (delete_holder would free them)."""
        self.table.delete_item(Key=self._key(k, f'SEATHOLDER#{holder_id}'))

    def rename_week_ref(self, k, old, new):
        """Weekly records of every week: the holder ref `old` becomes `new` in seat records (`h`), requests and the
        undo data, so answers carry over. Records that do not mention it are not written."""
        def renamed(item):
            def seat(v):
                return {**v, 'h': new} if isinstance(v, dict) and v.get('h') == old else v
            seats = {s: seat(v) for s, v in (item.get('seats') or {}).items()}
            reqs = dict(item.get('requests') or {})
            if old in reqs:
                mine = reqs.pop(old)
                reqs[new] = {**mine, **reqs.get(new, {})}
            fields = {key: v for key, v in item.items() if key not in ('pk', 'sk', 'updatedAt')}
            fields.update(seats=seats, requests=reqs)
            undo = item.get('undo')
            if undo:
                ureq = dict(undo.get('requests') or {})
                if old in ureq:
                    ureq.setdefault(new, ureq.pop(old))
                    ureq.pop(old, None)
                fields['undo'] = {**undo, 'seats': {s: seat(v) for s, v in (undo.get('seats') or {}).items()},
                                  'requests': ureq}
            return fields

        for raw in self._query_prefix(k, 'SEATWK#', consistent=True):
            item = plain(raw)
            if renamed(item) == {key: v for key, v in item.items() if key not in ('pk', 'sk', 'updatedAt')}:
                continue
            _, friday, prayer = item['sk'].split('#')
            self.change_week(k, friday, prayer, lambda fresh: renamed(fresh) if fresh else {})

    # weekly state: SEATWK#<friday>#<prayer> {seats: {seatId: {r, by, at}}, requests: {household: {area: n}}, undo?}
    def get_week(self, k, friday, prayer):
        return self._seat_get(k, f'SEATWK#{friday}#{prayer}')

    def put_week(self, k, friday, prayer, fields, guard):
        return self._guarded_put(k, f'SEATWK#{friday}#{prayer}', fields, guard, 'week_changed')[0]

    def change_week(self, k, friday, prayer, change):
        """Read, change(item or None) -> fields, guarded write; retried when someone saved meanwhile."""
        for _ in range(6):
            item = self.get_week(k, friday, prayer)
            fields = change(item)
            try:
                return self.put_week(k, friday, prayer, fields, item['updatedAt'] if item else None)
            except ApiError as error:
                if error.code != 'week_changed':
                    raise
        raise ApiError(409, 'week_changed')

    def layout_for(self, k, friday):
        """The latest layout version taking effect on or before that Friday, or None."""
        found = [i for i in self.list_layouts(k) if i['effectiveFrom'] <= friday]
        return max(found, key=lambda i: i['effectiveFrom']) if found else None
