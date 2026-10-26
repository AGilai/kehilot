"""Profiles and push devices: per-user data, not scoped to a Kehila."""
import secrets
import time
from datetime import datetime, timezone

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from .errors import ApiError
from .ids import new_id

CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
INVITE_CODE_LENGTH = 10
_CODE_FIXES = str.maketrans({'I': '1', 'L': '1', 'O': '0'})
DEFAULT_SETTINGS = {'pollSeconds': 30, 'memberBroadcastDefault': False, 'broadcastDailyLimit': 3,
                    'defaultLang': 'he'}
DEFAULT_CHANNELS = (  # (name, listenersCanRead, postPolicy)
    ('announcements', True, 'management'),
    ('simchas', False, 'broadcasters'),
    ('condolences', False, 'broadcasters'),
)


def normalize_code(code):
    """Crockford: case-insensitive, I/L read as 1, O as 0."""
    return code.strip().upper().translate(_CODE_FIXES)


class MembersRepo:
    def get_profile(self, user_id):
        item = self._get(f'U#{user_id}', 'PROFILE')
        return {'firstName': item['firstName'], 'lastName': item['lastName'], 'lang': item['lang']} if item else None

    def put_profile(self, user_id, first, last, lang):
        self.table.put_item(Item={'pk': f'U#{user_id}', 'sk': 'PROFILE',
                                  'firstName': first, 'lastName': last, 'lang': lang})

    def put_profile_if_absent(self, user_id, first, last, lang):
        """Never overwrites a profile the person already saved."""
        try:
            self.table.put_item(Item={'pk': f'U#{user_id}', 'sk': 'PROFILE', 'firstName': first,
                                      'lastName': last, 'lang': lang},
                                ConditionExpression='attribute_not_exists(pk)')
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise

    def import_membership(self, k, user_id, display_name, role, classification, broadcast_default):
        """Gabbai's list import. Returns 'added' (new membership), 'upgraded' (a listener becomes member or
        gabbai and the pending request goes, one transaction) or 'exists' (anything else is left as it is)."""
        can_broadcast = bool(broadcast_default) if role == 'member' else False
        membership = {'pk': f'K#{k}', 'sk': f'M#{user_id}', 'gsi1pk': f'U#{user_id}', 'gsi1sk': f'K#{k}',
                      'kehilaId': k, 'userId': user_id, 'role': role, 'classification': classification,
                      'canBroadcast': can_broadcast, 'notify': {}, 'displayName': display_name}
        try:
            self.table.put_item(Item=membership, ConditionExpression='attribute_not_exists(sk)',
                                ReturnValuesOnConditionCheckFailure='ALL_OLD')
            return 'added'
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            existing = error.response.get('Item', {}).get('role', {}).get('S')
        if existing != 'listener' or role == 'listener':
            return 'exists'
        upgrade = {'Update': {'TableName': self.table.name, 'Key': {'pk': f'K#{k}', 'sk': f'M#{user_id}'},
                              'UpdateExpression': 'SET #r = :role, classification = :c, canBroadcast = :b',
                              'ConditionExpression': '#r = :listener',
                              'ExpressionAttributeNames': {'#r': 'role'},
                              'ExpressionAttributeValues': {':role': role, ':listener': 'listener',
                                                            ':c': classification, ':b': can_broadcast}}}
        drop_request = {'Delete': {'TableName': self.table.name, 'Key': {'pk': f'K#{k}', 'sk': f'REQ#{user_id}'}}}
        try:
            self.table.meta.client.transact_write_items(TransactItems=[upgrade, drop_request])
        except ClientError as error:
            reasons = _cancel_reasons(error, 2)
            if reasons[0] == 'ConditionalCheckFailed':
                return 'exists'  # changed meanwhile: not a listener any more
            raise ApiError(409, 'try_again')
        return 'upgraded'

    def put_device(self, user_id, token, platform):
        # A device token belongs to one user: whoever registered it last owns it.
        page = self.table.query(IndexName='gsi1', KeyConditionExpression=Key('gsi1pk').eq(f'TOK#{token}'))
        for item in page['Items']:
            if item['pk'] != f'U#{user_id}':
                self.table.delete_item(Key={'pk': item['pk'], 'sk': item['sk']})
        self.table.put_item(Item={'pk': f'U#{user_id}', 'sk': f'D#{token}', 'gsi1pk': f'TOK#{token}',
                                  'gsi1sk': f'U#{user_id}', 'token': token, 'platform': platform,
                                  'lastSeen': datetime.now(timezone.utc).isoformat()})

    def delete_device(self, user_id, token):
        self.table.delete_item(Key={'pk': f'U#{user_id}', 'sk': f'D#{token}'})

    def put_push_ticket(self, ticket_id, token, user_id, expires_at):
        self.table.put_item(Item={'pk': 'PUSHTKT', 'sk': f'T#{ticket_id}', 'token': token, 'userId': user_id,
                                  'expiresAt': expires_at})

    def list_push_tickets(self):
        """Every PUSHTKT item (tickets live one day, so the partition stays small)."""
        items, kwargs = [], {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq('PUSHTKT'), ConsistentRead=True, **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return items
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def delete_push_ticket(self, ticket_sk):
        self.table.delete_item(Key={'pk': 'PUSHTKT', 'sk': ticket_sk})

    def purge_user(self, user_id, sub):
        """Remove everything of the user. Idempotent: a retry after a partial failure finishes the job.

        Cost: one consistent Scan of the whole table (O(table size), paginated at 1 MB) with a filter. That is
        the simplest correct way to find Join (J#) and reply-marker (RP#) items, Kehila memberships the user
        already left and anything else carrying the ID in a key, without an index item per join. Acceptable
        at current scale and for a rare operation; revisit with an index item if the table grows large.

        Deletes every item with the userId or the sub in pk/sk/gsi1pk/gsi1sk, plus push tickets of the user;
        blanks authorName on messages and replies the user wrote and targetName on messages aimed at them.
        joinCount and replierCount stay unchanged (historic counts). The U#<sub> mapping goes last and is replaced by a
        tombstone {deleted, expiresAt +1 day}: until then a retry resolves to the same userId, afterwards the
        resolver answers 401 account_deleted instead of creating a new account.
        """
        from boto3.dynamodb.conditions import Attr
        key_fields = ('pk', 'sk', 'gsi1pk', 'gsi1sk')
        condition = Attr('userId').eq(user_id) | Attr('authorId').eq(user_id) | Attr('targetMemberId').eq(user_id)
        for needle in (user_id, sub):
            for field in key_fields:
                condition = condition | Attr(field).contains(needle)
        sub_key = {'pk': f'U#{sub}', 'sk': 'SUB'}
        kwargs = {'FilterExpression': condition, 'ConsistentRead': True}
        deleted = blanked = 0
        with self.table.batch_writer() as batch:  # 25 keys per request; flushed when the block exits
            while True:
                page = self.table.scan(**kwargs)
                for item in page['Items']:
                    key = {'pk': item['pk'], 'sk': item['sk']}
                    if key == sub_key:
                        continue
                    if any(needle in item.get(field, '') for needle in (user_id, sub) for field in key_fields) \
                            or item.get('userId') == user_id:
                        batch.delete_item(Key=key)
                        deleted += 1
                        continue
                    sets = []
                    if item.get('authorId') == user_id and 'authorName' in item:
                        sets.append('authorName = :empty')
                    if item.get('targetMemberId') == user_id and 'targetName' in item:
                        sets.append('targetName = :empty')
                    if sets:
                        self.table.update_item(Key=key, UpdateExpression='SET ' + ', '.join(sets),
                                               ExpressionAttributeValues={':empty': ''})
                        blanked += 1
                if 'LastEvaluatedKey' not in page:
                    break
                kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']
        # tombstone, not a delete: a token that is still valid must not recreate the account (TTL removes it)
        self.table.put_item(Item={**sub_key, 'deleted': True, 'expiresAt': int(time.time()) + 86400})
        return deleted, blanked

    def list_devices(self, user_id):
        items, kwargs = [], {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq(f'U#{user_id}') & Key('sk').begins_with('D#'),
                                    **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return [{'token': i['token'], 'platform': i['platform'], 'lastSeen': i['lastSeen']} for i in items]
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def create_kehila(self, name, settings):
        """Write the Kehila and its three default channels; `settings` overrides the defaults."""
        k = new_id()
        self.put_kehila(k, name)
        self.table.update_item(Key={'pk': f'K#{k}', 'sk': 'META'}, UpdateExpression='SET settings = :s',
                               ExpressionAttributeValues={':s': {**DEFAULT_SETTINGS, **settings}})
        for channel, can_read, policy in DEFAULT_CHANNELS:
            self.table.put_item(Item={'pk': f'K#{k}', 'sk': f'C#{new_id()}', 'name': channel,
                                      'listenersCanRead': can_read, 'postPolicy': policy})
        return k

    def create_invite(self, k, inviter_id, role, uses, days, classification=''):
        code = ''.join(secrets.choice(CROCKFORD) for _ in range(INVITE_CODE_LENGTH))
        item = {'pk': f'INV#{code}', 'sk': 'META', 'kehilaId': k, 'inviterId': inviter_id,
                'role': role, 'usesLeft': uses, 'expiresAt': int(time.time()) + days * 86400}
        if classification:
            item['classification'] = classification
        self.table.put_item(Item=item, ConditionExpression='attribute_not_exists(pk)')
        return code

    def get_invite(self, code):
        return self._get(f'INV#{code}', 'META')

    def accept_invite(self, code, user_id, display_name, now, broadcast_default):
        """Consume one use and add (or, for a listener and a member invite, upgrade) the membership in one
        transaction; the conditions are the only gate."""
        invite = self.get_invite(code)
        if not invite:
            raise ApiError(404, 'invite_not_found')
        k = invite['kehilaId']
        is_member = invite['role'] == 'member'
        classification = invite.get('classification', '') if is_member else ''
        can_broadcast = bool(broadcast_default) if is_member else False
        membership = {'pk': f'K#{k}', 'sk': f'M#{user_id}', 'gsi1pk': f'U#{user_id}', 'gsi1sk': f'K#{k}',
                      'kehilaId': k, 'userId': user_id, 'role': invite['role'], 'classification': classification,
                      'canBroadcast': can_broadcast, 'notify': {}, 'displayName': display_name}
        use = {'Update': {'TableName': self.table.name,
                          'Key': {'pk': f'INV#{code}', 'sk': 'META'},
                          'UpdateExpression': 'SET usesLeft = usesLeft - :one',
                          'ConditionExpression': 'usesLeft > :zero AND expiresAt > :now',
                          'ExpressionAttributeValues': {':one': 1, ':zero': 0, ':now': int(now)}}}
        drop_request = {'Delete': {'TableName': self.table.name, 'Key': {'pk': f'K#{k}', 'sk': f'REQ#{user_id}'}}}
        items = [use, {'Put': {'TableName': self.table.name, 'Item': membership,
                               'ConditionExpression': 'attribute_not_exists(sk)'}}]
        if is_member:
            items.append(drop_request)
        try:
            self.table.meta.client.transact_write_items(TransactItems=items)
        except ClientError as error:
            if error.response['Error']['Code'] != 'TransactionCanceledException':
                raise
            reasons = [r.get('Code') for r in error.response.get('CancellationReasons', [])]
            reasons += [None] * (2 - len(reasons))
            if reasons[1] == 'ConditionalCheckFailed':
                if is_member:
                    return self._upgrade_listener(use, drop_request, k, user_id, membership)
                raise ApiError(409, 'already_member')
            if reasons[0] == 'ConditionalCheckFailed':
                raise ApiError(410, 'invite_expired')
            raise ApiError(409, 'try_again')  # TransactionConflict etc.: the client may retry
        return membership

    def _upgrade_listener(self, use, drop_request, k, user_id, membership):
        """A member invite for someone who already belongs: only a listener is upgraded (one transaction)."""
        upgrade = {'Update': {'TableName': self.table.name, 'Key': {'pk': f'K#{k}', 'sk': f'M#{user_id}'},
                              'UpdateExpression': 'SET #r = :member, classification = :c, canBroadcast = :b',
                              'ConditionExpression': '#r = :listener',
                              'ExpressionAttributeNames': {'#r': 'role'},
                              'ExpressionAttributeValues': {':member': 'member', ':listener': 'listener',
                                                            ':c': membership['classification'],
                                                            ':b': membership['canBroadcast']}}}
        try:
            self.table.meta.client.transact_write_items(TransactItems=[use, upgrade, drop_request])
        except ClientError as error:
            reasons = _cancel_reasons(error, 3)
            if reasons[1] == 'ConditionalCheckFailed':
                raise ApiError(409, 'already_member')  # a member or gabbai (or a listener upgraded meanwhile)
            if reasons[0] == 'ConditionalCheckFailed':
                raise ApiError(410, 'invite_expired')
            raise ApiError(409, 'try_again')
        return {**membership, 'role': 'member'}


def _cancel_reasons(error, count):
    """Per-item cancellation codes of a failed transaction, padded to `count`; re-raises other errors."""
    if error.response['Error']['Code'] != 'TransactionCanceledException':
        raise error
    reasons = [r.get('Code') for r in error.response.get('CancellationReasons', [])]
    return reasons + [None] * (count - len(reasons))


class AdminRepo:
    """Membership requests, approval, member management. Mixed into Repo next to MembersRepo."""

    def _txn(self, items):
        self.table.meta.client.transact_write_items(TransactItems=items)

    def _key(self, k, sk):
        return {'pk': f'K#{k}', 'sk': sk}

    def put_request(self, k, user_id, display_name, previously_rejected, now):
        """Add the listener's request; ConditionalCheckFailed means one is already pending."""
        try:
            self.table.put_item(Item={**self._key(k, f'REQ#{user_id}'), 'displayName': display_name,
                                      'createdAt': int(now), 'previouslyRejected': previously_rejected},
                                ConditionExpression='attribute_not_exists(sk)')
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            raise ApiError(409, 'already_requested')

    def get_request(self, k, user_id):
        return self._get(f'K#{k}', f'REQ#{user_id}')

    def list_requests(self, k):
        return self._query_prefix(k, 'REQ#')

    def list_members(self, k):
        return self._query_prefix(k, 'M#')

    def _query_prefix(self, k, prefix):
        items, kwargs = [], {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq(f'K#{k}') & Key('sk').begins_with(prefix),
                                    **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return items
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def approve_request(self, k, user_id, classification, can_broadcast):
        """One transaction: listener becomes member and the request disappears."""
        try:
            self._txn([
                {'Delete': {'TableName': self.table.name, 'Key': self._key(k, f'REQ#{user_id}'),
                            'ConditionExpression': 'attribute_exists(sk)'}},
                {'Update': {'TableName': self.table.name, 'Key': self._key(k, f'M#{user_id}'),
                            'UpdateExpression': 'SET #r = :member, classification = :c, canBroadcast = :b',
                            'ConditionExpression': '#r = :listener',
                            'ExpressionAttributeNames': {'#r': 'role'},
                            'ExpressionAttributeValues': {':member': 'member', ':listener': 'listener',
                                                          ':c': classification, ':b': can_broadcast}}},
            ])
        except ClientError as error:
            reasons = _cancel_reasons(error, 2)
            if reasons[0] == 'ConditionalCheckFailed':
                raise ApiError(404, 'request_not_found')
            if reasons[1] == 'ConditionalCheckFailed':
                raise ApiError(409, 'not_a_listener')
            raise ApiError(409, 'try_again')

    def reject_request(self, k, user_id, now):
        try:
            self._txn([
                {'Delete': {'TableName': self.table.name, 'Key': self._key(k, f'REQ#{user_id}'),
                            'ConditionExpression': 'attribute_exists(sk)'}},
                {'Update': {'TableName': self.table.name, 'Key': self._key(k, f'M#{user_id}'),
                            'UpdateExpression': 'SET rejectedAt = :now',
                            'ConditionExpression': 'attribute_exists(sk)',
                            'ExpressionAttributeValues': {':now': int(now)}}},
            ])
        except ClientError as error:
            reasons = _cancel_reasons(error, 2)
            if reasons[0] == 'ConditionalCheckFailed' or reasons[1] == 'ConditionalCheckFailed':
                raise ApiError(404, 'request_not_found')
            raise ApiError(409, 'try_again')

    def set_all_broadcast(self, k, allow):
        """Settings default first (so new approvals follow it), then every member."""
        self.table.update_item(Key=self._key(k, 'META'),
                               UpdateExpression='SET settings.memberBroadcastDefault = :a',
                               ExpressionAttributeValues={':a': allow})
        for item in self.list_members(k):
            if item['role'] == 'member':
                try:
                    self.table.update_item(Key=self._key(k, item['sk']), UpdateExpression='SET canBroadcast = :a',
                                           ConditionExpression='#r = :member',
                                           ExpressionAttributeNames={'#r': 'role'},
                                           ExpressionAttributeValues={':a': allow, ':member': 'member'})
                except ClientError as error:  # removed or demoted meanwhile: skip, keep going
                    if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                        raise

    # Changes to a membership. The target is checked against the role the caller saw, so a concurrent
    # change makes us answer try_again instead of overwriting it.
    def update_member(self, k, user_id, seen_role, fields):
        names = {'#r': 'role'}
        sets, values = [], {':seen': seen_role}
        for i, (name, value) in enumerate(fields.items()):
            names[f'#f{i}'] = name
            values[f':v{i}'] = value
            sets.append(f'#f{i} = :v{i}')
        update = {'TableName': self.table.name, 'Key': self._key(k, f'M#{user_id}'),
                  'UpdateExpression': 'SET ' + ', '.join(sets), 'ConditionExpression': '#r = :seen',
                  'ExpressionAttributeNames': names, 'ExpressionAttributeValues': values}
        if 'role' in fields:  # never to or from listener, even if the role changed since the caller looked
            update['ConditionExpression'] += ' AND #r IN (:member, :gabbai)'
            values[':member'], values[':gabbai'] = 'member', 'gabbai'
        if seen_role == 'gabbai' and fields.get('role', 'gabbai') != 'gabbai':
            return self._without_last_gabbai(k, user_id, [{'Update': update}])
        self._run(k, [{'Update': update}])

    def remove_member(self, k, user_id, seen_role):
        items = [{'Delete': {'TableName': self.table.name, 'Key': self._key(k, f'M#{user_id}'),
                             'ConditionExpression': '#r = :seen', 'ExpressionAttributeNames': {'#r': 'role'},
                             'ExpressionAttributeValues': {':seen': seen_role}}},
                 {'Delete': {'TableName': self.table.name, 'Key': self._key(k, f'REQ#{user_id}')}}]
        if seen_role == 'gabbai':
            return self._without_last_gabbai(k, user_id, items)
        self._run(k, items)

    def _run(self, k, items):
        try:
            self._txn(items)
        except ClientError as error:
            _cancel_reasons(error, 1)
            raise ApiError(409, 'try_again')

    def _without_last_gabbai(self, k, user_id, items):
        """Remove a gabbai only while another gabbai provably remains.

        The transaction also holds a ConditionCheck on a *witness*: some other gabbai whose role must
        still be gabbai at commit. DynamoDB transactions are serializable, so two gabbaim removing
        each other cannot both commit: the second one's witness has changed. On a failed witness we
        pick a new one; none left means last_gabbai.
        """
        for _ in range(3):
            witness = next((m['userId'] for m in self.list_members(k)
                            if m['role'] == 'gabbai' and m['userId'] != user_id), None)
            if witness is None:
                raise ApiError(409, 'last_gabbai')
            try:
                return self._guarded(k, witness, items)
            except ApiError as error:
                if error.code != 'witness_changed':
                    raise
        raise ApiError(409, 'try_again')

    def _guarded(self, k, witness, items):
        check = {'ConditionCheck': {'TableName': self.table.name, 'Key': self._key(k, f'M#{witness}'),
                                    'ConditionExpression': '#r = :gabbai', 'ExpressionAttributeNames': {'#r': 'role'},
                                    'ExpressionAttributeValues': {':gabbai': 'gabbai'}}}
        try:
            self._txn([check, *items])
        except ClientError as error:
            reasons = _cancel_reasons(error, 1 + len(items))
            if reasons[0] == 'ConditionalCheckFailed':
                raise ApiError(409, 'witness_changed')
            raise ApiError(409, 'try_again')
