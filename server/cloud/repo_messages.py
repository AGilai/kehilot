"""Channels, messages, joins, reads, change items and the daily broadcast counter."""
import time
from datetime import datetime, timedelta, timezone

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from .errors import ApiError
from .ids import new_id

CHANGE_TTL = 30 * 86400
COUNTER_TTL = 2 * 86400
MSG_PREFIX = 'MSG#'

try:
    from zoneinfo import ZoneInfo
    JERUSALEM = ZoneInfo('Asia/Jerusalem')
except Exception:  # tzdata missing (e.g. a slim Lambda image): local_date falls back to fixed offsets
    JERUSALEM = None


def local_date(now=None):
    """yyyy-mm-dd in Israel. Without tzdata: UTC+3 from April to September, else UTC+2 (off by at most
    a few days around the DST switches, which only shifts when a daily limit resets)."""
    now = now or datetime.now(timezone.utc)
    if JERUSALEM is not None:
        return now.astimezone(JERUSALEM).strftime('%Y-%m-%d')
    return (now + timedelta(hours=3 if 4 <= now.month <= 9 else 2)).strftime('%Y-%m-%d')


def _failed(error, *codes):
    return error.response['Error']['Code'] in codes


class MessagesRepo:
    # channels
    def get_channel(self, k, channel_id):
        return self._get(f'K#{k}', f'C#{channel_id}')

    def list_channels(self, k):
        return self._query_prefix(k, 'C#')

    def put_channel(self, k, name, listeners_can_read, post_policy):
        channel_id = new_id()
        item = {'pk': f'K#{k}', 'sk': f'C#{channel_id}', 'name': name,
                'listenersCanRead': listeners_can_read, 'postPolicy': post_policy}
        self.table.put_item(Item=item)
        return item

    def update_channel(self, k, channel_id, name, listeners_can_read, post_policy):
        try:
            return self.table.update_item(
                Key={'pk': f'K#{k}', 'sk': f'C#{channel_id}'},
                UpdateExpression='SET #n = :n, listenersCanRead = :l, postPolicy = :p',
                ConditionExpression='attribute_exists(sk)',
                ExpressionAttributeNames={'#n': 'name'},
                ExpressionAttributeValues={':n': name, ':l': listeners_can_read, ':p': post_policy},
                ReturnValues='ALL_NEW')['Attributes']
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(404, 'channel_not_found')

    # changes (the /changes feed reads these)
    def put_change(self, k, kind, ref_id, channel_id, visible_to=None, message_id=None):
        item = {'pk': f'K#{k}', 'sk': f'CHG#{new_id()}', 'kind': kind, 'refId': ref_id, 'channelId': channel_id,
                'expiresAt': int(time.time()) + CHANGE_TTL}
        if message_id is not None:  # replies: the reply lives under the message's partition (ruling P6)
            item['messageId'] = message_id
        if visible_to is not None:
            item['visibleTo'] = list(visible_to)
        self.table.put_item(Item=item)

    def list_changes_after(self, k, since, limit):
        """Up to `limit` change items with an ID greater than `since`, oldest first."""
        items, kwargs = [], {}
        key = Key('pk').eq(f'K#{k}') & Key('sk').between(f'CHG#{since}0', 'CHG#~')  # '0' sorts just after `since`
        while len(items) < limit:
            page = self.table.query(KeyConditionExpression=key, Limit=limit - len(items), ConsistentRead=True,
                                    **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                break
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']
        return items

    def latest_change_id(self, k):
        page = self.table.query(KeyConditionExpression=Key('pk').eq(f'K#{k}') & Key('sk').between('CHG#', 'CHG#~'),
                                ScanIndexForward=False, Limit=1, ConsistentRead=True)
        return page['Items'][0]['sk'][len('CHG#'):] if page['Items'] else None

    def batch_get(self, keys):
        """{(pk, sk): item} for the keys that exist, in BatchGetItem chunks of 100."""
        unique = list(dict.fromkeys(keys))
        found, client, name = {}, self.table.meta.client, self.table.name
        for start in range(0, len(unique), 100):
            request = {name: {'Keys': [{'pk': pk, 'sk': sk} for pk, sk in unique[start:start + 100]],
                              'ConsistentRead': True}}
            for _ in range(5):  # unprocessed keys come back under throttling
                response = client.batch_get_item(RequestItems=request)
                for item in response['Responses'].get(name, []):
                    found[(item['pk'], item['sk'])] = item
                request = response.get('UnprocessedKeys')
                if not request:
                    break
            else:
                raise ApiError(503, 'try_again')
        return found

    def set_notify(self, k, user_id, notify):
        self.table.update_item(Key={'pk': f'K#{k}', 'sk': f'M#{user_id}'}, UpdateExpression='SET notify = :n',
                               ConditionExpression='attribute_exists(sk)', ExpressionAttributeValues={':n': notify})

    # broadcast counter
    def count_broadcast(self, k, user_id, day, limit):
        """Conditional ADD: the limit holds under concurrency. Raises 429 broadcast_limit."""
        try:
            self.table.update_item(
                Key={'pk': f'K#{k}', 'sk': f'BC#{user_id}#{day}'},
                UpdateExpression='ADD #c :one SET expiresAt = :e',
                ConditionExpression='attribute_not_exists(#c) OR #c < :limit',
                ExpressionAttributeNames={'#c': 'count'},
                ExpressionAttributeValues={':one': 1, ':limit': limit, ':e': int(time.time()) + COUNTER_TTL})
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(429, 'broadcast_limit')

    # messages
    def put_message(self, k, channel_id, type_, title, body, author_id, author_name, author_kind, target):
        item = {'pk': f'K#{k}', 'sk': f'{MSG_PREFIX}{new_id()}', 'channelId': channel_id, 'type': type_,
                'title': title, 'body': body, 'authorId': author_id, 'authorName': author_name,
                'authorKind': author_kind, 'joinCount': 0, 'removed': False}
        if target:
            item['targetMemberId'] = target
        self.table.put_item(Item=item)
        return item

    def get_message(self, k, message_id):
        return self._get(f'K#{k}', f'{MSG_PREFIX}{message_id}')

    def iter_messages(self, k, before=None):
        """All messages of the Kehila, newest first, strictly older than `before`; lazy, 50 rows per read."""
        upper = f'{MSG_PREFIX}{before}' if before else f'{MSG_PREFIX}~'
        kwargs = {'KeyConditionExpression': Key('pk').eq(f'K#{k}') & Key('sk').between(MSG_PREFIX, upper),
                  'ScanIndexForward': False, 'Limit': 50, 'ConsistentRead': True}
        while True:
            page = self.table.query(**kwargs)
            for item in page['Items']:
                if before and item['sk'] == upper:  # BETWEEN is inclusive; the cursor is exclusive
                    continue
                yield item
            if 'LastEvaluatedKey' not in page:
                return
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def remove_message(self, k, message_id):
        try:
            self.table.update_item(Key={'pk': f'K#{k}', 'sk': f'{MSG_PREFIX}{message_id}'},
                                   UpdateExpression='SET removed = :t', ConditionExpression='attribute_exists(sk)',
                                   ExpressionAttributeValues={':t': True})
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(404, 'message_not_found')

    def join_message(self, k, message_id, user_id):
        """Returns (joinCount, newly_joined). The Join item and the counter change in one transaction."""
        msg_key = {'pk': f'K#{k}', 'sk': f'{MSG_PREFIX}{message_id}'}
        try:
            self._txn([
                {'Put': {'TableName': self.table.name,
                         'Item': {'pk': f'K#{k}#MSG#{message_id}', 'sk': f'J#{user_id}'},
                         'ConditionExpression': 'attribute_not_exists(sk)'}},
                {'Update': {'TableName': self.table.name, 'Key': msg_key,
                            'UpdateExpression': 'SET joinCount = if_not_exists(joinCount, :zero) + :one',
                            'ConditionExpression': 'attribute_exists(sk)',
                            'ExpressionAttributeValues': {':zero': 0, ':one': 1}}},
            ])
        except ClientError as error:
            if not _failed(error, 'TransactionCanceledException'):
                raise
            reasons = [r.get('Code') for r in error.response.get('CancellationReasons', [])] + [None, None]
            if reasons[0] == 'ConditionalCheckFailed':
                return int(self.get_message(k, message_id)['joinCount']), False
            if reasons[1] == 'ConditionalCheckFailed':
                raise ApiError(404, 'message_not_found')
            raise ApiError(409, 'try_again')
        return int(self.get_message(k, message_id)['joinCount']), True

    def put_read(self, k, message_id, user_id):
        self.table.put_item(Item={'pk': f'K#{k}#U#{user_id}', 'sk': f'READ#{message_id}',
                                  'at': int(time.time())})

    # replies
    def put_reply(self, k, message_id, author_id, author_name, body):
        item = {'pk': f'K#{k}#MSG#{message_id}', 'sk': f'R#{new_id()}', 'authorId': author_id,
                'authorName': author_name, 'body': body, 'createdAt': int(time.time())}
        self.table.put_item(Item=item)
        return item

    def list_replies(self, k, message_id):
        """Every reply of the message, oldest first. Callers filter with visibility.reply_visible."""
        items, kwargs = [], {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq(f'K#{k}#MSG#{message_id}')
                                    & Key('sk').begins_with('R#'), **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return items
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']
