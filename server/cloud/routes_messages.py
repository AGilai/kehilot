"""Routes: channels, messages, joining a blessing and read receipts. Visibility comes from visibility.py."""
from datetime import datetime, timezone

from . import inputs, media, push, visibility
from .authz import require
from .errors import ApiError
from .ids import ID_RE, new_id
from .repo_messages import local_date
from .routes_admin import _channel_json

TYPES = ('weekly', 'celebration', 'condolence', 'event')
TARGET_TYPES = ('celebration', 'condolence')
DEFAULT_LIMIT, MAX_LIMIT = 20, 50
REPLY_MAX = 1000
CHAT = 'chat'
CHAT_MAX = 1000
CHAT_HOURLY_LIMIT = 30


def _message_json(item, read=None):
    out = {'messageId': item['sk'][len('MSG#'):], 'channelId': item['channelId'], 'type': item['type'],
           'title': item['title'], 'body': item['body'], 'authorId': item['authorId'],
           'authorName': item['authorName'], 'authorKind': item['authorKind'],
           'joinCount': int(item.get('joinCount', 0))}
    if item.get('targetMemberId'):
        out['targetMemberId'] = item['targetMemberId']
        out['targetName'] = item.get('targetName', '')
        out['replierCount'] = int(item.get('replierCount', 0))  # a count only: never who or what
    if item.get('image'):  # metadata only: the URL comes from GET .../image after a visibility check
        out['image'] = {'contentType': item['image']['contentType'], 'bytes': int(item['image']['bytes'])}
    if read is not None:
        out['read'] = read
    return out


def _visible_message(ctx, k, membership, message_id):
    """The message and its channel, or 404 message_not_found: hidden and missing look the same."""
    message = ctx.repo.get_message(k, message_id) if ID_RE.fullmatch(message_id) else None
    channel = ctx.repo.get_channel(k, message['channelId']) if message else None
    if not message or not visibility.message_visible(membership, channel, message):
        raise ApiError(404, 'message_not_found')
    return message, channel


def list_channels(ctx, params):
    membership = require(ctx.repo, ctx.user_id, params['k'])
    is_gabbai = visibility.is_gabbai(membership)
    channels = [{**_channel_json(c, is_gabbai, visibility.is_channel_admin(membership, c)), 'canPost': visibility.can_post(membership, c),
                 'inAudience': visibility.in_audience(membership, c)}
                for c in ctx.repo.list_channels(params['k']) if visibility.can_read_channel(membership, c)]
    return 200, channels


def _image_upload_id(d):
    if 'imageUploadId' not in d:
        return None
    value = d['imageUploadId']
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise ApiError(400, 'invalid_image_upload_id')
    return value


def _attach(k, user_id, upload_id):
    """(message_id, image) for put_message: a new ID, and the claimed upload when there is one."""
    message_id = new_id()
    return message_id, (media.claim_upload(k, user_id, upload_id, message_id) if upload_id else None)


def post_message(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k)
    d = inputs.body_object(ctx)
    channel_id = d.get('channelId')
    if not isinstance(channel_id, str) or not ID_RE.fullmatch(channel_id):
        raise ApiError(400, 'invalid_channel_id')
    channel = ctx.repo.get_channel(k, channel_id)
    if channel and channel.get('conversation'):
        return _post_chat(ctx, k, membership, channel_id, channel, d)
    upload_id = _image_upload_id(d)
    type_ = inputs.choice(d, 'type', TYPES)
    title = inputs.text(d, 'title', 120, required=True)
    body = inputs.text(d, 'body', 4000)
    target = d.get('targetMemberId')
    target_membership = None
    if target is not None:
        if type_ not in TARGET_TYPES or not isinstance(target, str) or not ID_RE.fullmatch(target):
            raise ApiError(400, 'invalid_target_member_id')
        target_membership = ctx.repo.get_membership(k, target)
        if not target_membership or target_membership['role'] not in ('member', 'gabbai'):
            raise ApiError(400, 'invalid_target_member_id')
    channel = ctx.repo.get_channel(k, channel_id)
    if not visibility.can_read_channel(membership, channel):
        raise ApiError(404, 'channel_not_found')
    if target and not visibility.reply_target_ok(target_membership, channel):
        raise ApiError(400, 'invalid_target_member_id')
    if not visibility.can_post(membership, channel):
        raise ApiError(403, 'forbidden')
    if membership['role'] != 'gabbai':
        limit = ctx.repo.get_kehila(k).get('settings', {}).get('broadcastDailyLimit', 3)
        ctx.repo.count_broadcast(k, ctx.user_id, local_date(), int(limit))
    message_id, image = _attach(k, ctx.user_id, upload_id)
    item = ctx.repo.put_message(k, channel_id, type_, title, body, ctx.user_id, membership.get('displayName', ''),
                                'management' if membership['role'] == 'gabbai' else 'member', target,
                                target_membership.get('displayName', '') if target else '',
                                message_id=message_id, image=image)
    message = _message_json(item)
    ctx.repo.put_change(k, 'message', message['messageId'], channel_id)
    push.enqueue('message', k, message['messageId'])
    return 201, message


