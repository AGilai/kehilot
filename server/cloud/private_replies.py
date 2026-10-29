"""Private replies: who may answer a message and what a viewer sees of it (docs/UX-DESIGN.md §22).

`reply_route` is the one rule. `viewer_fields` rides on every message JSON; `detail_fields` (single GET only)
adds the reads that need reachability checks. Names and reply text never go to logs."""
import logging

from . import authz, families, visibility
from .errors import ApiError

log = logging.getLogger(__name__)
MIN_REMAINING_MS = 3000

AUTHOR_TYPES = ('general', 'event')
FAMILY_TYPES = ('celebration', 'condolence')
AUTHOR_KIND = 'member'  # the stored authorKind of a member-written message (management posts store 'management')


def reply_route(message, channel):
    """'author', 'family' or None: where a private reply to this message goes."""
    if message.get('removed') or not visibility.whole_kehila_channel(channel):
        return None
    type_ = message.get('type')
    if type_ in AUTHOR_TYPES:
        return 'author' if message.get('authorKind') == AUTHOR_KIND else None
    if type_ in FAMILY_TYPES:
        return 'family' if message.get('targetMemberId') else None
    return None


def _flags(user_id, membership, message, route, memo):
    is_recipient = (user_id == message.get('authorId') if route == 'author'
                    else user_id in memo.adults(message))
    can_reply = authz.role_in(membership, authz.ADULTS) and not is_recipient and user_id != message.get('authorId')
    return is_recipient, can_reply


def viewer_fields(repo, k, user_id, membership, items, channels, memo):
    """{messageId: {replyTo, canReply, isRecipient, replied}} for the messages that have a route; {} for the rest."""
    out, routed = {}, []
    for item in items:
        mid = item['sk'][len('MSG#'):]
        route = reply_route(item, channels.get(item.get('channelId')))
        if not route:
            out[mid] = {}
            continue
        is_recipient, can_reply = _flags(user_id, membership, item, route, memo)
        out[mid] = {'replyTo': route, 'canReply': can_reply, 'isRecipient': is_recipient, 'replied': False}
        routed.append(mid)
    if routed:
        found = repo.batch_get([(f'K#{k}#MSG#{m}', f'RP#{user_id}') for m in routed])
        for pk, _ in found:
            out[pk[len(f'K#{k}#MSG#'):]]['replied'] = True
    return out


def detail_fields(repo, k, user_id, message, channel):
    """Extra fields for GET of one message: replyAdults, and replyBlocked (which also turns canReply off)."""
    route = reply_route(message, channel)
    if not route:
        return {}
    membership = repo.get_membership(k, user_id)
    if not _flags(user_id, membership, message, route, families.TargetMemo(repo, k))[1]:
        return {}
    if route == 'author':
        author = repo.get_membership(k, message['authorId'])
        if not visibility.reply_target_ok(author, channel):
            return {'canReply': False, 'replyBlocked': 'author_left'}
        return {}
    adults = families.ordered_reachable_adults(repo, k, message, channel)
    if not adults:
        return {'canReply': False, 'replyBlocked': 'target_left'}
    return {'replyAdults': [{'userId': m['userId'], 'name': m.get('displayName', '')} for m in adults]}


def personal_to(reply):
    """The chosen adult's userId of a personal reply, else None."""
    to = reply.get('to') or 'family'
    return None if to in ('author', 'family') else to


def to_names(repo, k, user_id, replies):
    """{userId: displayName} for the adults the caller chose in their own personal replies ('' when gone).
    Nobody else's choice is ever looked up."""
    chosen = {personal_to(r) for r in replies if r.get('authorId') == user_id} - {None}
    found = repo.batch_get([(f'K#{k}', f'M#{u}') for u in chosen]) if chosen else {}
    return {u: (found.get((f'K#{k}', f'M#{u}')) or {}).get('displayName', '') for u in chosen}


def recipients(repo, k, message, reply, memo=None):
    """Who receives this reply now, as userIds (never the writer): the author, the chosen adult, or the target
    family's current adults."""
    to = reply.get('to') or 'family'
    if to == 'author':
        recipients_ = {message['authorId']}
    elif to == 'family':
        recipients_ = set((memo or families.TargetMemo(repo, k)).adults(message))
    else:
        recipients_ = {to}
    return sorted(recipients_ - {reply['authorId']})


