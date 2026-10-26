"""SQS-triggered Lambda: turn a queued push job into Expo messages.

Logs carry counts and IDs only; device tokens appear as a short prefix at most.
"""
import functools
import json
import logging
import os
import time

from . import expo, visibility
from .push import PUSH_TEXT

log = logging.getLogger(__name__)

CHUNK = 100
TICKET_TTL = 86400
MAX_BACKOFF = 900


@functools.cache
def _repo():
    import boto3
    from .repo import Repo
    return Repo(boto3.resource('dynamodb').Table(os.environ['TABLE_NAME']))


def backoff(receive_count):
    return min(MAX_BACKOFF, 30 * 2 ** receive_count)


def recipients(repo, kind, kehila, ref):
    """User IDs to push for this job."""
    if kind == 'request':
        return [m['userId'] for m in repo.list_members(kehila) if m['role'] == 'gabbai']
    message = repo.get_message(kehila, ref)
    if not message or message.get('removed'):
        return []
    if kind == 'reply':
        target = message.get('targetMemberId')
        return [target] if target and repo.get_membership(kehila, target) else []
    if kind != 'message':
        return []
    channel = repo.get_channel(kehila, message['channelId'])
    out = []
    for member in repo.list_members(kehila):
        uid = member['userId']
        notify = member.get('notify') or {}
        if uid == message['authorId'] or not visibility.can_read_channel(member, channel):
            continue
        if (message['channelId'] in notify.get('mutedChannels', ())
                or message.get('type') in notify.get('mutedTypes', ())
                or message['authorId'] in notify.get('mutedMembers', ())):
            continue
        if message.get('authorKind') == 'member' and notify.get('membersBroadcasts') == 'management_only':
            continue
        out.append(uid)
    return out


def _data(kind, kehila, ref):
    if kind == 'request':
        return {'kehila': kehila, 'screen': 'requests'}
    return {'kehila': kehila, 'messageId': ref}


def _lang(repo, uid, default):
    profile = repo.get_profile(uid)
    lang = profile.get('lang') if profile else None
    return lang if lang in ('he', 'en') else default


def _build(repo, kind, kehila, ref):
    """([expo messages], {token: [userIds]}) with each token appearing once."""
    settings = (repo.get_kehila(kehila) or {}).get('settings', {})
    default = settings.get('defaultLang', 'he')
    default = default if default in ('he', 'en') else 'he'
    data = _data(kind, kehila, ref)
    messages, owners = [], {}
    for uid in recipients(repo, kind, kehila, ref):
        lang = _lang(repo, uid, default)
        for device in repo.list_devices(uid):
            token = device['token']
            if token in owners:  # one device, one push, even if briefly registered to two users
                owners[token].append(uid)
                continue
            owners[token] = [uid]
            messages.append({'to': token, 'title': '', 'body': PUSH_TEXT[kind][lang], 'data': data,
                             'sound': 'default'})
    return messages, owners


def _process(repo, job, token):
    kind, kehila, ref = job['kind'], job['kehila'], job['ref']
    if kind not in PUSH_TEXT:
        log.warning('unknown push kind %s', kind)
        return
    messages, owners = _build(repo, kind, kehila, ref)
    sent = dropped = 0
    for start in range(0, len(messages), CHUNK):
        chunk = messages[start:start + CHUNK]
        for message, ticket in zip(chunk, expo.send(chunk, token)):
            uids = owners[message['to']]
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
