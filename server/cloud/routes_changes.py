"""Routes: the change feed and notification preferences. Visibility comes from visibility.py."""
import time

from . import families, inputs, private_replies, visibility
from . import authz
from .errors import ApiError
from .ids import ID_RE, floor_id, id_time_ms
from .routes_messages import TYPES, _message_json, _reply_json, kehila_rules

PAGE = 200
HOLD_BACK_MS = 2000  # changes younger than this wait for the next poll: IDs come from skewed clocks and commit late
RESYNC_AFTER = 30 * 86400
BROADCAST_MODES = ('all', 'management_only')
MAX_LIST = 100


def _now_ms():
    return int(time.time() * 1000)


def _item(ctx_user, membership, channels, change, messages, replies, adults=frozenset(), rules=None, viewer=None,
          seen=None, names=None):
    """The current visible object for a change, or None to skip it.

    A `message` or `join` whose message was removed since is skipped: the `message_removed` change that the
    removal logged reports it, and carries only the id."""
    kind, ref = change['kind'], change['refId']
    if kind == 'message_removed':
        return {'id': ref}
    if kind == 'reply_removed':  # an id only: change_visible already limited it to the writer and the recipients
        return {'id': ref, 'messageId': change['messageId']}
    message = messages.get(change.get('messageId', ref))
    if not message or not visibility.message_visible(membership, channels.get(message['channelId']), message, rules):
        return None
    if kind in ('message', 'join', 'reply_count'):
        return _message_json(message, viewer=(viewer or {}).get(change.get('messageId', ref)))
    if kind == 'read':
        return {'messageId': ref}
    if kind == 'reply':
        reply = replies.get(ref)
        if not reply or not visibility.reply_visible(ctx_user, message, reply, adults):
            return None
        mid = change['messageId']
        return {**_reply_json(reply, ctx_user, message, (seen or {}).get(mid), names), 'messageId': mid}
    return None


def changes(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ALL)
    since = ctx.query.get('since')
    bound = floor_id(_now_ms() - HOLD_BACK_MS)  # nothing at or after this ID is scanned, nor may a cursor pass it
    if since is None:
        return 200, {'cursor': bound, 'more': False, 'changes': []}
    if not isinstance(since, str) or not ID_RE.fullmatch(since):
        raise ApiError(400, 'invalid_since')
    if id_time_ms(since) < (time.time() - RESYNC_AFTER) * 1000:
        return 200, {'resync': True}
    if since >= bound:
        return 200, {'cursor': bound, 'more': False, 'changes': []}
    scanned = ctx.repo.list_changes_after(k, since, bound, PAGE + 1)
    more = len(scanned) > PAGE
    scanned = scanned[:PAGE]
    if not scanned:
        return 200, {'cursor': since, 'more': False, 'changes': []}  # since < bound here
    channels = {c['sk'][2:]: c for c in ctx.repo.list_channels(k)}
    # a reply is checked below, once its message and the reply itself are loaded: its `to` decides who may pass
    allowed = [c for c in scanned if c['kind'] in ('message', 'message_removed', 'join', 'read', 'reply', 'reply_count',
                                                   'reply_removed')
               and (visibility.can_read_channel(membership, channels.get(c.get('channelId')))
                    if c['kind'] == 'reply' else visibility.change_visible(ctx.user_id, membership, channels, c))]
    keys = []
    for c in allowed:
        if c['kind'] not in ('message_removed', 'reply_removed'):
            keys.append((f'K#{k}', f"MSG#{c.get('messageId', c['refId'])}"))
        if c['kind'] == 'reply':
            keys.append((f"K#{k}#MSG#{c['messageId']}", f"R#{c['refId']}"))
    found = ctx.repo.batch_get(keys)
    messages = {pk_sk[1][len('MSG#'):]: v for pk_sk, v in found.items() if pk_sk[1].startswith('MSG#')}
    replies = {pk_sk[1][len('R#'):]: v for pk_sk, v in found.items() if pk_sk[1].startswith('R#')}
    rules = kehila_rules(ctx, k)  # once per request
    memo = families.TargetMemo(ctx.repo, k)
    shown = {}
    for c in allowed:
        if c['kind'] in ('message', 'join', 'reply_count') and messages.get(c['refId']):
            shown[c['refId']] = messages[c['refId']]
    viewer = private_replies.viewer_fields(ctx.repo, k, ctx.user_id, membership, list(shown.values()), channels, memo)
    reply_ids = [c['messageId'] for c in allowed if c['kind'] == 'reply']
    seen = ctx.repo.seen_marks(k, ctx.user_id, reply_ids) if reply_ids else {}
    names = private_replies.to_names(ctx.repo, k, ctx.user_id, list(replies.values()))
    out, family_adults = [], {}
    for c in allowed:
        adults = frozenset()
        if c['kind'] == 'reply':
            message, reply = messages.get(c['messageId']), replies.get(c['refId'])
            if not message or not reply:
                continue
            if (reply.get('to') or 'family') == 'family':  # a partner linked later: family replies only
                if c['messageId'] not in family_adults:  # once per distinct message on the page
                    family_adults[c['messageId']] = families.target_adults(ctx.repo, k, message)
                adults = family_adults[c['messageId']]
            if not visibility.change_visible(ctx.user_id, membership, channels, c, adults):
                continue
        item = _item(ctx.user_id, membership, channels, c, messages, replies, adults, rules, viewer, seen, names)
        if item is not None:
            out.append({'kind': c['kind'], 'id': c['refId'], 'item': item})
    return 200, {'cursor': scanned[-1]['sk'][len('CHG#'):], 'more': more, 'changes': out}


