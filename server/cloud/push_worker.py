"""SQS-triggered Lambda: turn a queued push job into Expo messages.

Logs carry counts and IDs only; device tokens appear as a short prefix at most.

Kind 'seat_reminder' (ref '<friday>#<n>', queued by the seat_reminders job) is not in PUSH_TEXT: its texts are fixed
(seat_reminders.texts). The worker drops it when the deadline has passed, the Kehila has no layout for that Friday or
that reminder is now off, and reads the recipients (unanswered families' men, else adults) at send time.
"""
import functools
import json
import logging
import os
import time
from datetime import datetime

from . import authz, expo, families, seat_reminders, seat_times, seating_week, type_rules, visibility
from .push import MESSAGE_TYPES, PUSH_TEXT, REPLY_KEYS, SYSTEM_KEYS, reply_text_key, resolve_text, update_texts

logging.getLogger().setLevel(logging.INFO)  # Lambda leaves the root logger at WARNING and drops log.info
log = logging.getLogger(__name__)

CHUNK = 100
UPDATE_KIND = 'message_update'  # ref = messageId; texts built here from the stored message
TICKET_TTL = 86400
MAX_BACKOFF = 900


@functools.cache
def _repo():
    import boto3
    from .repo import Repo
    return Repo(boto3.resource('dynamodb').Table(os.environ['TABLE_NAME']))


def backoff(receive_count):
    return min(MAX_BACKOFF, 30 * 2 ** receive_count)


def _now():
    return datetime.now(seating_week.TZ)


def _split_reply_ref(ref):
    """(messageId, replyId) of a reply job's ref '<m>/<r>', else None."""
    message_id, _, reply_id = ref.partition('/')
    return (message_id, reply_id) if message_id and reply_id and '/' not in reply_id else None


def _reply_context(repo, kehila, ref):
    """(message, reply) of a reply job, or None when the ref is bad, or the message or reply is gone or removed."""
    parts = _split_reply_ref(ref)
    message = repo.get_message(kehila, parts[0]) if parts else None
    reply = repo.get_reply(kehila, *parts) if message and not message.get('removed') else None
    return (message, reply) if reply else None


def _reply_recipients(repo, kehila, ref):
    """Who a reply is for (never the writer, mutes do not apply), then only those not pushed for this message in
    the last REPLY_PUSH_WINDOW: each is claimed with a conditional put. Personal replies reach the chosen adult only."""
    context = _reply_context(repo, kehila, ref)
    if not context:
        return []
    message, reply = context
    channel = repo.get_channel(kehila, message['channelId'])
    to = reply.get('to') or 'family'
    if to == 'author':
        found = [repo.get_membership(kehila, message['authorId'])]
    elif to == 'family':
        found = families.ordered_reachable_adults(repo, kehila, message, channel)
    else:
        found = [repo.get_membership(kehila, to)]
    uids = [m['userId'] for m in found if visibility.reply_target_ok(m, channel) and m['userId'] != reply['authorId']]
    uids = [uid for uid in dict.fromkeys(uids) if repo.list_devices(uid)]  # no device: do not use up the window
    now = int(time.time())
    message_id = _split_reply_ref(ref)[0]
    return [uid for uid in dict.fromkeys(uids) if repo.claim_reply_push(kehila, message_id, uid, now)]


def recipients(repo, kind, kehila, ref):
    """User IDs to push for this job."""
    if kind == seat_reminders.KIND:
        parsed = seat_reminders.parse_ref(ref)
        return seat_reminders.recipients(repo, kehila, parsed[0]) if parsed else []
    if kind == 'request':
        return [m['userId'] for m in repo.list_members(kehila) if visibility.is_management(m)]
    if kind == 'group_request':  # ref = the group ID: appointed admins, else every gabbai
        members = repo.list_members(kehila)
        admins = [m['userId'] for m in members if visibility.is_group_admin(m, ref) and authz.role_in(m, authz.MEMBER_ONLY)]
        return admins or [m['userId'] for m in members if visibility.is_management(m)]
    if kind == 'reply':  # ref = '<messageId>/<replyId>'
        return _reply_recipients(repo, kehila, ref)
    if kind in SYSTEM_KEYS:  # ref = the recipient, who must still be a member or gabbai here
        membership = repo.get_membership(kehila, ref)
        return [ref] if authz.role_in(membership, authz.ADULTS) else []
    message = repo.get_message(kehila, ref)
    if not message or message.get('removed'):
        return []
    if kind not in ('message', UPDATE_KIND):
        return []
    channel = repo.get_channel(kehila, message['channelId'])
    rules = type_rules.rules((repo.get_kehila(kehila) or {}).get('settings', {}))  # once per message
    out = []
    for member in repo.list_members(kehila):
        uid = member['userId']
        notify = member.get('notify') or {}
        own = message.get('updatedBy') if kind == UPDATE_KIND else message['authorId']  # the one who just acted
        if (uid == own or not visibility.in_audience(member, channel)
                or not visibility.message_visible(member, channel, message, rules)):
            continue
        if channel.get('conversation') and message['channelId'] not in notify.get('chatChannels', ()):
            continue  # a chat is pushed only to those who opted in to it
        if (message['channelId'] in notify.get('mutedChannels', ())
                or message.get('type') in notify.get('mutedTypes', ())
                or message['authorId'] in notify.get('mutedMembers', ())):
            continue
        if (message.get('authorKind') == 'member' and not channel.get('conversation')
                and notify.get('membersBroadcasts') == 'management_only'):
            continue
        out.append(uid)
    return out


