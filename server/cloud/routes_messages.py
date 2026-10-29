"""Routes: channels, messages, joining a blessing and read receipts. Visibility comes from visibility.py."""
import time
from datetime import datetime, timezone

from . import families, inputs, media, private_replies, message_fields, push, schedule_rules, sheet_items, type_rules, visibility
from . import authz
from .errors import ApiError
from .families import family_name
from .ids import ID_RE, new_id
from .repo_messages import BUMP_TTL, NOTIFY_WINDOW, local_date
from .routes_admin import _channel_json

TYPES = type_rules.TYPES  # ('weekly', 'event', 'general', 'celebration', 'condolence')
TARGET_TYPES = ('celebration', 'condolence')
DEFAULT_LIMIT, MAX_LIMIT = 20, 50
REPLY_MAX = 1000
CHAT = 'chat'
CHAT_MAX = 1000
CHAT_HOURLY_LIMIT = 30
# NOTIFY_WINDOW (12 h): one notified update (move up, unread again, quiet push) per message in that time


def _now() -> int:
    """Unix seconds; the one clock of the update and read routes."""
    return int(time.time())


def _message_json(item, read=None, viewer=None):
    out = {'messageId': item['sk'][len('MSG#'):], 'channelId': item['channelId'], 'type': item['type'],
           'title': item['title'], 'body': item['body'], 'authorId': item['authorId'],
           'authorName': item['authorName'], 'authorKind': item['authorKind'],
           'joinCount': int(item.get('joinCount', 0))}
    if item.get('targetMemberId'):
        out['targetMemberId'] = item['targetMemberId']
        out['targetName'] = item.get('targetName', '')
        if item.get('targetFamilyId'):
            out['targetFamilyId'] = item['targetFamilyId']
        out['replierCount'] = int(item.get('replierCount', 0))  # a count only: never who or what
    if item.get('templateId'):
        out['templateId'] = item['templateId']
        out['fields'] = schedule_rules.plain(item.get('fields', {}))
    if item.get('updatedAt') is not None:
        out['updatedAt'] = int(item['updatedAt'])
    if item.get('changed'):
        out['changed'] = schedule_rules.plain(item['changed'])
    if item.get('bumpId'):
        out['bumpId'] = item['bumpId']
    if item.get('image'):  # metadata only: the URL comes from GET .../image after a visibility check
        out['image'] = {'contentType': item['image']['contentType'], 'bytes': int(item['image']['bytes'])}
    if viewer:
        out.update(viewer)
        out.setdefault('replierCount', int(item.get('replierCount', 0)))
    if read is not None:
        out['read'] = read
    return out


def kehila_rules(ctx, k):
    """The Kehila's type rules; load once per request."""
    return type_rules.rules((ctx.repo.get_kehila(k) or {}).get('settings', {}))


def _visible_message(ctx, k, membership, message_id):
    """The message and its channel, or 404 message_not_found: hidden and missing look the same."""
    message = ctx.repo.get_message(k, message_id) if ID_RE.fullmatch(message_id) else None
    channel = ctx.repo.get_channel(k, message['channelId']) if message else None
    if not message or not visibility.message_visible(membership, channel, message, kehila_rules(ctx, k)):
        raise ApiError(404, 'message_not_found')
    return message, channel