def _post_chat(ctx, k, membership, channel_id, channel, d):
    if not visibility.can_read_channel(membership, channel):
        raise ApiError(404, 'channel_not_found')
    if d.get('type', CHAT) != CHAT:
        raise ApiError(400, 'invalid_type')
    if d.get('title', '') != '':
        raise ApiError(400, 'invalid_title')
    if d.get('targetMemberId') is not None:
        raise ApiError(400, 'invalid_target_member_id')
    upload_id = _image_upload_id(d)
    body = inputs.text(d, 'body', CHAT_MAX, required=upload_id is None)
    if not visibility.can_post(membership, channel):
        raise ApiError(403, 'forbidden')
    if not visibility.is_channel_admin(membership, channel):
        hour = datetime.now(timezone.utc).strftime('%Y%m%d%H')
        ctx.repo.count_chat(k, channel_id, ctx.user_id, hour, visibility.chat_hourly_limit(channel))
    message_id, image = _attach(k, ctx.user_id, upload_id)
    item = ctx.repo.put_message(k, channel_id, CHAT, '', body, ctx.user_id, membership.get('displayName', ''),
                                'management' if membership['role'] == 'gabbai' else 'member', None,
                                message_id=message_id, image=image)
    message = _message_json(item)
    ctx.repo.put_change(k, 'message', message['messageId'], channel_id)
    push.enqueue('message', k, message['messageId'])
    return 201, message


def set_chat_settings(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k)
    channel = ctx.repo.get_channel(k, params['c']) if ID_RE.fullmatch(params['c']) else None
    if not visibility.can_read_channel(membership, channel):
        raise ApiError(404, 'channel_not_found')
    if not visibility.is_channel_admin(membership, channel):
        raise ApiError(403, 'forbidden')
    limit = inputs.integer(inputs.body_object(ctx), 'chatHourlyLimit', 0, 200)
    if not channel.get('conversation'):
        raise ApiError(409, 'not_conversation')
    ctx.repo.set_chat_limit(k, params['c'], limit)
    return 200, {}


def _limit(query):
    raw = query.get('limit')
    if raw is None:
        return DEFAULT_LIMIT
    if not raw.isascii() or not raw.isdigit() or not 1 <= int(raw) <= MAX_LIMIT:
        raise ApiError(400, 'invalid_limit')
    return int(raw)


def list_messages(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k)
    limit = _limit(ctx.query)
    before = ctx.query.get('before')
    if before is not None and not ID_RE.fullmatch(before):
        raise ApiError(400, 'invalid_before')
    channels, page = {}, []
    for item in ctx.repo.iter_messages(k, before):
        cid = item['channelId']
        if cid not in channels:
            channels[cid] = ctx.repo.get_channel(k, cid)
        if visibility.message_visible(membership, channels[cid], item):
            page.append(item)
            if len(page) == limit:
                break
    flags = ctx.repo.read_flags(k, ctx.user_id, [i['sk'][len('MSG#'):] for i in page])
    return 200, [_message_json(i, i['sk'][len('MSG#'):] in flags) for i in page]