def inbox_threads(repo, k, user_id, membership, limit=3):
    """The caller's mailbox: [{message, total, unread, personal, replies}], newest visible reply first.
    `total` counts the replies visible to the caller that they did not write; `replies` are those, newest first
    (all of them when `limit` is None). Candidates come from the thread index and every one is re-checked with
    message_visible and reply_visible, so the index grants nothing."""
    from . import routes_messages  # late: routes_messages imports this module
    from . import type_rules
    family = repo.family_of(k, user_id)
    my_family = family['familyId'] if family else None
    my_adults = set(family['adults']) if family else set()
    candidates = []
    for t in repo.list_threads(k):
        if t.get('replyTo') == 'author':
            wanted = t.get('msgAuthorId') == user_id
        else:
            wanted = (t.get('targetFamilyId') is not None and t.get('targetFamilyId') == my_family) \
                or t.get('targetMemberId') in my_adults
        if wanted or user_id in (t.get('personalTo') or ()):
            candidates.append(t['sk'][len('MSG#'):])
    if not candidates:
        return []
    found = repo.batch_get([(f'K#{k}', f'MSG#{m}') for m in candidates])
    messages = {sk[len('MSG#'):]: item for (_, sk), item in found.items()}
    channels = {c['sk'][2:]: c for c in repo.list_channels(k)}
    rules = type_rules.rules((repo.get_kehila(k) or {}).get('settings', {}))
    memo = families.TargetMemo(repo, k)
    seen = repo.seen_marks(k, user_id, candidates)
    rows = []
    for mid in candidates:
        message = messages.get(mid)
        if not message or not visibility.message_visible(membership, channels.get(message['channelId']), message, rules):
            continue
        adults = memo.adults(message)
        received = [r for r in repo.list_replies(k, mid)
                    if r['authorId'] != user_id and visibility.reply_visible(user_id, message, r, adults)]
        if not received:
            continue
        newest = received[::-1]  # list_replies is oldest first
        shown = newest if limit is None else newest[:limit]
        viewer = viewer_fields(repo, k, user_id, membership, [message], channels, memo)[mid]
        marks = {mid: seen[mid]} if mid in seen else {}
        replies = [routes_messages._reply_json(r, user_id, message, marks.get(mid)) for r in shown]
        rows.append((newest[0]['sk'], {
            'message': routes_messages._message_json(message, viewer=viewer),
            'total': len(received),
            'unread': sum(1 for r in received if r['sk'][len('R#'):] > marks.get(mid, '')),
            'personal': sum(1 for r in received if r.get('to') == user_id),
            'replies': replies}))
    rows.sort(key=lambda row: row[0], reverse=True)
    return [row[1] for row in rows]


def drop_personal(repo, k, user_id):
    """The user leaves (or is removed): delete the personal replies addressed to them, so a rejoin reads nothing
    of them. delete_reply keeps the counts, the markers and the change feed right. Returns the replies deleted.
    Family replies and replies to an author who left are kept."""
    count = 0
    for thread in repo.list_threads(k):
        if user_id not in (thread.get('personalTo') or ()):
            continue
        message_id = thread['sk'][len('MSG#'):]
        for reply in repo.list_replies(k, message_id, consistent=True):
            if reply.get('to') == user_id:
                count += bool(repo.delete_reply(k, message_id, reply['sk'], reply['authorId']))
        repo.drop_personal_to(k, message_id, user_id)
    markers = repo.purge_reply_markers(k, user_id)
    log.info('personal replies dropped kehila=%s user=%s replies=%d markers=%d', k, user_id, count, markers)
    return count


def drop_received(repo, user_id, remaining_ms=None):
    """Account deletion: delete every reply addressed to the user and every author-routed thread of their own
    messages. Returns (threads, replies). Idempotent; raises 503 try_again before the next item when less than
    MIN_REMAINING_MS is left, and the retry continues. Family replies are untouched (§22.6)."""
    items = repo.received_reply_items(user_id)
    threads = replies = 0
    for item in sorted(items, key=lambda i: i['sk'].startswith('MSG#')):  # replies first, then whole threads
        if remaining_ms and remaining_ms() < MIN_REMAINING_MS:
            raise ApiError(503, 'try_again')
        if item['sk'].startswith('R#'):
            k, message_id = item['pk'].split('#')[1], item['pk'].split('#')[3]
            replies += bool(repo.delete_reply(k, message_id, item['sk'], item['authorId']))
            repo.drop_personal_to(k, message_id, user_id)
            continue
        k, message_id = item['pk'].split('#')[1], item['sk'][len('MSG#'):]
        replies += len(repo.list_replies(k, message_id, consistent=True))
        repo.delete_replies(k, message_id)
        repo.reset_replier_count(k, message_id)
        message = repo.get_message(k, message_id)
        if message:
            repo.put_change(k, 'reply_count', message_id, message['channelId'])
        threads += 1
    log.info('received replies dropped user=%s threads=%d replies=%d', user_id, threads, replies)
    return threads, replies