def list_channels(ctx, params):
    membership = authz.require(ctx.repo, ctx.user_id, params['k'], authz.ALL)
    is_management = visibility.is_management(membership)
    rules = kehila_rules(ctx, params['k'])
    channels = [{**_channel_json(c, is_management, visibility.is_channel_admin(membership, c)),
                 'canPost': visibility.can_post(membership, c),
                 'postableTypes': type_rules.postable_types(membership, c, rules),
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
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ALL)
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
    template_id, fields = _template(d, type_)
    target = d.get('targetMemberId')
    target_membership = None
    if target is not None:
        if type_ not in TARGET_TYPES or not isinstance(target, str) or not ID_RE.fullmatch(target):
            raise ApiError(400, 'invalid_target_member_id')
        target_membership = ctx.repo.get_membership(k, target)
        if not authz.role_in(target_membership, authz.ADULTS):
            raise ApiError(400, 'invalid_target_member_id')
    channel = ctx.repo.get_channel(k, channel_id)
    if not visibility.can_read_channel(membership, channel):
        raise ApiError(404, 'channel_not_found')
    if target and not visibility.reply_target_ok(target_membership, channel):
        raise ApiError(400, 'invalid_target_member_id')
    target_family_id = _target_family_id(ctx, k, d, target)
    kehila = ctx.repo.get_kehila(k)
    settings = kehila.get('settings', {})
    if not visibility.can_post(membership, channel, type_, type_rules.rules(settings)):
        raise ApiError(403, 'forbidden')
    if not authz.role_in(membership, authz.MANAGEMENT):
        limit = settings.get('broadcastDailyLimit', 3)
        ctx.repo.count_broadcast(k, ctx.user_id, local_date(), int(limit))
    message_id, image = _attach(k, ctx.user_id, upload_id)
    item = ctx.repo.put_message(k, channel_id, type_, title, body, ctx.user_id, membership.get('displayName', ''),
                                'management' if authz.role_in(membership, authz.MANAGEMENT) else 'member', target,
                                target_membership.get('displayName', '') if target else '',
                                message_id=message_id, image=image, target_family_id=target_family_id,
                                template_id=template_id, fields=fields)
    sheet_items.on_post(ctx.repo, k, membership, settings, item, sheet_items._now())
    mid = item['sk'][len('MSG#'):]
    viewer = private_replies.viewer_fields(ctx.repo, k, ctx.user_id, membership, [item], {channel_id: channel},
                                           families.TargetMemo(ctx.repo, k))[mid]
    message = _message_json(item, viewer=viewer)
    ctx.repo.put_change(k, 'message', message['messageId'], channel_id)
    push.enqueue('message', k, message['messageId'])
    return 201, message


def _template(d, type_):
    """(templateId, fields) or (None, None). templateId must be the template of the type, and fields come with it."""
    if 'templateId' not in d and 'fields' not in d:
        return None, None
    template_id = inputs.choice(d, 'templateId', message_fields.TEMPLATE_IDS) if 'templateId' in d else None
    if template_id is None or template_id != message_fields.TEMPLATE_OF_TYPE.get(type_) or 'fields' not in d:
        raise ApiError(400, 'invalid_template_id')
    return template_id, message_fields.validate_fields(template_id, d['fields'])


def _target_family_id(ctx, k, d, target):
    """The optional targetFamilyId: a ULID of a family of which `target` is a live adult."""
    value = d.get('targetFamilyId')
    if value is None:  # default to the target's family now, so the family replies outlive the target adult
        family = ctx.repo.family_of(k, target) if target else None
        return family['familyId'] if family else None
    if not target or not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise ApiError(400, 'invalid_target_family_id')
    family = ctx.repo.get_family(k, value)
    if not family or target not in [m['userId'] for m in ctx.repo.live_adults(k, family)]:
        raise ApiError(400, 'invalid_target_family_id')
    return value


def _post_chat(ctx, k, membership, channel_id, channel, d):
    if not visibility.can_read_channel(membership, channel):
        raise ApiError(404, 'channel_not_found')
    if d.get('type', CHAT) != CHAT:
        raise ApiError(400, 'invalid_type')
    if d.get('title', '') != '':
        raise ApiError(400, 'invalid_title')
    if d.get('targetMemberId') is not None:
        raise ApiError(400, 'invalid_target_member_id')
    if d.get('targetFamilyId') is not None:
        raise ApiError(400, 'invalid_target_family_id')
    upload_id = _image_upload_id(d)
    body = inputs.text(d, 'body', CHAT_MAX, required=upload_id is None)
    if not visibility.can_post(membership, channel):
        raise ApiError(403, 'forbidden')
    if not visibility.is_channel_admin(membership, channel):
        hour = datetime.now(timezone.utc).strftime('%Y%m%d%H')
        ctx.repo.count_chat(k, channel_id, ctx.user_id, hour, visibility.chat_hourly_limit(channel))
    message_id, image = _attach(k, ctx.user_id, upload_id)
    item = ctx.repo.put_message(k, channel_id, CHAT, '', body, ctx.user_id, membership.get('displayName', ''),
                                'management' if authz.role_in(membership, authz.MANAGEMENT) else 'member', None,
                                message_id=message_id, image=image)
    message = _message_json(item)
    ctx.repo.put_change(k, 'message', message['messageId'], channel_id)
    push.enqueue('message', k, message['messageId'])
    return 201, message


def set_chat_settings(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ALL)
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
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ALL)
    limit = _limit(ctx.query)
    before = ctx.query.get('before')
    if before is not None and not ID_RE.fullmatch(before):
        raise ApiError(400, 'invalid_before')
    rules = kehila_rules(ctx, k)
    channels, page = {}, []
    for item in ctx.repo.iter_messages(k, before):
        cid = item['channelId']
        if cid not in channels:
            channels[cid] = ctx.repo.get_channel(k, cid)
        if visibility.message_visible(membership, channels[cid], item, rules):
            page.append(item)
            if len(page) == limit:
                break
    if before is None:
        page = _merge_bumps(ctx, k, membership, rules, channels, page, limit)
    ids = [i['sk'][len('MSG#'):] for i in page]
    times = ctx.repo.read_times(k, ctx.user_id, ids)
    viewer = private_replies.viewer_fields(ctx.repo, k, ctx.user_id, membership, page, channels,
                                           families.TargetMemo(ctx.repo, k))
    return 200, [_message_json(i, _is_read(times.get(m), i), viewer[m]) for i, m in zip(page, ids)]