def _data(kind, kehila, ref):
    if kind == 'request':
        return {'kehila': kehila, 'screen': 'requests'}
    if kind == 'group_request':
        return {'kehila': kehila, 'screen': 'group_requests'}  # the group ID stays out of the payload
    if kind in SYSTEM_KEYS:
        return {'kehila': kehila, 'screen': 'family'}
    if kind == 'reply':
        return {'kehila': kehila, 'messageId': ref.partition('/')[0]}
    return {'kehila': kehila, 'messageId': ref}


def _lang(repo, uid, default):
    profile = repo.get_profile(uid)
    lang = profile.get('lang') if profile else None
    return lang if lang in ('he', 'en') else default


def _build_seat_reminder(repo, meta, kehila, ref):
    friday, n = seat_reminders.parse_ref(ref)
    settings = meta.get('settings', {})
    default = settings.get('defaultLang', 'he')
    default = default if default in ('he', 'en') else 'he'
    deadline = seating_week.deadline_of(friday, seat_times.deadline_hm(settings))
    day = seat_times.reminders_of(settings)[n]['day']
    data = {'kehila': kehila, 'screen': 'seats', 'week': friday}  # no names, no counts
    messages, owners = [], {}
    expires = int(time.time()) + seat_reminders.MARKER_TTL
    for uid in seat_reminders.recipients(repo, kehila, friday):
        if not repo.list_devices(uid):
            continue
        # once per user: a redelivered record or a retry after a partial failure skips whoever was already handled
        if not repo.claim_seat_reminder(kehila, friday, f'{n}#U#{uid}', expires):
            continue
        title, body = seat_reminders.texts(n, _lang(repo, uid, default), meta.get('name', ''), deadline, day)
        for device in repo.list_devices(uid):
            token = device['token']
            if token in owners:
                owners[token].append(uid)
                continue
            owners[token] = [uid]
            messages.append({'to': token, 'title': title, 'body': body, 'data': data, 'sound': 'default'})
    return messages, owners


def _build(repo, kind, kehila, ref):
    """([expo messages], {token: [userIds]}) with each token appearing once."""
    meta = repo.get_kehila(kehila) or {}
    settings = meta.get('settings', {})
    title = meta.get('name', '')  # the community's name: the same for everyone, not personal data
    if kind == seat_reminders.KIND:
        return _build_seat_reminder(repo, meta, kehila, ref)
    text_key = kind
    if kind == 'message':
        message_type = (repo.get_message(kehila, ref) or {}).get('type')
        text_key = message_type if message_type in MESSAGE_TYPES else 'message'
    if kind == 'reply':
        context = _reply_context(repo, kehila, ref)
        if not context:
            return [], {}
        text_key = reply_text_key(context[0].get('type'), context[1].get('to') or 'family')
    default = settings.get('defaultLang', 'he')
    default = default if default in ('he', 'en') else 'he'
    data = _data(kind, kehila, ref)
    quiet = kind == UPDATE_KIND
    updated = repo.get_message(kehila, ref) if quiet else None
    messages, owners = [], {}
    for uid in recipients(repo, kind, kehila, ref):
        lang = _lang(repo, uid, default)
        for device in repo.list_devices(uid):
            token = device['token']
            if token in owners:  # one device, one push, even if briefly registered to two users
                owners[token].append(uid)
                continue
            owners[token] = [uid]
            if quiet:  # no sound or vibration: Android low-priority channel, iOS passive
                text = update_texts(updated, lang, title)
                messages.append({'to': token, 'title': text[0], 'body': text[1], 'data': data, 'priority': 'normal',
                                 'channelId': 'quiet', 'interruptionLevel': 'passive'})
                continue
            messages.append({'to': token, 'title': title, 'body': resolve_text(meta, text_key, lang), 'data': data,
                             'sound': 'default'})
    return messages, owners


