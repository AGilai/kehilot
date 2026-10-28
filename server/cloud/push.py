"""Push notifications: the request path only enqueues a small job; push_worker does the sending.

The job is {"kind", "kehila", "ref"} on the SQS queue in env PUSH_QUEUE_URL. ref is a messageId for
'message' and 'reply', the screen name for 'request' and the group ID for 'group_request',
the recipient's userId for 'family_request' and 'family_gabbai', and '<friday>#<n>' for 'seat_reminder'
(sent by the seat_reminders job through `send`; fixed texts in seat_reminders.texts, never in PUSH_TEXT, never editable).
No message content ever enters the queue.
"""
import json
import logging
import os

log = logging.getLogger(__name__)

# Keyed [key][lang]: key is a message type (kind 'message'), 'reply' or 'request'. 'message' is the
# generic text for a message of an unknown type.
PUSH_TEXT = {
    'weekly': {'he': 'עדכון שבועי מהקהילה', 'en': 'Weekly update from your community'},
    'celebration': {'he': 'מזל טוב חדש בקהילה', 'en': 'New mazal tov in your community'},
    'condolence': {'he': 'הודעת אבל בקהילה', 'en': 'Condolence notice in your community'},
    'event': {'he': 'אירוע חדש בקהילה', 'en': 'New event in your community'},
    'message': {'he': 'הודעה חדשה בקהילה', 'en': 'New message in your community'},
    'chat': {'he': 'הודעה חדשה בשיחה בקהילה', 'en': 'New chat message in your community'},
    'reply': {'he': 'ברכה חדשה', 'en': 'New blessing'},
    'request': {'he': 'בקשת הצטרפות חדשה', 'en': 'New membership request'},
    'group_request': {'he': 'בקשת הצטרפות לקבוצה', 'en': 'New group join request'},
    'family_request': {'he': 'בקשת קישור משפחה חדשה', 'en': 'New family link request'},
    'family_gabbai': {'he': 'פרטי המשפחה שלכם עודכנו בידי צוות הניהול',
                     'en': 'Your family details were updated by the management team'},
}
# Fixed texts: not offered by, or editable through, the gabbai's push-text screens. ref = the recipient's userId.
SYSTEM_KEYS = ('family_request', 'family_gabbai')
PUSH_TEXT_MAX = 80  # code points: the text is shown on the lock screen
MESSAGE_TYPES = ('weekly', 'celebration', 'condolence', 'event', 'chat')


def resolve_text(meta, key, lang) -> str:
    """The Kehila's custom text for `key` in `lang` when set and not empty, else the default."""
    if key in SYSTEM_KEYS:
        return PUSH_TEXT[key][lang]
    custom = ((meta or {}).get('pushTexts') or {}).get(key, {})
    text = custom.get(lang) if isinstance(custom, dict) else None
    return text if isinstance(text, str) and text else PUSH_TEXT[key][lang]


def send(kind, kehila, ref) -> None:
    """Queue the job. Raises on a queue failure, and RuntimeError when PUSH_QUEUE_URL is unset (a caller that must
    know whether the job was queued, such as the seat reminder job, claims first and releases on this)."""
    url = os.environ.get('PUSH_QUEUE_URL')
    if not url:
        raise RuntimeError('PUSH_QUEUE_URL is not set')
    import boto3
    boto3.client('sqs').send_message(QueueUrl=url, MessageBody=json.dumps(
        {'kind': kind, 'kehila': kehila, 'ref': ref}))


def enqueue(kind, kehila, ref) -> None:
    """Queue a push of `kind` ('message' | 'reply' | 'request' | 'group_request' | 'family_request' |
    'family_gabbai') for `kehila`.

    No-op when PUSH_QUEUE_URL is unset. A queue failure is logged and swallowed: the message or request
    is already saved, and a missed push must not turn it into an error for the caller."""
    if not os.environ.get('PUSH_QUEUE_URL'):
        return
    try:
        send(kind, kehila, ref)
    except Exception:
        log.exception('push enqueue failed kind=%s kehila=%s', kind, kehila)