def _is_read(read_at, item) -> bool:
    """Read since the last notified update: a bump makes earlier reads stale."""
    return read_at is not None and read_at >= int(item.get('bumpedAt', 0))


def _merge_bumps(ctx, k, membership, rules, channels, page, limit):
    """The first page plus the visible, live messages whose bump is newer than the page's oldest message, sorted
    by `bumpId or messageId`, newest first. The page may exceed `limit` by the merged ones."""
    on_page = {i['sk'][len('MSG#'):] for i in page}
    oldest = page[-1]['sk'][len('MSG#'):] if len(page) >= limit else None  # a short page holds every message
    merged = []
    for bump in ctx.repo.list_bumps_after(k, oldest):
        mid = bump['messageId']
        if mid in on_page:
            continue
        on_page.add(mid)
        item = ctx.repo.get_message(k, mid)
        if not item or item.get('removed'):
            continue
        if item['channelId'] not in channels:
            channels[item['channelId']] = ctx.repo.get_channel(k, item['channelId'])
        if visibility.message_visible(membership, channels[item['channelId']], item, rules):
            merged.append(item)
    if not merged and not any(i.get('bumpId') for i in page):
        return page
    return sorted(page + merged, key=lambda i: i.get('bumpId') or i['sk'][len('MSG#'):], reverse=True)


def get_message(ctx, params):
    membership = authz.require(ctx.repo, ctx.user_id, params['k'], authz.ALL)
    k = params['k']
    item, channel = _visible_message(ctx, k, membership, params['m'])
    viewer = private_replies.viewer_fields(ctx.repo, k, ctx.user_id, membership, [item], {item['channelId']: channel},
                                           families.TargetMemo(ctx.repo, k))[params['m']]
    read_at = ctx.repo.read_times(k, ctx.user_id, [params['m']]).get(params['m'])
    out = _message_json(item, _is_read(read_at, item), viewer)
    out.update(private_replies.detail_fields(ctx.repo, k, ctx.user_id, item, channel))
    if authz.role_in(membership, authz.MANAGEMENT) and item.get('history'):  # never in lists or the change feed
        out['history'] = [{'title': h['title'], 'body': h['body'], 'at': int(h['at'])} for h in item['history']]
    return 200, out


UPDATABLE_TYPES = ('event', 'condolence')


def _may_update(ctx, k, membership, message):
    """Management, the author, or (a condolence) an adult of the family it is for, from the family's live adults
    now. Not families.target_adults, whose fallbacks would widen the set."""
    if authz.role_in(membership, authz.MANAGEMENT) or message['authorId'] == ctx.user_id:
        return True
    if message['type'] != 'condolence' or not message.get('targetFamilyId'):
        return False
    family = ctx.repo.get_family(k, message['targetFamilyId'])
    return bool(family) and ctx.user_id in {m['userId'] for m in ctx.repo.live_adults(k, family)}


