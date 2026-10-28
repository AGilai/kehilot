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
        if old_updated is None:
            self.table.put_item(Item=item)
        else:  # an update never resurrects a holder that was deleted or linked meanwhile
            try:
                self.table.put_item(Item=item, ConditionExpression='attribute_exists(sk)')
            except ClientError as error:
                if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                    raise
                raise ApiError(404, 'holder_not_found')
        return plain(item)

    def delete_holder(self, k, holder_id):
        """Remove the holder and every assignment of it, in every layout version."""
        ref = f'holder:{holder_id}'
        self._rewrite_assignments(k, lambda a: {s: r for s, r in a.items() if r != ref})
        self.table.delete_item(Key=self._key(k, f'SEATHOLDER#{holder_id}'))  # last: a retry still finds it

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
        try:
            self.table.update_item(
                Key=self._key(k, f'M#{user_id}'),
                UpdateExpression='SET seatLinkAt = :at ADD seatLinkSeats :n, seatLinkHolders :h',
                ConditionExpression='attribute_exists(sk) AND NOT contains(seatLinkHolders, :id)',
                ExpressionAttributeValues={':at': now, ':n': seats, ':h': {holder_id}, ':id': holder_id})
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise  # a missing member or an already counted holder: nothing to add

    def clear_seat_link_notice(self, k, user_id):
        try:
            self.table.update_item(Key=self._key(k, f'M#{user_id}'),
                                   UpdateExpression='REMOVE seatLinkSeats, seatLinkAt, seatLinkHolders',
                                   ConditionExpression='attribute_exists(sk)')
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise

    # auto-link records (gabbai notice, undo snapshot, tombstone), SEATAUTO#<holderId>; expiresAt is the table TTL
    def put_auto_link(self, k, holder_id, fields):
        """False when a record for the holder exists already (pending, done or undone: all of them gate a re-run)."""
        try:
            self.table.put_item(Item={**self._key(k, f'SEATAUTO#{holder_id}'), **stored(fields), 'holderId': holder_id},
                                ConditionExpression='attribute_not_exists(sk)')
            return True
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            return False

    def update_auto_link(self, k, holder_id, fields, if_state=None):
        """False when `if_state` is given and the record is no longer in that state (a cancel won the race)."""
        names = {f'#f{i}': key for i, key in enumerate(fields)}
        values = {f':v{i}': v for i, v in enumerate(stored(fields).values())}
        if if_state:
            names['#st'], values[':st'] = 'state', if_state
        try:
            self.table.update_item(Key=self._key(k, f'SEATAUTO#{holder_id}'),
                                   UpdateExpression='SET ' + ', '.join(f'#f{i} = :v{i}' for i in range(len(fields))),
                                   ExpressionAttributeNames=names, ExpressionAttributeValues=values,
                                   ConditionExpression='attribute_exists(sk)' + (' AND #st = :st' if if_state else ''))
            return True
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException' or not if_state:
                raise
            return False

    def put_auto_tombstone(self, k, holder_id, family_id):
        """The gabbai said 'not them': no names, no TTL, so nothing re-links the holder when the record expires."""
        self.table.put_item(Item={**self._key(k, f'SEATNOAUTO#{holder_id}'), 'holderId': holder_id, 'familyId': family_id})

    def has_auto_tombstone(self, k, holder_id):
        return self._seat_get(k, f'SEATNOAUTO#{holder_id}') is not None

    def get_auto_link(self, k, holder_id):
        return self._seat_get(k, f'SEATAUTO#{holder_id}')

    def list_auto_links(self, k):
        return [plain(i) for i in self._query_prefix(k, 'SEATAUTO#', consistent=True)]

    def week_snapshots(self, k, old, new):
        """{'<friday>#<prayer>': {seats: [seat ids whose record names `old`], req, ans, famReq, famAns}} for the weeks that
        mention `old`: what rename_week_ref(old -> new) is about to merge, so an undo can split it again."""
        out = {}
        for raw in self._query_prefix(k, 'SEATWK#', consistent=True):
            item = plain(raw)
            seats = sorted(s for s, v in (item.get('seats') or {}).items() if isinstance(v, dict) and v.get('h') == old)
            reqs, ans = item.get('requests') or {}, item.get('answered') or {}
            if not seats and old not in reqs and old not in ans:
                continue
            out['#'.join(item['sk'].split('#')[1:])] = {'seats': seats, 'req': reqs.get(old), 'ans': ans.get(old),
                                                        'famReq': reqs.get(new), 'famAns': ans.get(new)}
        return out

    def restore_week_ref(self, k, old, new, snapshots):
        """Undo of rename_week_ref for the snapshotted seats/entries only; anything changed since is left alone."""
        for key, snap in snapshots.items():
            friday, prayer = key.split('#')

            def restored(item, snap=snap):
                if not item:
                    return {}
                fields = {key: v for key, v in item.items() if key not in ('pk', 'sk', 'updatedAt')}
                seats = dict(item.get('seats') or {})
                for s in snap['seats']:
                    v = seats.get(s)
                    if isinstance(v, dict) and v.get('h') == new:
                        seats[s] = {**v, 'h': old}
                reqs, ans = dict(item.get('requests') or {}), dict(item.get('answered') or {})
                if snap['req'] is not None:
                    merged = {**snap['req'], **(snap['famReq'] or {})}
                    reqs[old] = snap['req']
                    if reqs.get(new) == merged:
                        reqs.pop(new, None) if snap['famReq'] is None else reqs.__setitem__(new, snap['famReq'])
                if snap['ans'] is not None:
                    ans[old] = snap['ans']
                    if ans.get(new) == max(snap['ans'], snap['famAns'] or 0):
                        ans.pop(new, None) if snap['famAns'] is None else ans.__setitem__(new, snap['famAns'])
                fields.update(seats=seats, requests=reqs)
                if ans or 'answered' in item:
                    fields['answered'] = ans
                return fields
            current = self.get_week(k, friday, prayer)
            if current is not None and restored(current) != {key: v for key, v in current.items() if key not in ('pk', 'sk', 'updatedAt')}:
                self.change_week(k, friday, prayer, restored)

    def drop_seat_link_holder(self, k, user_id, holder_id, seats):
        """Undo of add_seat_link_notice for one holder: its seats leave the Home card, and the card goes with the last one."""
        item = self.table.get_item(Key=self._key(k, f'M#{user_id}'), ConsistentRead=True).get('Item')
        held = set((item or {}).get('seatLinkHolders') or ())
        if holder_id not in held:
            return
        if held == {holder_id}:
            return self.clear_seat_link_notice(k, user_id)
        try:
            self.table.update_item(
                Key=self._key(k, f'M#{user_id}'), UpdateExpression='DELETE seatLinkHolders :h SET seatLinkSeats = :n',
                ConditionExpression='attribute_exists(sk) AND contains(seatLinkHolders, :id)',
                ExpressionAttributeValues={':h': {holder_id}, ':id': holder_id,
                                           ':n': max(0, int(item.get('seatLinkSeats') or 0) - seats)})
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise

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
                if isinstance(v, list) and len(v) > 3 and v[3] == old:  # compact undo entry
                    return v[:3] + [new]
                return {**v, 'h': new} if isinstance(v, dict) and v.get('h') == old else v
            seats = {s: seat(v) for s, v in (item.get('seats') or {}).items()}
            reqs = dict(item.get('requests') or {})
            if old in reqs:
                mine = reqs.pop(old)
                reqs[new] = {**mine, **reqs.get(new, {})}
            fields = {key: v for key, v in item.items() if key not in ('pk', 'sk', 'updatedAt')}
            fields.update(seats=seats, requests=reqs)
            if old in (item.get('answered') or {}):
                ans = dict(item['answered'])
                at = ans.pop(old)
                ans[new] = max(at, ans.get(new, 0))
                fields['answered'] = ans
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
