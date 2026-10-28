"""Private replies: who may answer a message and what a viewer sees of it (docs/UX-DESIGN.md §22).

`reply_route` is the one rule. `viewer_fields` rides on every message JSON; `detail_fields` (single GET only)
adds the reads that need reachability checks. Names and reply text never go to logs."""
from . import authz, families, visibility

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