def _notify(ctx, k, mid, item, stamp) -> bool:
    """Move the message up once, make earlier reads stale and queue one quiet push, unless one was notified in the
    last NOTIFY_WINDOW. The updater has read their own update. `item` gains the bump attributes."""
    bump_id = new_id()
    if not ctx.repo.mark_notified(k, mid, stamp, bump_id):
        return False
    ctx.repo.put_bump(k, bump_id, mid, stamp + BUMP_TTL)
    ctx.repo.put_read(k, mid, ctx.user_id, at=stamp)
    item.update({'notifiedAt': stamp, 'bumpId': bump_id, 'bumpedAt': stamp})
    push.enqueue('message_update', k, mid)
    return True


def update_message(ctx, params):
    k, mid = params['k'], params['m']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ADULTS)
    before, channel = _visible_message(ctx, k, membership, mid)
    if not _may_update(ctx, k, membership, before):
        raise ApiError(403, 'forbidden')
    if before['type'] not in UPDATABLE_TYPES:
        raise ApiError(409, 'not_updatable')
    d = inputs.body_object(ctx)
    title = inputs.text(d, 'title', 120, required=True)
    body = inputs.text(d, 'body', 4000)
    template_id = message_fields.TEMPLATE_OF_TYPE[before['type']]
    fields = message_fields.validate_fields(template_id, d.get('fields'))
    notify = inputs.boolean(d, 'notify')
    first = schedule_rules.plain(before.get('firstFields') or before.get('fields') or fields)
    changed = message_fields.event_changes(first, fields) if before['type'] == 'event' else {}
    now = sheet_items._now()  # the sheet week maths only
    stamp = _now()
    seen = int(before['updatedAt']) if before.get('updatedAt') is not None else None
    entry = {'title': before['title'], 'body': before['body'], 'at': int(before.get('updatedAt') or 0) or stamp,
             'by': before.get('updatedBy') or before['authorId']}
    item = ctx.repo.update_message(k, mid, title=title, body=body, template_id=template_id, fields=fields,
                                   first_fields=first, changed=changed, history_entry=entry, updated_by=ctx.user_id,
                                   now=stamp, seen_updated_at=seen)
    sheet_items.on_update(ctx.repo, k, before, item, now)
    notified = notify is True and _notify(ctx, k, mid, item, stamp)
    ctx.repo.put_change(k, 'message', mid, item['channelId'])
    viewer = private_replies.viewer_fields(ctx.repo, k, ctx.user_id, membership, [item], {item['channelId']: channel},
                                           families.TargetMemo(ctx.repo, k))[mid]
    return 200, {**_message_json(item, viewer=viewer), 'notified': notified}


def list_directory(ctx, params):
    """Names of the members and gabbaim, for choosing a target family. Listeners never see it."""
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ADULTS)
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
            if (visibility.reply_target_ok(m, channel) if channel else authz.role_in(m, authz.ADULTS))]
    return 200, sorted(rows, key=lambda r: r['displayName'])


def list_target_families(ctx, params):
    """Families that can be the target of a blessing in a channel: at least one live adult who may read it."""
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ADULTS)
    channel_id = ctx.query.get('channelId')
    if channel_id is None or not ID_RE.fullmatch(channel_id):
        raise ApiError(400, 'invalid_channel_id')
    channel = ctx.repo.get_channel(k, channel_id)
    if not visibility.can_read_channel(membership, channel):
        raise ApiError(404, 'channel_not_found')
    rows = []
    for family in ctx.repo.list_families(k):
        live = ctx.repo.live_adults(k, family)
        reachable = [m for m in live if visibility.reply_target_ok(m, channel)]
        if not reachable:
            continue
        profiles = [ctx.repo.get_profile(m['userId']) or {} for m in live]
        rows.append({'familyId': family['familyId'], 'name': family_name(profiles),
                     'firstNames': [p.get('firstName', '') for p in profiles],
                     'targetMemberId': reachable[0]['userId']})
    return 200, sorted(rows, key=lambda r: r['name'])


