"""Channels, messages, joins, reads, change items and the daily broadcast counter."""
import time
from datetime import datetime, timedelta, timezone

from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from .errors import ApiError
from .ids import new_id

CHANGE_TTL = 30 * 86400
COUNTER_TTL = 2 * 86400
CHAT_COUNTER_TTL = 2 * 3600
REPLY_PUSH_WINDOW = 15 * 60  # seconds between pushes for one message to one person
MSG_PREFIX = 'MSG#'
HISTORY_KEEP = 10

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

    def put_channel(self, k, name, listeners_can_read, post_policy, groups=frozenset(), conversation=False,
                    chat_hourly_limit=None):
        channel_id = new_id()
        item = {'pk': f'K#{k}', 'sk': f'C#{channel_id}', 'name': name,
                'listenersCanRead': listeners_can_read, 'postPolicy': post_policy, 'conversation': conversation}
        if chat_hourly_limit is not None:
            item['chatHourlyLimit'] = chat_hourly_limit
        if groups:  # a string set cannot be empty: absent means the whole Kehila
            item['groups'] = set(groups)
        self.table.put_item(Item=item)
        return item

    def update_channel(self, k, channel_id, name, listeners_can_read, post_policy, groups=None, conversation=None,
                       chat_hourly_limit=None):
        """`groups=None` keeps the stored groups; an empty set removes them. `conversation=None` and
        `chat_hourly_limit=None` keep the stored values."""
        sets = 'SET #n = :n, listenersCanRead = :l, postPolicy = :p'
        values = {':n': name, ':l': listeners_can_read, ':p': post_policy}
        if conversation is not None:
            sets += ', conversation = :cv'
            values[':cv'] = conversation
        if chat_hourly_limit is not None:
            sets += ', chatHourlyLimit = :cl'
            values[':cl'] = chat_hourly_limit
        if groups is not None and groups:
            sets += ', #g = :g'
            values[':g'] = set(groups)
        names = {'#n': 'name'}
        if groups is not None:
            names['#g'] = 'groups'
            if not groups:
                sets += ' REMOVE #g'
        try:
            return self.table.update_item(
                Key={'pk': f'K#{k}', 'sk': f'C#{channel_id}'},
                UpdateExpression=sets,
                ConditionExpression='attribute_exists(sk)',
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
                ReturnValues='ALL_NEW')['Attributes']
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(404, 'channel_not_found')

    def delete_channel(self, k, channel_id):
        self.table.delete_item(Key={'pk': f'K#{k}', 'sk': f'C#{channel_id}'})

    # changes (the /changes feed reads these)
    def put_change(self, k, kind, ref_id, channel_id, visible_to=None, message_id=None):
        item = {'pk': f'K#{k}', 'sk': f'CHG#{new_id()}', 'kind': kind, 'refId': ref_id, 'channelId': channel_id,
                'expiresAt': int(time.time()) + CHANGE_TTL}
        if message_id is not None:  # replies: the reply lives under the message's partition (ruling P6)
            item['messageId'] = message_id
        if visible_to is not None:
            item['visibleTo'] = list(visible_to)
        self.table.put_item(Item=item)

    def list_changes_after(self, k, since, until, limit):
        """Up to `limit` change items with an ID greater than `since` and below `until`, oldest first."""
        items, kwargs = [], {}
        key = Key('pk').eq(f'K#{k}') & Key('sk').between(f'CHG#{since}0', f'CHG#{until}')  # '0' sorts just after `since`
        while len(items) < limit:
            page = self.table.query(KeyConditionExpression=key, Limit=limit - len(items), ConsistentRead=True,
                                    **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                break
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']
        return items

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

    def count_uploads(self, k, user_id, hour, limit):
        """Conditional ADD per user and UTC hour (yyyymmddhh). Raises 429 rate_limited."""
        try:
            self.table.update_item(
                Key={'pk': f'K#{k}', 'sk': f'UPL#{user_id}#{hour}'},
                UpdateExpression='ADD #c :one SET expiresAt = :e',
                ConditionExpression='attribute_not_exists(#c) OR #c < :limit',
                ExpressionAttributeNames={'#c': 'count'},
                ExpressionAttributeValues={':one': 1, ':limit': limit, ':e': int(time.time()) + CHAT_COUNTER_TTL})
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(429, 'rate_limited')

    def set_chat_limit(self, k, channel_id, limit):
        try:
            self.table.update_item(Key={'pk': f'K#{k}', 'sk': f'C#{channel_id}'},
                                   UpdateExpression='SET chatHourlyLimit = :l',
                                   ConditionExpression='attribute_exists(sk)', ExpressionAttributeValues={':l': limit})
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(404, 'channel_not_found')

    def count_chat(self, k, channel_id, user_id, hour, limit):
        """Conditional ADD per channel, user and UTC hour (yyyymmddhh). Raises 429 rate_limited."""
        try:
            self.table.update_item(
                Key={'pk': f'K#{k}', 'sk': f'CC#{channel_id}#{user_id}#{hour}'},
                UpdateExpression='ADD #c :one SET expiresAt = :e',
                ConditionExpression='attribute_not_exists(#c) OR #c < :limit',
                ExpressionAttributeNames={'#c': 'count'},
                ExpressionAttributeValues={':one': 1, ':limit': limit, ':e': int(time.time()) + CHAT_COUNTER_TTL})
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(429, 'rate_limited')

    # messages
    def put_message(self, k, channel_id, type_, title, body, author_id, author_name, author_kind, target,
                    target_name='', message_id=None, image=None, target_family_id=None,
                    template_id=None, fields=None):
        item = {'pk': f'K#{k}', 'sk': f'{MSG_PREFIX}{message_id or new_id()}', 'channelId': channel_id, 'type': type_,
                'title': title, 'body': body, 'authorId': author_id, 'authorName': author_name,
                'authorKind': author_kind, 'joinCount': 0, 'removed': False}
        if target:
            item['targetMemberId'] = target
            item['targetName'] = target_name
            if target_family_id:
                item['targetFamilyId'] = target_family_id
        if image:
            item['image'] = {'contentType': image['contentType'], 'bytes': image['bytes']}
        if template_id:
            item['templateId'] = template_id
            item['fields'] = fields or {}
        self.table.put_item(Item=item)
        return item

    def update_message(self, k, message_id, *, title, body, template_id, fields, first_fields, changed, history_entry,
                       updated_by, now, seen_updated_at):
        """Change a live message in place (same id) and push the old text onto its history (the last HISTORY_KEEP
        are kept). `first_fields` is only written once. One update_item, guarded by the `updatedAt` the caller read:
        a concurrent update makes this 409 try_again; a message that is gone is 404."""
        key = {'pk': f'K#{k}', 'sk': f'{MSG_PREFIX}{message_id}'}
        sets = ['title = :t', 'body = :b', 'templateId = :tid', '#f = :f', '#ff = if_not_exists(#ff, :ff)',
                'updatedAt = :now', 'updatedBy = :by', 'history = list_append(if_not_exists(history, :none), :entry)']
        values = {':t': title, ':b': body, ':tid': template_id, ':f': fields, ':ff': first_fields, ':now': now,
                  ':by': updated_by, ':none': [], ':entry': [history_entry], ':false': False}
        names = {'#f': 'fields', '#ff': 'firstFields'}
        if changed:
            sets.append('changed = :ch')
            values[':ch'] = changed
        guard = 'updatedAt = :seen' if seen_updated_at is not None else 'attribute_not_exists(updatedAt)'
        if seen_updated_at is not None:
            values[':seen'] = seen_updated_at
        try:
            attrs = self.table.update_item(
                Key=key, UpdateExpression='SET ' + ', '.join(sets) + ('' if changed else ' REMOVE changed'),
                ConditionExpression=f'attribute_exists(sk) AND removed = :false AND {guard}',
                ExpressionAttributeNames=names, ExpressionAttributeValues=values, ReturnValues='ALL_NEW')['Attributes']
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            current = self.get_message(k, message_id)
            if not current or current.get('removed'):
                raise ApiError(404, 'message_not_found')
            raise ApiError(409, 'try_again')
        if len(attrs['history']) > HISTORY_KEEP:
            attrs['history'] = attrs['history'][-HISTORY_KEEP:]
            try:
                self.table.update_item(Key=key, UpdateExpression='SET history = :h',
                                       ConditionExpression='attribute_exists(sk) AND updatedAt = :now',
                                       ExpressionAttributeValues={':h': attrs['history'], ':now': now})
            except ClientError as error:
                if not _failed(error, 'ConditionalCheckFailedException'):
                    raise  # a newer update trims on its own
        return attrs

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
                                   UpdateExpression='SET removed = :t REMOVE image', ConditionExpression='attribute_exists(sk)',
                                   ExpressionAttributeValues={':t': True})
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(404, 'message_not_found')

    def scrub_message(self, k, message_id):
        """Blank title and body and set the postsScrubbed marker (account deletion with "delete everything I posted"). Idempotent."""
        try:
            self.table.update_item(Key={'pk': f'K#{k}', 'sk': f'{MSG_PREFIX}{message_id}'},
                                   UpdateExpression='SET title = :e, body = :e, postsScrubbed = :t REMOVE #f, templateId, history, firstFields, changed',
                                   ConditionExpression='attribute_exists(sk)', ExpressionAttributeNames={'#f': 'fields'},
                                   ExpressionAttributeValues={':e': '', ':t': True})
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise  # a message that is gone needs no scrub

    def authored_items(self, user_id):
        """Every message and reply the user wrote, in every Kehila: one consistent paginated Scan with a filter.
        O(table size), like purge_user (see its note); only used by account deletion."""
        items, kwargs = [], {'FilterExpression': Attr('authorId').eq(user_id), 'ConsistentRead': True}
        while True:
            page = self.table.scan(**kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return items
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

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

    def read_flags(self, k, user_id, message_ids):
        """The subset of message_ids this user has read: one BatchGetItem (at most 50 keys)."""
        keys = [(f'K#{k}#U#{user_id}', f'READ#{m}') for m in dict.fromkeys(message_ids)]
        found = self.batch_get(keys) if keys else {}
        return {sk[len('READ#'):] for _, sk in found}

    # replies
    def put_reply(self, k, message_id, author_id, author_name, body, to='family'):
        """Write the person's one reply, its distinct-replier marker and replierCount + 1 in one transaction.
        `to` is 'author', 'family' or the userId of the one chosen adult. The marker's attribute_not_exists is
        what makes "one reply per person" hold under races: a second try raises 409 already_replied."""
        item = {'pk': f'K#{k}#MSG#{message_id}', 'sk': f'R#{new_id()}', 'authorId': author_id,
                'authorName': author_name, 'body': body, 'createdAt': int(time.time()), 'to': to}
        name = self.table.name
        try:
            self._txn([
                {'Put': {'TableName': name, 'Item': item}},
                {'Put': {'TableName': name, 'Item': {'pk': item['pk'], 'sk': f'RP#{author_id}'},
                         'ConditionExpression': 'attribute_not_exists(sk)'}},
                {'Update': {'TableName': name, 'Key': {'pk': f'K#{k}', 'sk': f'{MSG_PREFIX}{message_id}'},
                            'UpdateExpression': 'ADD replierCount :one',
                            'ConditionExpression': 'attribute_exists(sk)',
                            'ExpressionAttributeValues': {':one': 1}}},
            ])
            return item
        except ClientError as error:
            if not _failed(error, 'TransactionCanceledException'):
                raise
            reasons = [r.get('Code') for r in error.response.get('CancellationReasons', [])] + [None] * 3
            if reasons[2] == 'ConditionalCheckFailed':
                raise ApiError(404, 'message_not_found')
            if reasons[1] == 'ConditionalCheckFailed':
                raise ApiError(409, 'already_replied')
            raise ApiError(409, 'try_again')

    def touch_thread(self, k, message_id, message, route, personal_to=None, now=None):
        """The mailbox index of an answered message: who may have replies (never what they say). Written before
        the reply, so a crash in between leaves an empty candidate, never a reply the mailbox cannot find."""
        values = {':route': route, ':author': message['authorId'], ':now': int(now if now is not None else time.time())}
        sets = ['replyTo = :route', 'msgAuthorId = :author', 'lastAt = :now']
        for field in ('targetMemberId', 'targetFamilyId'):
            if message.get(field):
                sets.append(f'{field} = :{field}')
                values[f':{field}'] = message[field]
        expression = 'SET ' + ', '.join(sets)
        if personal_to:
            expression += ' ADD personalTo :personal'
            values[':personal'] = {personal_to}
        self.table.update_item(Key={'pk': f'K#{k}#RX', 'sk': f'{MSG_PREFIX}{message_id}'}, UpdateExpression=expression,
                               ExpressionAttributeValues=values)

    def claim_reply_push(self, k, message_id, user_id, now):
        """True when this user may be pushed for a reply on the message now: at most one push per message per user
        in REPLY_PUSH_WINDOW. A conditional put, so concurrent workers cannot both claim."""
        now = int(now)
        try:
            self.table.put_item(
                Item={'pk': f'K#{k}#U#{user_id}', 'sk': f'RXPUSH#{message_id}', 'at': now, 'expiresAt': now + 3600},
                ConditionExpression='attribute_not_exists(sk) OR #at <= :cut',
                ExpressionAttributeNames={'#at': 'at'},
                ExpressionAttributeValues={':cut': now - REPLY_PUSH_WINDOW})
            return True
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            return False

    def get_reply(self, k, message_id, reply_id):
        return self._get(f'K#{k}#MSG#{message_id}', f'R#{reply_id}')

    def update_reply(self, k, message_id, reply_id, author_id, body, now=None):
        """Edit the writer's own reply; `to` never changes. Anyone else's, or a missing one: 404 reply_not_found."""
        try:
            return self.table.update_item(
                Key={'pk': f'K#{k}#MSG#{message_id}', 'sk': f'R#{reply_id}'},
                UpdateExpression='SET body = :b, updatedAt = :t',
                ConditionExpression='attribute_exists(sk) AND authorId = :me',
                ExpressionAttributeValues={':b': body, ':t': int(now if now is not None else time.time()),
                                           ':me': author_id},
                ReturnValues='ALL_NEW')['Attributes']
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise
            raise ApiError(404, 'reply_not_found')

    def list_threads(self, k):
        """Every thread-index item of the Kehila (candidates for a mailbox; callers re-check visibility)."""
        items, kwargs = [], {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq(f'K#{k}#RX'), ConsistentRead=True, **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return items
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def seen_marks(self, k, user_id, message_ids):
        """{messageId: upTo} for the messages the user has a read watermark on."""
        keys = [(f'K#{k}#U#{user_id}', f'RXSEEN#{m}') for m in dict.fromkeys(message_ids)]
        found = self.batch_get(keys) if keys else {}
        return {sk[len('RXSEEN#'):]: item['upTo'] for (_, sk), item in found.items()}

    def mark_seen(self, k, user_id, message_id, up_to):
        """Raise the watermark; never lowers it. A lost race (a newer mark already there) is not an error."""
        try:
            self.table.update_item(Key={'pk': f'K#{k}#U#{user_id}', 'sk': f'RXSEEN#{message_id}'},
                                   UpdateExpression='SET upTo = :u',
                                   ConditionExpression='attribute_not_exists(upTo) OR upTo < :u',
                                   ExpressionAttributeValues={':u': up_to})
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise

    def list_replies(self, k, message_id, consistent=False):
        """Every reply of the message, oldest first. Callers filter with visibility.reply_visible."""
        items, kwargs = [], {'ConsistentRead': True} if consistent else {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq(f'K#{k}#MSG#{message_id}')
                                    & Key('sk').begins_with('R#'), **kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return items
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def delete_replies(self, k, message_id):
        """Delete every reply (R#), distinct-replier marker (RP#) and the thread index item of the message.
        Returns the number of replies and markers."""
        pk, count = f'K#{k}#MSG#{message_id}', 0
        keys, kwargs = [], {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq(pk) & (Key('sk').begins_with('R#')),
                                    ProjectionExpression='pk, sk', ConsistentRead=True, **kwargs)
            keys += page['Items']
            if 'LastEvaluatedKey' not in page:
                break
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']
        # 'RP#' does not start with 'R#', so the markers need their own query
        kwargs = {}
        while True:
            page = self.table.query(KeyConditionExpression=Key('pk').eq(pk) & Key('sk').begins_with('RP#'),
                                    ProjectionExpression='pk, sk', ConsistentRead=True, **kwargs)
            keys += page['Items']
            if 'LastEvaluatedKey' not in page:
                break
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']
        with self.table.batch_writer() as batch:
            for key in keys:
                batch.delete_item(Key={'pk': key['pk'], 'sk': key['sk']})
                count += 1
            batch.delete_item(Key={'pk': f'K#{k}#RX', 'sk': f'{MSG_PREFIX}{message_id}'})  # the thread index item
        return count

    def delete_reply(self, k, message_id, reply_sk, author_id):
        """Delete one reply of the author. Returns True when this call deleted it, False when it was already gone.
        When it is the author's last reply on the message, the reply, the RP# marker and replierCount - 1 change in
        ONE transaction (then a reply_count change), so the marker never goes without the count. The reply's own
        existence is a condition: a stale second delete cannot touch a marker made by a later reply. A cancelled
        transaction is retried; a conflict that persists is 409 try_again with nothing changed."""
        pk, name = f'K#{k}#MSG#{message_id}', self.table.name
        for _ in range(3):
            mine = [r['sk'] for r in self.list_replies(k, message_id, consistent=True) if r['authorId'] == author_id]
            if reply_sk not in mine:
                return False
            if mine != [reply_sk]:  # an older duplicate reply remains: the marker and the count stay
                try:
                    self.table.delete_item(Key={'pk': pk, 'sk': reply_sk}, ConditionExpression='attribute_exists(sk)')
                except ClientError as error:
                    if not _failed(error, 'ConditionalCheckFailedException'):
                        raise
                    return False
                return True
            try:
                self._txn([
                    {'Delete': {'TableName': name, 'Key': {'pk': pk, 'sk': reply_sk},
                                'ConditionExpression': 'attribute_exists(sk)'}},
                    {'Delete': {'TableName': name, 'Key': {'pk': pk, 'sk': f'RP#{author_id}'},
                                'ConditionExpression': 'attribute_exists(sk)'}},
                    {'Update': {'TableName': name, 'Key': {'pk': f'K#{k}', 'sk': f'{MSG_PREFIX}{message_id}'},
                                'UpdateExpression': 'ADD replierCount :minus1',
                                'ConditionExpression': 'replierCount > :zero',
                                'ExpressionAttributeValues': {':minus1': -1, ':zero': 0}}},
                ])
            except ClientError as error:
                if not _failed(error, 'TransactionCanceledException'):
                    raise
                reasons = [r.get('Code') for r in error.response.get('CancellationReasons', [])] + [None] * 3
                if reasons[0] == 'ConditionalCheckFailed':
                    return False  # a concurrent delete won
                if 'TransactionConflict' in reasons or 'ConditionalCheckFailed' not in reasons:
                    continue  # someone else was writing the same items: look again
                # the marker is gone or the count is already 0 (old data): drop the reply without moving the count
                self.table.delete_item(Key={'pk': pk, 'sk': reply_sk})
                self.table.delete_item(Key={'pk': pk, 'sk': f'RP#{author_id}'})
                return True
            message = self.get_message(k, message_id)
            if message:
                self.put_change(k, 'reply_count', message_id, message['channelId'])
            return True
        raise ApiError(409, 'try_again')

    def received_reply_items(self, user_id):
        """What account deletion must drop: replies addressed to the user (`to` is their id) and the thread-index
        items of messages they wrote that take author replies. One consistent paginated Scan with a filter;
        O(table size), like authored_items."""
        condition = Attr('to').eq(user_id) | (Attr('msgAuthorId').eq(user_id) & Attr('replyTo').eq('author'))
        items, kwargs = [], {'FilterExpression': condition, 'ConsistentRead': True}
        while True:
            page = self.table.scan(**kwargs)
            items += page['Items']
            if 'LastEvaluatedKey' not in page:
                return items
            kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def reset_replier_count(self, k, message_id):
        """replierCount = 0 once every reply of the message is gone. A message that is gone needs nothing."""
        try:
            self.table.update_item(Key={'pk': f'K#{k}', 'sk': f'{MSG_PREFIX}{message_id}'},
                                   UpdateExpression='SET replierCount = :zero',
                                   ConditionExpression='attribute_exists(sk)', ExpressionAttributeValues={':zero': 0})
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise

    def drop_personal_to(self, k, message_id, user_id):
        """Take the user out of the thread index's personalTo set (the set item goes with its last member)."""
        try:
            self.table.update_item(Key={'pk': f'K#{k}#RX', 'sk': f'{MSG_PREFIX}{message_id}'},
                                   UpdateExpression='DELETE personalTo :u', ConditionExpression='attribute_exists(sk)',
                                   ExpressionAttributeValues={':u': {user_id}})
        except ClientError as error:
            if not _failed(error, 'ConditionalCheckFailedException'):
                raise

    def purge_reply_markers(self, k, user_id):
        """Delete the user's read watermarks and push-throttle items in the Kehila (leave and removal). Returns the count."""
        count = 0
        for prefix in ('RXSEEN#', 'RXPUSH#'):
            page = {}
            while True:
                page = self.table.query(KeyConditionExpression=Key('pk').eq(f'K#{k}#U#{user_id}')
                                        & Key('sk').begins_with(prefix), ProjectionExpression='pk, sk',
                                        ConsistentRead=True, **({'ExclusiveStartKey': page['LastEvaluatedKey']}
                                                                if 'LastEvaluatedKey' in page else {}))
                with self.table.batch_writer() as batch:
                    for item in page['Items']:
                        batch.delete_item(Key={'pk': item['pk'], 'sk': item['sk']})
                        count += 1
                if 'LastEvaluatedKey' not in page:
                    break
        return count
