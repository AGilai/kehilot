"""Family items (K#<k> / F#<familyId>): one per member or gabbai household."""
import json
import logging
import time

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from .errors import ApiError
from . import tree_rules
from .ids import new_id

log = logging.getLogger(__name__)

REQUEST_TTL = 7 * 86400
DECLINE_TTL = 30 * 86400
MEMBER_ROLES = ('member', 'gabbai')


def _cancelled(error):
    """Per-item cancellation codes of a failed transaction, or None when the error is something else."""
    if error.response['Error']['Code'] != 'TransactionCanceledException':
        return None
    return [r.get('Code') for r in error.response.get('CancellationReasons', [])]


class FamiliesRepo:
    def get_family(self, k, family_id):
        return self.table.get_item(Key=self._key(k, f'F#{family_id}'), ConsistentRead=True).get('Item')

    def list_kehila_ids(self):
        """Every Kehila ID (a scan for META items: operator tools only)."""
        ids, kwargs = [], {}
        while True:
            page = self.table.scan(FilterExpression=Attr('sk').eq('META'), ProjectionExpression='pk', **kwargs)
            ids += [item['pk'][len('K#'):] for item in page['Items']]
            if 'LastEvaluatedKey' not in page:
                return ids
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def _ensure_family(self, k, user_id):
        """(familyId or None, created). None: a listener or no membership."""
        membership = self.get_membership(k, user_id)
        if not membership or membership.get('role') not in ('member', 'gabbai'):
            return None, False
        if membership.get('familyId'):
            held = self.get_family(k, membership['familyId'])
            if held and user_id in held['adults']:
                return membership['familyId'], False
            self._release_family_id(k, user_id, membership['familyId'])  # missing, or someone else's: start fresh
        family_id = new_id()
        family = {'pk': f'K#{k}', 'sk': f'F#{family_id}', 'familyId': family_id, 'adults': [user_id],
                  'children': [], 'version': 1, 'createdAt': int(time.time())}
        try:
            self._txn([
                {'Put': {'TableName': self.table.name, 'Item': family,
                         'ConditionExpression': 'attribute_not_exists(sk)'}},
                {'Update': {'TableName': self.table.name, 'Key': self._key(k, f'M#{user_id}'),
                            'UpdateExpression': 'SET familyId = :f',
                            'ConditionExpression': 'attribute_exists(sk) AND attribute_not_exists(familyId) '
                                                   'AND #r IN (:member, :gabbai)',
                            'ExpressionAttributeNames': {'#r': 'role'},
                            'ExpressionAttributeValues': {':f': family_id, ':member': 'member',
                                                          ':gabbai': 'gabbai'}}},
            ])
        except ClientError as error:
            if error.response['Error']['Code'] != 'TransactionCanceledException':
                raise
            current = self.get_membership(k, user_id)  # lost a race, became a listener, or left
            return (current or {}).get('familyId'), False
        return family_id, True

    def _release_family_id(self, k, user_id, family_id):
        """REMOVE the membership's familyId when it is still `family_id` (a lost race is fine)."""
        try:
            self.table.update_item(Key=self._key(k, f'M#{user_id}'), UpdateExpression='REMOVE familyId',
                                   ConditionExpression='familyId = :f',
                                   ExpressionAttributeValues={':f': family_id})
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise

    def ensure_family(self, k, user_id):
        """The familyId of a member or gabbai, creating a one-adult family when the membership has none.
        None for a listener or a missing membership. Idempotent."""
        return self._ensure_family(k, user_id)[0]

    def family_of(self, k, user_id):
        """The family item of the user's membership (never creates one), or None."""
        membership = self.get_membership(k, user_id)
        family_id = (membership or {}).get('familyId')
        family = self.get_family(k, family_id) if family_id else None
        return family if family and user_id in family['adults'] else None

    def live_adults(self, k, family):
        """Membership items of the family's adults that are still member or gabbai and still belong to this
        family (membership.familyId == familyId), in adult order (one batch_get). A departed adult (membership
        gone, a listener, or one who rejoined with another family) is left out."""
        found = self.batch_get([(f'K#{k}', f'M#{u}') for u in family['adults']])
        live = [found.get((f'K#{k}', f'M#{u}')) for u in family['adults']]
        return [m for m in live if m and m.get('role') in MEMBER_ROLES and m.get('familyId') == family['familyId']]

    def prune_family(self, k, family):
        """(family, live memberships): the family without its departed adults. The pruned list is written back
        (version check; a lost race is ignored, the next read prunes again). A family with no live adult is
        left alone."""
        live = self.live_adults(k, family)
        ids = [m['userId'] for m in live]
        if not ids or ids == list(family['adults']):
            return family, live
        try:
            family = self.table.update_item(
                Key=self._key(k, f'F#{family["familyId"]}'), UpdateExpression='SET adults = :a, version = :v1',
                ConditionExpression='version = :v',
                ExpressionAttributeValues={':a': ids, ':v': int(family['version']), ':v1': int(family['version']) + 1},
                ReturnValues='ALL_NEW')['Attributes']
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            return {**family, 'adults': ids}, live
        for user_id in ids:
            self.clear_family_notice(k, user_id)
        return family, live

    def clear_family_notice(self, k, user_id):
        try:
            self.table.update_item(Key=self._key(k, f'M#{user_id}'), UpdateExpression='REMOVE familyNotice',
                                   ConditionExpression='attribute_exists(sk)')
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise

    def set_family_notice(self, k, user_id, by_user, partner, now):
        self.table.update_item(Key=self._key(k, f'M#{user_id}'), UpdateExpression='SET familyNotice = :n',
                               ConditionExpression='attribute_exists(sk)',
                               ExpressionAttributeValues={':n': {'byUserId': by_user, 'partnerUserId': partner,
                                                                 'at': int(now)}})

    def list_families(self, k):
        return self._query_prefix(k, 'F#')

    def update_children(self, k, family_id, change):
        """Read the family, apply change(children) -> children, write with a version check. A lost race re-reads
        and re-applies (3 tries, then 409 try_again). `change` may raise ApiError. Returns the new item.
        Once the family has `people` the children are its `child` entries and are edited there."""
        for _ in range(3):
            family = self.get_family(k, family_id)
            if not family:
                raise ApiError(404, 'family_not_found')
            version = int(family['version'])
            if family.get('people') is not None:
                people = tree_rules.apply_children(tree_rules.people_of(family),
                                                   change(tree_rules.children_of(family)))
                expression, values = 'SET people = :c, version = :v1', {':c': people}
            else:
                expression, values = 'SET children = :c, version = :v1', {':c': change(list(family.get('children') or []))}
            try:
                return self.table.update_item(
                    Key=self._key(k, f'F#{family_id}'), UpdateExpression=expression,
                    ConditionExpression='version = :v', ExpressionAttributeValues={**values, ':v': version, ':v1': version + 1},
                    ReturnValues='ALL_NEW')['Attributes']
            except ClientError as error:
                if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                    raise
        raise ApiError(409, 'try_again')

    def update_people(self, k, family_id, change, if_version=None):
        """Like update_children for the family tree: change(people) -> people (derived from `children` when the
        family has no `people` yet). With `if_version` a different stored version is 409 version_conflict and a
        lost race is not retried. `people` replaces `children` (one source). Returns the new item."""
        for _ in range(1 if if_version is not None else 3):
            family = self.get_family(k, family_id)
            if not family:
                raise ApiError(404, 'family_not_found')
            version = int(family['version'])
            if if_version is not None and version != if_version:
                raise ApiError(409, 'version_conflict')
            people = change(tree_rules.people_of(family))
            try:
                return self.table.update_item(
                    Key=self._key(k, f'F#{family_id}'), UpdateExpression='SET people = :p, version = :v1 REMOVE children',
                    ConditionExpression='version = :v',
                    ExpressionAttributeValues={':p': people, ':v': version, ':v1': version + 1},
                    ReturnValues='ALL_NEW')['Attributes']
            except ClientError as error:
                if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                    raise
        raise ApiError(409, 'version_conflict' if if_version is not None else 'try_again')

    # link requests (PR# at the target, PS# at the sender, PD# decline cooldown)
    def put_link_request(self, k, from_user, to_user, now):
        """Record the request (PS# marker + PR# at the target) in one transaction; returns expiresAt.
        409 request_pending when the sender has a live pending request."""
        now = int(now)
        expires = now + REQUEST_TTL
        try:
            self._txn([
                {'Put': {'TableName': self.table.name,
                         'Item': {**self._key(k, f'PS#{from_user}'), 'toUserId': to_user, 'state': 'pending',
                                  'createdAt': now, 'expiresAt': expires},
                         'ConditionExpression': 'attribute_not_exists(sk) OR expiresAt <= :now OR #s = :declined',
                         'ExpressionAttributeNames': {'#s': 'state'},
                         'ExpressionAttributeValues': {':now': now, ':declined': 'declined'}}},
                {'Put': {'TableName': self.table.name,
                         'Item': {**self._key(k, f'PR#{to_user}#{from_user}'), 'fromUserId': from_user,
                                  'toUserId': to_user, 'createdAt': now, 'expiresAt': expires}}},
            ])
        except ClientError as error:
            codes = _cancelled(error)
            if codes is None:
                raise
            raise ApiError(409, 'request_pending' if 'ConditionalCheckFailed' in codes else 'try_again')
        return expires

    def live_request(self, k, to_user, from_user, now=None):
        item = self.table.get_item(Key=self._key(k, f'PR#{to_user}#{from_user}'), ConsistentRead=True).get('Item')
        return item if item and int(item['expiresAt']) > int(now if now is not None else time.time()) else None

    def received_requests(self, k, user_id, now):
        items = [i for i in self._query_prefix(k, f'PR#{user_id}#', consistent=True) if int(i['expiresAt']) > int(now)]
        return sorted(items, key=lambda i: (int(i['createdAt']), i['fromUserId']))

    def live_decline(self, k, from_user, to_user, now):
        item = self.table.get_item(Key=self._key(k, f'PD#{from_user}#{to_user}'), ConsistentRead=True).get('Item')
        return item if item and int(item['expiresAt']) > int(now) else None

    def decline_markers(self, k, from_user, now):
        return {i['sk'].split('#')[2]: i for i in self._query_prefix(k, f'PD#{from_user}#', consistent=True)
                if int(i['expiresAt']) > int(now)}

    def decline_request(self, k, to_user, from_user, now):
        """The target declines: the request goes, the sender's marker turns 'declined' and a 30-day cooldown
        starts. 404 request_not_found when the request is gone or expired."""
        now = int(now)
        try:
            self.table.delete_item(Key=self._key(k, f'PR#{to_user}#{from_user}'),
                                   ConditionExpression='attribute_exists(sk) AND expiresAt > :now',
                                   ExpressionAttributeValues={':now': now})
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            raise ApiError(404, 'request_not_found')
        try:  # keeps its expiresAt; absent (already cleaned) or pointing elsewhere: nothing to mark
            self.table.update_item(Key=self._key(k, f'PS#{from_user}'), UpdateExpression='SET #s = :declined',
                                   ConditionExpression='attribute_exists(sk) AND toUserId = :to',
                                   ExpressionAttributeNames={'#s': 'state'},
                                   ExpressionAttributeValues={':declined': 'declined', ':to': to_user})
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
        until = now + DECLINE_TTL
        self.table.put_item(Item={**self._key(k, f'PD#{from_user}#{to_user}'), 'until': until, 'expiresAt': until})

    def withdraw_request(self, k, from_user):
        """Delete the sender's marker and its request; fine when there is none."""
        marker = self.table.get_item(Key=self._key(k, f'PS#{from_user}'), ConsistentRead=True).get('Item')
        if not marker:
            return
        self.table.delete_item(Key=self._key(k, f'PR#{marker["toUserId"]}#{from_user}'))
        self.table.delete_item(Key=self._key(k, f'PS#{from_user}'))

    def clear_requests(self, k, user_id):
        """Drop every request to and from the user, their marker, and the markers of those who asked them."""
        for item in self._query_prefix(k, f'PR#{user_id}#', consistent=True):
            self.table.delete_item(Key=self._key(k, item['sk']))
            marker = self.table.get_item(Key=self._key(k, f'PS#{item["fromUserId"]}'), ConsistentRead=True).get('Item')
            if marker and marker.get('toUserId') == user_id:
                self.table.delete_item(Key=self._key(k, marker['sk']))
        for item in self._query_prefix(k, 'PR#', Attr('fromUserId').eq(user_id), consistent=True):
            self.table.delete_item(Key=self._key(k, item['sk']))
        self.table.delete_item(Key=self._key(k, f'PS#{user_id}'))

    # link / unlink
    def sweep_orphan_families(self, k, delete=True):
        """Families of Kehila k with no live adult (see live_adults). Deleted with a version check when `delete`.
        Returns how many there are (deleted ones, when `delete`)."""
        count = 0
        for family in self.list_families(k):
            if self.live_adults(k, family):
                continue
            if not delete:
                count += 1
                continue
            try:
                self.table.delete_item(Key=self._key(k, f'F#{family["familyId"]}'), ConditionExpression='version = :v',
                                       ExpressionAttributeValues={':v': int(family['version'])})
                count += 1
                self._seats_quietly(k, 'clear', family['familyId'])
            except ClientError as error:
                if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                    raise
        return count

    def _seats_quietly(self, k, what, *ids):
        """Seat assignments follow a family delete (clear) or merge (move); best effort after the family write,
        reads filter dead families anyway."""
        try:
            (self.clear_family_seats if what == 'clear' else self.move_family_seats)(k, *ids)
        except Exception as e:
            log.warning('family seats %s failed kehila=%s error=%s', what, k, type(e).__name__)

    def _week_quietly(self, k, old, new):
        """The weekly seat records (answers, requests) follow a merge; best effort like the seat move."""
        try:
            self.rename_week_ref(k, old, new)
        except Exception as e:
            log.warning('family week refs move failed kehila=%s error=%s', k, type(e).__name__)

    def _clear_quietly(self, k, users):
        for user in users:
            try:
                self.clear_requests(k, user)
            except Exception as e:
                log.warning('clear_requests failed kehila=%s error=%s', k, type(e).__name__)  # best effort: expiry cleans up

    def drop_adult(self, k, user_id):
        """The user left, was removed or deleted their account: take them out of their family (two adults:
        the other keeps the family and the children; one: the family goes), then drop every request to and from
        them and their decline markers. Idempotent; works when the membership is already gone."""
        membership = self.get_membership(k, user_id)
        if membership and membership.get('familyId'):
            family = self.get_family(k, membership['familyId'])
            families = [family] if family else []
        else:
            families = self._query_prefix(k, 'F#', Attr('adults').contains(user_id), consistent=True)
        for family in families:
            self._drop_from(k, family['familyId'], user_id)
            if membership and membership.get('familyId') == family['familyId']:  # the membership may outlive this
                self._release_family_id(k, user_id, family['familyId'])
        self.clear_requests(k, user_id)
        for item in self._query_prefix(k, 'PD#', consistent=True):
            parts = item['sk'].split('#')
            if user_id in parts[1:]:
                self.table.delete_item(Key=self._key(k, item['sk']))

    def _drop_from(self, k, family_id, user_id):
        for _ in range(3):
            family = self.get_family(k, family_id)
            if not family or user_id not in family['adults']:
                return
            others = [a for a in family['adults'] if a != user_id]
            try:
                if others:
                    values = {':a': others, ':v': int(family['version']), ':v1': int(family['version']) + 1}
                    expression = 'SET adults = :a, version = :v1'
                    if family.get('people') is not None:  # the remaining adult keeps their own figure and lineage
                        values[':p'] = tree_rules.split_people(tree_rules.people_of(family), user_id, others[0])[1]
                        expression += ', people = :p'
                    self.table.update_item(Key=self._key(k, f'F#{family_id}'), UpdateExpression=expression,
                                           ConditionExpression='version = :v', ExpressionAttributeValues=values)
                    for other in others:
                        self.clear_family_notice(k, other)
                else:
                    self.table.delete_item(Key=self._key(k, f'F#{family_id}'), ConditionExpression='version = :v',
                                           ExpressionAttributeValues={':v': int(family['version'])})
                    self._seats_quietly(k, 'clear', family_id)
                return
            except ClientError as error:
                if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                    raise
        raise ApiError(409, 'try_again')

    def link(self, k, keep_user, move_user, request_from=None):
        """Merge move_user's one-adult family into keep_user's. Returns the kept familyId.
        `request_from` (the sender whose request to keep_user is being confirmed) must still be live and is
        consumed in the same transaction."""
        for attempt in range(2):
            now = int(time.time())
            if request_from and not self.live_request(k, keep_user, request_from, now):
                raise ApiError(404, 'request_not_found')
            keep_id, move_id = self.ensure_family(k, keep_user), self.ensure_family(k, move_user)
            if not keep_id or not move_id:
                raise ApiError(404 if request_from else 400, 'request_not_found' if request_from else 'invalid_user_ids')
            keep, moved = self.get_family(k, keep_id), self.get_family(k, move_id)
            if not keep or not moved:
                raise ApiError(404, 'family_not_found')
            keep, moved = self.prune_family(k, keep)[0], self.prune_family(k, moved)[0]
            if keep_id == move_id or len(keep['adults']) != 1:
                raise ApiError(409, 'already_linked')
            if len(moved['adults']) != 1:
                raise ApiError(409, 'partner_taken')
            table = self.table.name
            member_roles = {':member': 'member', ':gabbai': 'gabbai'}
            kp, mp = tree_rules.people_of(keep), tree_rules.people_of(moved)
            if keep.get('people') is not None or moved.get('people') is not None:
                merged = ('people', tree_rules.merge_people(kp, mp, keep_user, move_user))
                if len(json.dumps(merged[1], ensure_ascii=False).encode('utf-8')) > tree_rules.MAX_TREE_BYTES:
                    log.warning('merged tree over the size limit kehila=%s people=%d', k, len(merged[1]))
            else:
                merged = ('children', list(keep.get('children') or []) + list(moved.get('children') or []))
            items = [
                {'Update': {'TableName': table, 'Key': self._key(k, f'F#{keep_id}'),
                            'UpdateExpression': f'SET adults = :both, {merged[0]} = :merged, version = :v1'
                                                + (' REMOVE children' if merged[0] == 'people' else ''),
                            'ConditionExpression': 'version = :v',
                            'ExpressionAttributeValues': {
                                ':both': list(keep['adults']) + list(moved['adults']), ':merged': merged[1],
                                ':v': int(keep['version']), ':v1': int(keep['version']) + 1}}},
                {'Delete': {'TableName': table, 'Key': self._key(k, f'F#{move_id}'),
                            'ConditionExpression': 'version = :v',
                            'ExpressionAttributeValues': {':v': int(moved['version'])}}},
                {'Update': {'TableName': table, 'Key': self._key(k, f'M#{move_user}'),
                            'UpdateExpression': 'SET familyId = :keep',
                            'ConditionExpression': 'familyId = :moved AND #r IN (:member, :gabbai)',
                            'ExpressionAttributeNames': {'#r': 'role'},
                            'ExpressionAttributeValues': {':keep': keep_id, ':moved': move_id, **member_roles}}},
                {'ConditionCheck': {'TableName': table, 'Key': self._key(k, f'M#{keep_user}'),
                                    'ConditionExpression': 'familyId = :keep AND #r IN (:member, :gabbai)',
                                    'ExpressionAttributeNames': {'#r': 'role'},
                                    'ExpressionAttributeValues': {':keep': keep_id, **member_roles}}},
            ]
            if request_from:
                items += [
                    {'Delete': {'TableName': table, 'Key': self._key(k, f'PR#{keep_user}#{request_from}'),
                                'ConditionExpression': 'attribute_exists(sk) AND expiresAt > :now',
                                'ExpressionAttributeValues': {':now': now}}},
                    {'Delete': {'TableName': table, 'Key': self._key(k, f'PS#{request_from}')}},
                ]
            try:
                self._txn(items)
            except ClientError as error:
                codes = _cancelled(error)
                if codes is None:
                    raise
                if request_from and len(codes) > 4 and codes[4] == 'ConditionalCheckFailed':
                    raise ApiError(404, 'request_not_found')
                continue  # re-read once: a changed family maps to its own code, otherwise try_again
            self._clear_quietly(k, (keep_user, move_user))
            self._seats_quietly(k, 'move', move_id, keep_id)
            self._week_quietly(k, f'family:{move_id}', f'family:{keep_id}')
            return keep_id
        raise ApiError(409, 'try_again')

    def unlink(self, k, user_id):
        """Split the user off a two-adult family into a new family with a copy of the children; the old family
        (and its blessings) stays with the other adult. Returns the new familyId."""
        for _ in range(2):
            family = self.family_of(k, user_id)
            if not family or len(family['adults']) != 2 or user_id not in family['adults']:
                raise ApiError(409, 'not_linked')
            if len(self.live_adults(k, family)) != 2:  # the partner is gone: prune, nothing to unlink
                self.prune_family(k, family)
                raise ApiError(409, 'not_linked')
            old_id, new_id_ = family['familyId'], new_id()
            table = self.table.name
            other = next(a for a in family['adults'] if a != user_id)
            if family.get('people') is not None:
                leaver_people, other_people = tree_rules.split_people(tree_rules.people_of(family), user_id, other)
                copied = {'people': leaver_people}
            else:
                copied, other_people = {'children': list(family.get('children') or [])}, None
            try:
                self._txn([
                    {'Put': {'TableName': table, 'ConditionExpression': 'attribute_not_exists(sk)',
                             'Item': {'pk': f'K#{k}', 'sk': f'F#{new_id_}', 'familyId': new_id_,
                                      'adults': [user_id], **copied,
                                      'version': 1, 'createdAt': int(time.time())}}},
                    {'Update': {'TableName': table, 'Key': self._key(k, f'F#{old_id}'),
                                'UpdateExpression': 'SET adults = :other, version = :v1'
                                                    + (', people = :p' if other_people is not None else ''),
                                'ConditionExpression': 'version = :v',
                                'ExpressionAttributeValues': {':other': [other], ':v': int(family['version']),
                                                              ':v1': int(family['version']) + 1,
                                                              **({':p': other_people} if other_people is not None else {})}}},
                    {'Update': {'TableName': table, 'Key': self._key(k, f'M#{user_id}'),
                                'UpdateExpression': 'SET familyId = :new REMOVE familyNotice',
                                'ConditionExpression': 'familyId = :old',
                                'ExpressionAttributeValues': {':new': new_id_, ':old': old_id}}},
                    {'Update': {'TableName': table, 'Key': self._key(k, f'M#{other}'),
                                'UpdateExpression': 'REMOVE familyNotice',
                                'ConditionExpression': 'attribute_exists(sk)'}},
                ])
            except ClientError as error:
                if _cancelled(error) is None:
                    raise
                continue
            return new_id_
        raise ApiError(409, 'try_again')