def remove_message(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ALL)
    message, _ = _visible_message(ctx, k, membership, params['m'])
    if not authz.role_in(membership, authz.MANAGEMENT) and message['authorId'] != ctx.user_id:
        raise ApiError(403, 'forbidden')
    if message.get('image'):  # first: a failure leaves the message, so a retry still finds the image to delete
        media.delete_image(k, params['m'])
    ctx.repo.remove_message(k, params['m'])
    ctx.repo.delete_replies(k, params['m'])  # replies, markers and the thread index go with the message
    sheet_items.on_remove(ctx.repo, k, message)
    ctx.repo.put_change(k, 'message_removed', params['m'], message['channelId'])
    return 204, None


def join(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ADULTS)
    message, _ = _visible_message(ctx, k, membership, params['m'])
    count, joined = ctx.repo.join_message(k, params['m'], ctx.user_id)
    if joined:
        ctx.repo.put_change(k, 'join', params['m'], message['channelId'])
    return 200, {'joinCount': count, 'joined': True}


def read(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ALL)
    message, _ = _visible_message(ctx, k, membership, params['m'])
    ctx.repo.put_read(k, params['m'], ctx.user_id, at=_now())
    ctx.repo.put_change(k, 'read', params['m'], message['channelId'], [ctx.user_id])
    return 204, None


def _reply_json(item, caller, message, seen=None, names=None):
    """The reply as `caller` may see it. `seen` is the caller's read watermark on the message (a replyId or None);
    `names` maps a chosen adult's userId to the current displayName (the writer's own choice only)."""
    to = item.get('to') or 'family'  # a reply stored before `to` existed went to the family
    out = {'replyId': item['sk'][len('R#'):], 'authorId': item['authorId'], 'authorName': item['authorName'],
           'body': item['body'], 'createdAt': int(item.get('createdAt', 0)), 'to': to}
    if item.get('updatedAt') is not None:
        out['updatedAt'] = int(item['updatedAt'])
    if item['authorId'] == caller:
        if to not in ('author', 'family'):
            out['toName'] = (names or {}).get(to, '')
    else:
        out['personal'] = to == caller
        out['unread'] = item['sk'][len('R#'):] > (seen or '')
    return out


def _recipients(ctx, k, message, reply):
    return private_replies.recipients(ctx.repo, k, message, reply)


def _visible_replies(ctx, k, message, caller):
    """The replies of the message that `caller` may read, oldest first."""
    adults = families.target_adults(ctx.repo, k, message)
    return [r for r in ctx.repo.list_replies(k, message['sk'][len('MSG#'):])
            if visibility.reply_visible(caller, message, r, adults)]


def _routed(ctx, k, params, membership):
    """(message, channel, reply route) for a reply write."""
    message, channel = _visible_message(ctx, k, membership, params['m'])
    return message, channel, private_replies.reply_route(message, channel)


def _choose_to(d, route, reachable):
    """The stored `to` of a new reply, or 400 invalid_to."""
    value = d.get('to')
    if value is None:  # omitted or null: the route's default
        return route
    if not isinstance(value, str):
        raise ApiError(400, 'invalid_to')
    if value == route:
        return route
    if route == 'family' and value in {m['userId'] for m in reachable}:
        return value if len(reachable) > 1 else route  # one adult: nobody to choose between, it is the family's
    raise ApiError(400, 'invalid_to')


def post_reply(ctx, params):
    k, mid = params['k'], params['m']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ADULTS)
    message, channel, route = _routed(ctx, k, params, membership)
    if not route:
        raise ApiError(409, 'replies_not_allowed')
    memo = families.TargetMemo(ctx.repo, k)
    if ctx.user_id == message['authorId'] or (route == 'family' and ctx.user_id in memo.adults(message)):
        raise ApiError(409, 'cannot_reply_to_own')
    reachable = []
    if route == 'author':
        if not visibility.reply_target_ok(ctx.repo.get_membership(k, message['authorId']), channel):
            raise ApiError(409, 'author_left')
    else:
        reachable = families.ordered_reachable_adults(ctx.repo, k, message, channel)
        if not reachable:
            # everyone left, was removed, deleted or is no longer in the channel's groups: nobody would receive it
            raise ApiError(409, 'target_left')
    d = inputs.body_object(ctx)
    to = _choose_to(d, route, reachable)
    body = inputs.text(d, 'body', REPLY_MAX, required=True)
    personal = private_replies.personal_to({'to': to})
    ctx.repo.touch_thread(k, mid, message, route, personal)
    item = ctx.repo.put_reply(k, mid, ctx.user_id, membership.get('displayName', ''), body, to)
    ctx.repo.put_change(k, 'reply', item['sk'][len('R#'):], message['channelId'],
                        [ctx.user_id, *_recipients(ctx, k, message, item)], message_id=mid)
    ctx.repo.put_change(k, 'reply_count', mid, message['channelId'])  # no visibleTo: the feed serves a count only
    reply_id = item['sk'][len('R#'):]
    push.enqueue('reply', k, f'{mid}/{reply_id}')
    names = private_replies.to_names(ctx.repo, k, ctx.user_id, [item])
    return 201, _reply_json(item, ctx.user_id, message, names=names)


