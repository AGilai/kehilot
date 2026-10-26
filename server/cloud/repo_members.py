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

    def create_invite(self, k, inviter_id, role, uses, days):
        code = ''.join(secrets.choice(CROCKFORD) for _ in range(INVITE_CODE_LENGTH))
        self.table.put_item(Item={'pk': f'INV#{code}', 'sk': 'META', 'kehilaId': k, 'inviterId': inviter_id,
                                  'role': role, 'usesLeft': uses, 'expiresAt': int(time.time()) + days * 86400},
                            ConditionExpression='attribute_not_exists(pk)')
        return code

    def get_invite(self, code):
        return self._get(f'INV#{code}', 'META')

    def accept_invite(self, code, user_id, display_name, now):
        """Consume one use and add the membership in one transaction; the conditions are the only gate."""
        invite = self.get_invite(code)
        if not invite:
            raise ApiError(404, 'invite_not_found')
        k = invite['kehilaId']
        membership = {'pk': f'K#{k}', 'sk': f'M#{user_id}', 'gsi1pk': f'U#{user_id}', 'gsi1sk': f'K#{k}',
                      'kehilaId': k, 'userId': user_id, 'role': invite['role'], 'classification': '',
                      'canBroadcast': False, 'notify': {}, 'displayName': display_name}
        try:
            self.table.meta.client.transact_write_items(TransactItems=[
                {'Update': {'TableName': self.table.name,
                            'Key': {'pk': f'INV#{code}', 'sk': 'META'},
                            'UpdateExpression': 'SET usesLeft = usesLeft - :one',
                            'ConditionExpression': 'usesLeft > :zero AND expiresAt > :now',
                            'ExpressionAttributeValues': {':one': 1, ':zero': 0, ':now': int(now)}}},
                {'Put': {'TableName': self.table.name, 'Item': membership,
                         'ConditionExpression': 'attribute_not_exists(sk)'}},
            ])
        except ClientError as error:
            if error.response['Error']['Code'] != 'TransactionCanceledException':
                raise
            reasons = [r.get('Code') for r in error.response.get('CancellationReasons', [])]
            reasons += [None] * (2 - len(reasons))
            if reasons[1] == 'ConditionalCheckFailed':
                raise ApiError(409, 'already_member')
            if reasons[0] == 'ConditionalCheckFailed':
                raise ApiError(410, 'invite_expired')
            raise ApiError(409, 'try_again')  # TransactionConflict etc.: the client may retry
        return membership