def _release_users(repo, kehila, ref, uids):
    friday, n = seat_reminders.parse_ref(ref)
    for uid in set(uids):
        repo.release_seat_reminder(kehila, friday, f'{n}#U#{uid}')


def _release_reply_claims(repo, kehila, ref, uids):
    message_id = _split_reply_ref(ref)[0]
    for uid in set(uids):
        repo.table.delete_item(Key={'pk': f'K#{kehila}#U#{uid}', 'sk': f'RXPUSH#{message_id}'})


def _process(repo, job, token):
    kind, kehila, ref = job['kind'], job['kehila'], job['ref']
    if kind == seat_reminders.KIND:
        reason = seat_reminders.skip_reason(repo, kehila, ref, _now())
        if reason == 'bad_ref':
            log.warning('seat_reminder dropped: bad ref kehila=%s', kehila)
            return
        if reason:
            log.info('push kind=seat_reminder kehila=%s ref=%s skipped=%s', kehila, ref, reason)
            return
    elif kind not in ('reply', UPDATE_KIND) and (kind not in PUSH_TEXT or kind in REPLY_KEYS):
        log.warning('unknown push kind %s', kind)
        return
    messages, owners = _build(repo, kind, kehila, ref)
    sent = dropped = 0
    ok_users = set()
    for start in range(0, len(messages), CHUNK):
        chunk = messages[start:start + CHUNK]
        try:
            tickets = expo.send(chunk, token)
        except Exception:
            if kind == seat_reminders.KIND:  # nothing came back: let the retry send this chunk's users
                _release_users(repo, kehila, ref, [u for m in chunk for u in owners[m['to']]])
            elif kind == 'reply':  # the same for the throttle claims, or the SQS retry would find them taken
                _release_reply_claims(repo, kehila, ref, [u for m in chunk for u in owners[m['to']]])
            raise
        for message, ticket in zip(chunk, tickets):
            uids = owners[message['to']]
            if ticket.get('status') == 'ok':
                ok_users.update(uids)
            if ticket.get('status') == 'ok' and ticket.get('id'):
                sent += 1
                repo.put_push_ticket(ticket['id'], message['to'], uids[0], int(time.time()) + TICKET_TTL)
            elif (ticket.get('details') or {}).get('error') == 'DeviceNotRegistered':
                dropped += 1
                for uid in uids:
                    repo.delete_device(uid, message['to'])
            else:
                log.warning('push ticket error %s token=%.12s', (ticket.get('details') or {}).get('error'),
                            message['to'])
    if kind == seat_reminders.KIND:  # Expo definitely rejected every message of these users: they may be retried
        _release_users(repo, kehila, ref, [u for us in owners.values() for u in us if u not in ok_users])
    log.info('push kind=%s kehila=%s ref=%s sent=%d unregistered=%d', kind, kehila, ref, sent, dropped)


def _delay_retry(record, receive_count):
    url = os.environ.get('PUSH_QUEUE_URL')
    if not url or not record.get('receiptHandle'):
        return
    try:
        import boto3
        boto3.client('sqs').change_message_visibility(
            QueueUrl=url, ReceiptHandle=record['receiptHandle'], VisibilityTimeout=backoff(receive_count))
    except Exception:
        log.exception('change_message_visibility failed')


def _parse(record):
    """The job dict of a record; ValueError, KeyError or TypeError for a poison record."""
    job = json.loads(record['body'])
    if not isinstance(job, dict):
        raise TypeError('job is not an object')
    for key in ('kind', 'kehila', 'ref'):
        if not isinstance(job[key], str) or not job[key]:
            raise ValueError(key)
    return job


def handler(event, context):
    repo, failures, token = _repo(), [], None
    for record in event.get('Records', []):
        try:
            job = _parse(record)
        except (ValueError, KeyError, TypeError):  # can never succeed: drop it (no retry), log the ID only
            log.warning('push record dropped as malformed id=%s',
                        record.get('messageId') if isinstance(record, dict) else None)
            continue
        try:
            token = token or expo.access_token()
            _process(repo, job, token)
        except Exception:
            log.exception('push record failed id=%s', record.get('messageId'))
            failures.append({'itemIdentifier': record['messageId']})
            count = int((record.get('attributes') or {}).get('ApproximateReceiveCount', 1))
            _delay_retry(record, count)
    return {'batchItemFailures': failures}