def list_replies(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ALL)
    message, _ = _visible_message(ctx, k, membership, params['m'])
    replies = _visible_replies(ctx, k, message, ctx.user_id)
    seen = ctx.repo.seen_marks(k, ctx.user_id, [params['m']]).get(params['m'])
    names = private_replies.to_names(ctx.repo, k, ctx.user_id, replies)
    return 200, [_reply_json(r, ctx.user_id, message, seen, names) for r in replies]


def _own_reply(ctx, k, params, membership):
    """(message, reply) when the caller wrote it; otherwise 404 reply_not_found: another's reply and a missing
    one look the same."""
    message, _ = _visible_message(ctx, k, membership, params['m'])
    reply = ctx.repo.get_reply(k, params['m'], params['r']) if ID_RE.fullmatch(params['r']) else None
    if not reply or reply['authorId'] != ctx.user_id:
        raise ApiError(404, 'reply_not_found')
    return message, reply


def put_reply(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ADULTS)
    message, reply = _own_reply(ctx, k, params, membership)
    body = inputs.text(inputs.body_object(ctx), 'body', REPLY_MAX, required=True)  # `to` in the request is ignored
    item = ctx.repo.update_reply(k, params['m'], params['r'], ctx.user_id, body)
    ctx.repo.put_change(k, 'reply', params['r'], message['channelId'],
                        [ctx.user_id, *_recipients(ctx, k, message, item)], message_id=params['m'])
    names = private_replies.to_names(ctx.repo, k, ctx.user_id, [item])
    return 200, _reply_json(item, ctx.user_id, message, names=names)


def delete_reply(ctx, params):
    """The writer may always withdraw: no role or visibility check beyond being a member, because losing access
    to the message must not leave a reply nobody can remove. Others get the same 404 as for a missing reply."""
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.ALL)
    message = ctx.repo.get_message(k, params['m']) if ID_RE.fullmatch(params['m']) else None
    reply = ctx.repo.get_reply(k, params['m'], params['r']) if message and ID_RE.fullmatch(params['r']) else None
    if not reply or reply['authorId'] != ctx.user_id:
        raise ApiError(404, 'reply_not_found')
    visible_to = [ctx.user_id, *_recipients(ctx, k, message, reply)]
    if not ctx.repo.delete_reply(k, params['m'], reply['sk'], ctx.user_id):  # settles the count (and its change) too
        raise ApiError(404, 'reply_not_found')
    ctx.repo.put_change(k, 'reply_removed', params['r'], message['channelId'], visible_to, message_id=params['m'])
    return 204, None


def read_replies(ctx, params):
    """Move the caller's read watermark up to `upTo`, but only over replies they received. Anyone else gets the
    same 204 and nothing is written."""
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ALL)
    message, _ = _visible_message(ctx, k, membership, params['m'])
    up_to = inputs.body_object(ctx).get('upTo')
    if not isinstance(up_to, str) or not ID_RE.fullmatch(up_to):
        raise ApiError(400, 'invalid_up_to')
    received = [r['sk'][len('R#'):] for r in _visible_replies(ctx, k, message, ctx.user_id)
                if r['authorId'] != ctx.user_id and r['sk'][len('R#'):] <= up_to]
    if received:
        ctx.repo.mark_seen(k, ctx.user_id, params['m'], max(received))
    return 204, None


def inbox(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ADULTS)
    threads = private_replies.inbox_threads(ctx.repo, k, ctx.user_id, membership)
    return 200, {'unread': sum(t['unread'] for t in threads), 'threads': threads}
