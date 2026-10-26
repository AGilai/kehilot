"""Push notifications: the request path only enqueues a small job; push_worker does the sending.

The job is {"kind", "kehila", "ref"} on the SQS queue in env PUSH_QUEUE_URL. ref is a messageId for
'message' and 'reply', and the screen name for 'request'. No message content ever enters the queue.
"""
import json
import logging
import os

log = logging.getLogger(__name__)

PUSH_TEXT = {
    'message': {'he': 'הודעה חדשה בקהילה', 'en': 'New message in your community'},
    'reply': {'he': 'ברכה חדשה', 'en': 'New blessing'},
    'request': {'he': 'בקשת הצטרפות חדשה', 'en': 'New membership request'},
}


def enqueue(kind, kehila, ref) -> None:
    """Queue a push of `kind` ('message' | 'reply' | 'request') for `kehila`.

    No-op when PUSH_QUEUE_URL is unset. A queue failure is logged and swallowed: the message or request
    is already saved, and a missed push must not turn it into an error for the caller."""
    url = os.environ.get('PUSH_QUEUE_URL')
    if not url:
        return
    try:
        import boto3
        boto3.client('sqs').send_message(QueueUrl=url, MessageBody=json.dumps(
            {'kind': kind, 'kehila': kehila, 'ref': ref}))
    except Exception:
        log.exception('push enqueue failed kind=%s kehila=%s', kind, kehila)
