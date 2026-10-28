"""Profiles and push devices: per-user data, not scoped to a Kehila."""
import secrets
import time
from datetime import datetime, timezone

from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from . import schedule_rules, type_rules as type_rules_module
from .errors import ApiError
from .ids import new_id

CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
INVITE_CODE_LENGTH = 10
_CODE_FIXES = str.maketrans({'I': '1', 'L': '1', 'O': '0'})
DEFAULT_SETTINGS = {'pollSeconds': 30, 'memberBroadcastDefault': False, 'broadcastDailyLimit': 3,
                    'defaultLang': 'he'}
DEFAULT_CHANNELS = (  # (name, listenersCanRead, postPolicy)
    ('announcements', True, 'broadcasters'),  # the one main channel; what each type allows is in settings.typeRules
)


def normalize_code(code):
    """Crockford: case-insensitive, I/L read as 1, O as 0."""
    return code.strip().upper().translate(_CODE_FIXES)


class MembersRepo:
    def get_profile(self, user_id):
        item = self._get(f'U#{user_id}', 'PROFILE')
        return {'firstName': item['firstName'], 'lastName': item['lastName'], 'lang': item['lang'],
                'phone': item.get('phone')} if item else None

    def put_profile(self, user_id, first, last, lang):
        """An update, not a replace: the phone number (and anything else on the item) survives."""
        self.table.update_item(Key={'pk': f'U#{user_id}', 'sk': 'PROFILE'},
                               UpdateExpression='SET firstName = :f, lastName = :l, lang = :g',
                               ExpressionAttributeValues={':f': first, ':l': last, ':g': lang})

    def set_phone(self, user_id, phone):
        """Store the normalised number, or remove it (None). 409 profile_required without a profile."""
        if phone is None:
            expression, values = 'REMOVE phone', None
        else:
            expression, values = 'SET phone = :p', {':p': phone}
        try:
            self.table.update_item(Key={'pk': f'U#{user_id}', 'sk': 'PROFILE'}, UpdateExpression=expression,
                                   ConditionExpression='attribute_exists(sk)',
                                   **({'ExpressionAttributeValues': values} if values else {}))
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            raise ApiError(409, 'profile_required')

    def set_phone_switch(self, k, user_id, show, version):
        self._update_member_item(k, user_id, 'SET showPhone = :s, phoneAsked = :v', {':s': show, ':v': version})

    def add_consent(self, user_id, kind, value, version, k=None):
        item = {'pk': f'U#{user_id}', 'sk': f'CONSENT#{new_id()}', 'kind': kind, 'value': value, 'version': version,
                'at': int(time.time())}
        if k:
            item['kehilaId'] = k
        self.table.put_item(Item=item)
        return item

    def get_export_marker(self, user_id, day):
        return self.table.get_item(Key={'pk': f'U#{user_id}', 'sk': f'EXPORT#{day}'}, ConsistentRead=True).get('Item')

    def put_export_marker(self, user_id, day, key):
        self.table.put_item(Item={'pk': f'U#{user_id}', 'sk': f'EXPORT#{day}', 'key': key,
                                  'expiresAt': int(time.time()) + 2 * 86400})

    def list_consents(self, user_id):
        items, kwargs = [], {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq(f'U#{user_id}')
                                    & Key('sk').begins_with('CONSENT#'), **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return items
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

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
            self.table.put_item(Item={**membership, 'importNotice': True},
                                ConditionExpression='attribute_not_exists(sk)',
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
        key_fields = ('pk', 'sk', 'gsi1pk', 'gsi1sk')
        condition = Attr('userId').eq(user_id) | Attr('authorId').eq(user_id) | Attr('targetMemberId').eq(user_id) \
            | Attr('inviterId').eq(user_id) | Attr('adults').contains(user_id)
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
                    if item['sk'].startswith('F#') and user_id in (item.get('adults') or []):
                        # an orphan family the leave clean-up never reached: out of the list, or gone if solo
                        self._drop_from(item['pk'][len('K#'):], item['familyId'], user_id)
                        blanked += 1
                        continue
                    if any(needle in item.get(field, '') for needle in (user_id, sub) for field in key_fields) \
                            or item.get('userId') == user_id or item.get('inviterId') == user_id:
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
        """Write the Kehila and its default channel; `settings` overrides the defaults."""
        k = new_id()
        self.put_kehila(k, name)
        self.table.update_item(Key={'pk': f'K#{k}', 'sk': 'META'}, UpdateExpression='SET settings = :s',
                               ExpressionAttributeValues={':s': {**DEFAULT_SETTINGS, **settings}})
        for channel, can_read, policy in DEFAULT_CHANNELS:
            self.table.put_item(Item={'pk': f'K#{k}', 'sk': f'C#{new_id()}', 'name': channel,
                                      'listenersCanRead': can_read, 'postPolicy': policy})
        return k

    def create_invite(self, k, inviter_id, role, uses, days, classification=''):
        """The INV item and its INVBY marker (for list, revoke and the per-member limit) in one transaction."""
        code = ''.join(secrets.choice(CROCKFORD) for _ in range(INVITE_CODE_LENGTH))
        now = int(time.time())
        expires = now + days * 86400
        item = {'pk': f'INV#{code}', 'sk': 'META', 'kehilaId': k, 'inviterId': inviter_id,
                'role': role, 'usesLeft': uses, 'expiresAt': expires}
        if classification:
            item['classification'] = classification
        marker = {**self._key(k, f'INVBY#{inviter_id}#{code}'), 'role': role, 'expiresAt': expires,
                  'createdAt': now}
        try:
            self._txn([{'Put': {'TableName': self.table.name, 'Item': item,
                                'ConditionExpression': 'attribute_not_exists(pk)'}},
                       {'Put': {'TableName': self.table.name, 'Item': marker}}])
        except ClientError as error:
            _cancel_reasons(error, 2)
            raise ApiError(409, 'try_again')  # a code collision or a conflict: the client retries
        return code

    def _markers(self, k, prefix, role=None, expired_too=False):
        """Unexpired INVBY markers under `prefix` (TTL deletion lags, so expiresAt is always filtered)."""
        condition = Attr('expiresAt').gt(0 if expired_too else int(time.time()))
        if role:
            condition &= Attr('role').eq(role)
        items, kwargs = [], {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq(f'K#{k}') & Key('sk').begins_with(prefix),
                                    FilterExpression=condition, **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return items
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def count_active_listener_invites(self, k, inviter_id):
        """Unexpired listener links of one member. Exhausted links (usesLeft 0) count until they expire."""
        return len(self._markers(k, f'INVBY#{inviter_id}#', 'listener'))

    def list_invites(self, k, inviter_id=None):
        """Unexpired invites of the Kehila (or of one inviter): INV items, newest first."""
        markers = self._markers(k, f'INVBY#{inviter_id}#' if inviter_id else 'INVBY#')
        markers.sort(key=lambda m: m['createdAt'], reverse=True)
        keys = [(f'INV#{m["sk"].rsplit("#", 1)[1]}', 'META') for m in markers]
        found = self.batch_get(keys)
        return [found[key] for key in keys if key in found and found[key]['kehilaId'] == k]

    def revoke_invite(self, k, invite):
        """Delete the INV item and its marker in one transaction, only while the invite belongs to Kehila k."""
        code = invite['pk'][len('INV#'):]
        try:
            self._txn([{'Delete': {'TableName': self.table.name, 'Key': {'pk': invite['pk'], 'sk': 'META'},
                                   'ConditionExpression': 'kehilaId = :k',
                                   'ExpressionAttributeValues': {':k': k}}},
                       {'Delete': {'TableName': self.table.name,
                                   'Key': self._key(k, f'INVBY#{invite["inviterId"]}#{code}')}}])
        except ClientError as error:
            if _cancel_reasons(error, 2)[0] == 'ConditionalCheckFailed':
                raise ApiError(404, 'invite_not_found')
            raise ApiError(409, 'try_again')

    def revoke_member_invites(self, k, user_id):
        """Delete every invite (and marker) a person made in Kehila k, expired ones too. Runs right after the
        membership change, not in its transaction (a person may hold more than 100 links, and the last-gabbai
        guard already uses the transaction's item budget). Idempotent: deletes need no condition, so a re-run
        finishes a partial failure."""
        markers = self._markers(k, f'INVBY#{user_id}#', expired_too=True)
        with self.table.batch_writer() as batch:
            for marker in markers:
                batch.delete_item(Key={'pk': f'INV#{marker["sk"].rsplit("#", 1)[1]}', 'sk': 'META'})
                batch.delete_item(Key={'pk': marker['pk'], 'sk': marker['sk']})

    def count_listeners(self, k):
        """Current listeners of the Kehila: a COUNT query over the membership items, following pagination.
        Soft cap: there is no counter item, so concurrent accepts may overshoot the limit by a few."""
        total, kwargs = 0, {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq(f'K#{k}') & Key('sk').begins_with('M#'),
                                    FilterExpression=Attr('role').eq('listener'), Select='COUNT', **kwargs)
            total += page['Count']
            if 'LastEvaluatedKey' not in page:
                return total
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def set_max_listeners(self, k, value):
        self.table.update_item(Key=self._key(k, 'META'), UpdateExpression='SET settings.maxListeners = :v',
                               ConditionExpression='attribute_exists(settings)',
                               ExpressionAttributeValues={':v': value})

    def set_settings(self, k, max_listeners=None, privacy_contact=None, type_rules=None, location=None, sheet=None, seat_deadline=None,
                     sheet_members=None):
        """Set the given settings only (None = leave); privacy_contact '' removes it. `type_rules` is a validated
        partial `{type: {post, listeners}}`: those types are replaced, the other type keeps its (normalized) rule.
        `location` / `sheet` (validated) replace those settings whole. Other settings are kept."""
        sets, removes, values = [], [], {}
        if location is not None:
            sets.append('settings.kehilaLocation = :loc')
            values[':loc'] = schedule_rules.stored(location)
        if sheet is not None:
            sets.append('settings.sheet = :sheet')
            values[':sheet'] = schedule_rules.stored(sheet)
        if seat_deadline is not None:
            sets.append('settings.seatDeadline = :sd')
            values[':sd'] = seat_deadline
        if sheet_members is not None:
            sets.append('settings.sheetMembers = :sm')
            values[':sm'] = sheet_members
        if type_rules:
            kehila = self.get_kehila(k)
            if not kehila:
                raise ApiError(404, 'kehila_not_found')
            sets.append('settings.typeRules = :t')
            values[':t'] = {**type_rules_module.rules(kehila.get('settings')), **type_rules}
        if max_listeners is not None:
            sets.append('settings.maxListeners = :m')
            values[':m'] = max_listeners
        if privacy_contact == '':
            removes.append('settings.privacyContact')
        elif privacy_contact is not None:
            sets.append('settings.privacyContact = :p')
            values[':p'] = privacy_contact
        expression = ('SET ' + ', '.join(sets) if sets else '') + (' REMOVE ' + ', '.join(removes) if removes else '')
        self.table.update_item(Key=self._key(k, 'META'), UpdateExpression=expression.strip(),
                               ConditionExpression='attribute_exists(settings)',
                               **({'ExpressionAttributeValues': values} if values else {}))

    def accept_terms(self, k, user_id, version, now):
        """The Kehila terms are accepted: the consent record first, then the META marker (no name stored)."""
        self.add_consent(user_id, 'kehilaTerms', 'accepted', version, k)
        self.table.update_item(Key=self._key(k, 'META'), UpdateExpression='SET termsAccepted = :t',
                               ConditionExpression='attribute_exists(sk)',
                               ExpressionAttributeValues={':t': {'version': version, 'userId': user_id, 'at': now}})

    def dismiss_import_notice(self, k, user_id):
        self._update_member_item(k, user_id, 'REMOVE importNotice', None)

    def set_phone_asked(self, k, user_id, version):
        self._update_member_item(k, user_id, 'SET phoneAsked = :v', {':v': version})

    def set_push_text(self, k, key, lang, text):
        """Set (or, for '', remove) the custom push text of `key` in `lang` with UpdateItem on the nested
        pushTexts map path; no other META field is touched. `key` and `lang` are validated by the caller."""
        table_key = self._key(k, 'META')
        if not text:
            try:
                self.table.update_item(Key=table_key, UpdateExpression='REMOVE #p.#k.#l',
                                       ConditionExpression='attribute_exists(#p.#k.#l)',
                                       ExpressionAttributeNames={'#p': 'pushTexts', '#k': key, '#l': lang})
            except ClientError as error:
                if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                    raise  # nothing to remove is fine
            return
        # the parent maps may not exist yet: try the deepest path first, then create what is missing
        for expression, condition, names, values in (
                ('SET #p.#k.#l = :t', 'attribute_exists(#p.#k)', {'#p': 'pushTexts', '#k': key, '#l': lang},
                 {':t': text}),
                ('SET #p.#k = :m', 'attribute_exists(#p) AND attribute_not_exists(#p.#k)',
                 {'#p': 'pushTexts', '#k': key}, {':m': {lang: text}}),
                ('SET #p = :m', 'attribute_exists(pk) AND attribute_not_exists(#p)', {'#p': 'pushTexts'},
                 {':m': {key: {lang: text}}})):
            try:
                self.table.update_item(Key=table_key, UpdateExpression=expression, ConditionExpression=condition,
                                       ExpressionAttributeNames=names, ExpressionAttributeValues=values)
                return
            except ClientError as error:
                if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                    raise
        raise ApiError(409, 'try_again')

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

    def _query_prefix(self, k, prefix, condition=None, consistent=False):
        items, kwargs = [], ({'FilterExpression': condition} if condition is not None else {})
        if consistent:
            kwargs['ConsistentRead'] = True
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
        sets, removes, values = [], [], {':seen': seen_role}
        for i, (name, value) in enumerate(fields.items()):
            names[f'#f{i}'] = name
            if name in ('groups', 'adminGroups') and not value:  # a string set cannot be empty
                removes.append(f'#f{i}')
                continue
            values[f':v{i}'] = set(value) if name in ('groups', 'adminGroups') else value
            sets.append(f'#f{i} = :v{i}')
        expression = ('SET ' + ', '.join(sets) if sets else '') + (' REMOVE ' + ', '.join(removes) if removes else '')
        update = {'TableName': self.table.name, 'Key': self._key(k, f'M#{user_id}'),
                  'UpdateExpression': expression.strip(), 'ConditionExpression': '#r = :seen',
                  'ExpressionAttributeNames': names, 'ExpressionAttributeValues': values}
        if 'role' in fields:  # never to or from listener, even if the role changed since the caller looked
            update['ConditionExpression'] += ' AND #r IN (:member, :gabbai)'
            values[':member'], values[':gabbai'] = 'member', 'gabbai'
        if seen_role == 'gabbai' and fields.get('role', 'gabbai') != 'gabbai':
            return self._without_last_gabbai(k, user_id, [{'Update': update}])
        self._run(k, [{'Update': update}])

    def add_member_groups(self, k, user_id, group_ids):
        """Atomic union into the member's groups. Nothing is created for a member who has gone."""
        if not group_ids:
            return
        try:
            self.table.update_item(Key=self._key(k, f'M#{user_id}'), UpdateExpression='ADD #g :ss',
                                   ConditionExpression='attribute_exists(sk)',
                                   ExpressionAttributeNames={'#g': 'groups'},
                                   ExpressionAttributeValues={':ss': set(group_ids)})
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise

    # group admins, members and join requests (spec 3c)
    def _update_member_item(self, k, user_id, expression, values, names=None):
        """Update an existing membership; 404 member_not_found when it has gone."""
        try:
            self.table.update_item(Key=self._key(k, f'M#{user_id}'), UpdateExpression=expression,
                                   ConditionExpression='attribute_exists(sk)',
                                   **({'ExpressionAttributeValues': values} if values else {}),
                                   **({'ExpressionAttributeNames': names} if names else {}))
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            raise ApiError(404, 'member_not_found')

    def set_group_admin(self, k, group_id, user_id, admin):
        if admin:  # an admin is always also in the group
            self._update_member_item(k, user_id, 'ADD adminGroups :g, #grp :g', {':g': {group_id}},
                                      {'#grp': 'groups'})
        else:
            self._update_member_item(k, user_id, 'DELETE adminGroups :g', {':g': {group_id}})

    def remove_member_group(self, k, user_id, group_id):
        self._update_member_item(k, user_id, 'DELETE #grp :g, adminGroups :g', {':g': {group_id}},
                                  {'#grp': 'groups'})

    def put_group_request(self, k, group_id, user_id):
        """Make the join request active; True only when no unexpired item existed (that is when admins are
        pushed). A live item, withdrawn or not, is kept and re-activated without a push."""
        now = int(time.time())
        key = self._key(k, f'GR#{group_id}#{user_id}')
        item = self._get(key['pk'], key['sk'])
        if item and int(item['expiresAt']) > now:
            if 'withdrawnAt' in item:
                self.table.update_item(Key=key, UpdateExpression='REMOVE withdrawnAt')
            return False
        try:
            self.table.put_item(Item={**key, 'userId': user_id, 'groupId': group_id, 'createdAt': now,
                                      'expiresAt': now + 30 * 86400},
                                ConditionExpression='attribute_not_exists(sk) OR expiresAt <= :now',
                                ExpressionAttributeValues={':now': now})
            return True
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            return False

    def get_group_request(self, k, group_id, user_id):
        """The live, not withdrawn request, else None."""
        item = self._get(f'K#{k}', f'GR#{group_id}#{user_id}')
        return item if item and int(item['expiresAt']) > time.time() and 'withdrawnAt' not in item else None

    def delete_group_request(self, k, group_id, user_id):
        self.table.delete_item(Key=self._key(k, f'GR#{group_id}#{user_id}'))

    def withdraw_group_request(self, k, group_id, user_id):
        """Mark withdrawn but keep the item (same expiresAt), so asking again does not push again."""
        try:
            self.table.update_item(Key=self._key(k, f'GR#{group_id}#{user_id}'),
                                   UpdateExpression='SET withdrawnAt = :now',
                                   ConditionExpression='attribute_exists(sk)',
                                   ExpressionAttributeValues={':now': int(time.time())})
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise

    def _live_requests(self):
        return Attr('expiresAt').gt(int(time.time())) & Attr('withdrawnAt').not_exists()

    def list_group_requests(self, k, group_id):
        return self._query_prefix(k, f'GR#{group_id}#', self._live_requests())

    def list_group_requests_all(self, k):
        return self._query_prefix(k, 'GR#', self._live_requests())

    def list_my_group_requests(self, k, user_id):
        return self._query_prefix(k, 'GR#', Attr('userId').eq(user_id) & self._live_requests())

    def list_group_members(self, k, group_id):
        return self._query_prefix(k, 'M#', Attr('groups').contains(group_id))

    # groups (spec 3c)
    def get_group(self, k, group_id):
        return self._get(f'K#{k}', f'G#{group_id}')

    def list_groups(self, k):
        return self._query_prefix(k, 'G#')

    def put_group(self, k, name):
        item = {**self._key(k, f'G#{new_id()}'), 'name': name}
        self.table.put_item(Item=item)
        return item

    def rename_group(self, k, group_id, name):
        try:
            return self.table.update_item(Key=self._key(k, f'G#{group_id}'), UpdateExpression='SET #n = :n',
                                          ConditionExpression='attribute_exists(sk)',
                                          ExpressionAttributeNames={'#n': 'name'},
                                          ExpressionAttributeValues={':n': name}, ReturnValues='ALL_NEW')['Attributes']
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            raise ApiError(404, 'group_not_found')

    def delete_group(self, k, group_id):
        try:
            self.table.delete_item(Key=self._key(k, f'G#{group_id}'), ConditionExpression='attribute_exists(sk)')
        except ClientError as error:
            if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            raise ApiError(404, 'group_not_found')

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