def _id_list(d, field, valid):
    """Optional list of at most 100 distinct strings that all pass `valid`; returns the de-duplicated list."""
    value = d[field]
    if not isinstance(value, list) or len(value) > MAX_LIST:
        raise ApiError(400, inputs._code(field))
    if not all(isinstance(v, str) for v in value):
        raise ApiError(400, inputs._code(field))
    value = list(dict.fromkeys(value))
    if not valid(value):
        raise ApiError(400, inputs._code(field))
    return value


def put_notify(ctx, params):
    """Push preferences only (spec 3a): they never change what the feed or the lists return.

    Listeners may set them, but only for channels they can read; they cannot name members (the member list is
    hidden from them, so validating member ids would be a membership oracle). Only the fields sent change."""
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ALL)
    d = inputs.body_object(ctx)
    known = ('mutedChannels', 'mutedTypes', 'membersBroadcasts', 'mutedMembers', 'chatChannels', 'seatReminders')
    if not any(f in d for f in known):
        raise ApiError(400, 'invalid_body')
    new = {}
    if 'mutedChannels' in d:
        def channels_ok(values):
            readable = {c['sk'][2:] for c in ctx.repo.list_channels(k) if visibility.can_read_channel(membership, c)}
            return all(v in readable for v in values)
        new['mutedChannels'] = _id_list(d, 'mutedChannels', channels_ok)
    if 'chatChannels' in d:
        def chat_ok(values):
            chats = {c['sk'][2:] for c in ctx.repo.list_channels(k)
                     if c.get('conversation') and visibility.can_read_channel(membership, c)}
            return all(v in chats for v in values)
        new['chatChannels'] = _id_list(d, 'chatChannels', chat_ok)
    if 'mutedTypes' in d:
        new['mutedTypes'] = _id_list(d, 'mutedTypes', lambda values: all(v in TYPES for v in values))
    if 'membersBroadcasts' in d:
        new['membersBroadcasts'] = inputs.choice(d, 'membersBroadcasts', BROADCAST_MODES)
    if 'mutedMembers' in d:
        def members_ok(values):
            if authz.role_in(membership, authz.LISTENER_ONLY):
                return not values
            if not all(ID_RE.fullmatch(v) for v in values):
                return False
            found = ctx.repo.batch_get([(f'K#{k}', f'M#{v}') for v in values])
            return all(authz.role_in(i, authz.ADULTS) for i in found.values()) and len(found) == len(values)
        new['mutedMembers'] = _id_list(d, 'mutedMembers', members_ok)
    if 'seatReminders' in d:
        if not isinstance(d['seatReminders'], bool):
            raise ApiError(400, 'invalid_seat_reminders_pref')
        new['seatReminders'] = d['seatReminders']
    ctx.repo.set_notify(k, ctx.user_id, {**membership.get('notify', {}), **new})
    return 200, {}
