"""Account deletion's "also delete everything I posted". Idempotent: a retry finishes whatever is left."""
import logging

from . import media
from .errors import ApiError

log = logging.getLogger(__name__)
MIN_REMAINING_MS = 3000


def _split(item):
    """('message', k, messageId) or ('reply', k, messageId) for an authored item; None for anything else."""
    pk, sk = item['pk'], item['sk']
    parts = pk.split('#')
    if sk.startswith('MSG#') and len(parts) == 2 and parts[0] == 'K':
        return 'message', parts[1], sk[len('MSG#'):]
    if sk.startswith('R#') and len(parts) == 4 and parts[0] == 'K' and parts[2] == 'MSG':
        return 'reply', parts[1], parts[3]
    return None


def delete_posts(repo, user_id, remaining_ms=None):
    """Remove every message (chat included) and reply the user wrote, in every Kehila. Returns (messages, replies).

    A message: image first, then the removed flag, then the `message_removed` change (written whenever the text
    is not yet blanked, so a crash between the flag and the change is repaired), then its replies, then the
    text. The text goes last: a message with blank text has been fully handled and is skipped on a retry.
    A reply under someone else's message: delete_reply. Raises 503 try_again before the next item when less
    than MIN_REMAINING_MS is left; the caller's retry continues.
    """
    messages = replies = 0
    for item in repo.authored_items(user_id):
        kind = _split(item)
        if not kind:
            continue
        if remaining_ms and remaining_ms() < MIN_REMAINING_MS:
            raise ApiError(503, 'try_again')
        what, k, message_id = kind
        if what == 'reply':
            repo.delete_reply(k, message_id, item['sk'], user_id)
            replies += 1
            continue
        if item.get('removed') and not item.get('title') and not item.get('body'):
            continue  # done earlier
        if not item.get('removed'):
            if item.get('image'):
                media.delete_image(k, message_id)
            repo.remove_message(k, message_id)
        repo.put_change(k, 'message_removed', message_id, item['channelId'])
        replies += repo.delete_replies(k, message_id)
        repo.scrub_message(k, message_id)
        messages += 1
    log.info('posts deleted user=%s messages=%d replies=%d', user_id, messages, replies)
    return messages, replies