def get_message(ctx, params):
    membership = require(ctx.repo, ctx.user_id, params['k'])
    item = _visible_message(ctx, params['k'], membership, params['m'])[0]
    return 200, _message_json(item, bool(ctx.repo.read_flags(params['k'], ctx.user_id, [params['m']])))


def list_directory(ctx, params):
    """Names of the members and gabbaim, for choosing a target family. Listeners never see it."""
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, ('member', 'gabbai'))
    channel_id = ctx.query.get('channelId')
    channel = None
    if channel_id is not None:  # only people who could be the target of a blessing in that channel
        if not ID_RE.fullmatch(channel_id):
            raise ApiError(400, 'invalid_channel_id')
        channel = ctx.repo.get_channel(k, channel_id)
        if not visibility.can_read_channel(membership, channel):
            raise ApiError(404, 'channel_not_found')
    rows = [{'userId': m['userId'], 'displayName': m.get('displayName', '')}
            for m in ctx.repo.list_members(k)
            if (visibility.reply_target_ok(m, channel) if channel else m['role'] in ('member', 'gabbai'))]
    return 200, sorted(rows, key=lambda r: r['displayName'])


def remove_message(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k)
    message, _ = _visible_message(ctx, k, membership, params['m'])
    if membership['role'] != 'gabbai' and message['authorId'] != ctx.user_id:
        raise ApiError(403, 'forbidden')
    if message.get('image'):  # first: a failure leaves the message, so a retry still finds the image to delete
        media.delete_image(k, params['m'])
    ctx.repo.remove_message(k, params['m'])
    ctx.repo.put_change(k, 'message_removed', params['m'], message['channelId'])
    return 204, None


def join(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, ('member', 'gabbai'))
    message, _ = _visible_message(ctx, k, membership, params['m'])
    count, joined = ctx.repo.join_message(k, params['m'], ctx.user_id)
    if joined:
        ctx.repo.put_change(k, 'join', params['m'], message['channelId'])
    return 200, {'joinCount': count, 'joined': True}


def read(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k)
    message, _ = _visible_message(ctx, k, membership, params['m'])
    ctx.repo.put_read(k, params['m'], ctx.user_id)
    ctx.repo.put_change(k, 'read', params['m'], message['channelId'], [ctx.user_id])
    return 204, None


def _reply_json(item):
    return {'replyId': item['sk'][len('R#'):], 'authorId': item['authorId'], 'authorName': item['authorName'],
            'body': item['body'], 'createdAt': int(item.get('createdAt', 0))}


def post_reply(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, ('member', 'gabbai'))
    message, channel = _visible_message(ctx, k, membership, params['m'])
    target = message.get('targetMemberId')
    if not target:
        raise ApiError(409, 'replies_not_allowed')
    if target == ctx.user_id:
        raise ApiError(409, 'cannot_reply_to_own')
    if not visibility.reply_target_ok(ctx.repo.get_membership(k, target), channel):
        # left, removed, deleted or no longer in the channel's groups: nobody would receive it
        raise ApiError(409, 'target_left')
    body = inputs.text(inputs.body_object(ctx), 'body', REPLY_MAX, required=True)
    item, counted = ctx.repo.put_reply(k, params['m'], ctx.user_id, membership.get('displayName', ''), body)
    reply = _reply_json(item)
    ctx.repo.put_change(k, 'reply', reply['replyId'], message['channelId'], [ctx.user_id, target],
                        message_id=params['m'])
    if counted:  # channel-scoped, no visibleTo: the feed serves the message JSON, never the reply
        ctx.repo.put_change(k, 'reply_count', params['m'], message['channelId'])
    push.enqueue('reply', k, params['m'])  # ref = messageId: the target is on the message
    return 201, reply


def list_replies(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k)
    message, _ = _visible_message(ctx, k, membership, params['m'])
    return 200, [_reply_json(r) for r in ctx.repo.list_replies(k, params['m'])
                 if visibility.reply_visible(ctx.user_id, message, r)]
