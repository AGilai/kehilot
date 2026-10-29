"""Push notifications: the request path only enqueues a small job; push_worker does the sending.

The job is {"kind", "kehila", "ref"} on the SQS queue in env PUSH_QUEUE_URL. ref is a messageId for
'message', '<messageId>/<replyId>' for 'reply', the screen name for 'request' and the group ID for 'group_request',
the recipient's userId for 'family_request' and 'family_gabbai', and '<friday>#<n>' for 'seat_reminder'
(sent by the seat_reminders job through `send`; fixed texts in seat_reminders.texts, never in PUSH_TEXT, never editable).
No message content ever enters the queue.
"""
import json
import logging
import os

log = logging.getLogger(__name__)

# Keyed [key][lang]: key is a message type (kind 'message'), a reply text key or a request kind. 'message' is the
# generic text for a message of an unknown type.
PUSH_TEXT = {
    'weekly': {'he': 'עדכון שבועי מהקהילה', 'en': 'Weekly update from your community'},
    'celebration': {'he': 'מזל טוב חדש בקהילה', 'en': 'New mazal tov in your community'},
    'condolence': {'he': 'הודעת אבל בקהילה', 'en': 'Condolence notice in your community'},
    'event': {'he': 'אירוע חדש בקהילה', 'en': 'New event in your community'},
    'message': {'he': 'הודעה חדשה בקהילה', 'en': 'New message in your community'},
    'chat': {'he': 'הודעה חדשה בשיחה בקהילה', 'en': 'New chat message in your community'},
    'private_reply': {'he': 'תשובה פרטית חדשה', 'en': 'New private reply'},
    'family_blessing': {'he': 'ברכה אישית חדשה למשפחה', 'en': 'New personal blessing for your family'},
    'family_word': {'he': 'מילה אישית חדשה למשפחה', 'en': 'New personal word for your family'},
    'personal_blessing': {'he': 'ברכה אישית חדשה', 'en': 'New personal blessing'},
    'personal_word': {'he': 'מילה אישית חדשה', 'en': 'New personal word'},
    'request': {'he': 'בקשת הצטרפות חדשה', 'en': 'New membership request'},
    'group_request': {'he': 'בקשת הצטרפות לקבוצה', 'en': 'New group join request'},
    'family_request': {'he': 'בקשת קישור משפחה חדשה', 'en': 'New family link request'},
    'family_gabbai': {'he': 'פרטי המשפחה שלכם עודכנו בידי צוות הניהול',
                     'en': 'Your family details were updated by the management team'},
}
# Fixed texts: not offered by, or editable through, the gabbai's push-text screens. ref = the recipient's userId.
SYSTEM_KEYS = ('family_request', 'family_gabbai')
# Reply pushes (kind 'reply', ref '<messageId>/<replyId>'): five fixed texts, no names, no reply text, never editable.
REPLY_KEYS = ('private_reply', 'family_blessing', 'family_word', 'personal_blessing', 'personal_word')
FIXED_TEXT_KEYS = SYSTEM_KEYS + REPLY_KEYS
PUSH_TEXT_MAX = 80  # code points: the text is shown on the lock screen
MESSAGE_TYPES = ('weekly', 'celebration', 'condolence', 'event', 'chat')


def resolve_text(meta, key, lang) -> str:
    """The Kehila's custom text for `key` in `lang` when set and not empty, else the default."""
    if key in FIXED_TEXT_KEYS:
        return PUSH_TEXT[key][lang]
    custom = ((meta or {}).get('pushTexts') or {}).get(key, {})
    text = custom.get(lang) if isinstance(custom, dict) else None
    return text if isinstance(text, str) and text else PUSH_TEXT[key][lang]


def reply_text_key(message_type, to) -> str:
    """The fixed text for a reply: 'author' -> private_reply; 'family' -> family_blessing / family_word; a userId
    (one chosen adult) -> personal_blessing / personal_word. A condolence is a word, everything else a blessing."""
    if to == 'author':
        return 'private_reply'
    word = message_type == 'condolence'
    if to == 'family':
        return 'family_word' if word else 'family_blessing'
    return 'personal_word' if word else 'personal_blessing'


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
