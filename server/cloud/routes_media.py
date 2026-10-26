"""Routes: brochure image uploads and viewing (spec 3c). Who may do what comes from visibility.py."""
import time
from datetime import datetime, timezone

from . import inputs, media, visibility
from .authz import require
from .errors import ApiError
from .ids import ID_RE, new_id
from .routes_messages import _visible_message


def create_upload(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k)
    d = inputs.body_object(ctx)
    channel_id = d.get('channelId')
    if not isinstance(channel_id, str) or not ID_RE.fullmatch(channel_id):
        raise ApiError(400, 'invalid_channel_id')
    content_type = d.get('contentType')
    if not isinstance(content_type, str) or content_type not in media.IMAGE_TYPES:
        raise ApiError(400, 'invalid_content_type')
    size = inputs.integer(d, 'bytes', 1, media.MAX_IMAGE_BYTES)
    channel = ctx.repo.get_channel(k, channel_id)
    if not visibility.can_read_channel(membership, channel):
        raise ApiError(404, 'channel_not_found')
    if not visibility.can_post(membership, channel):
        raise ApiError(403, 'forbidden')
    hour = datetime.now(timezone.utc).strftime('%Y%m%d%H')
    ctx.repo.count_uploads(k, ctx.user_id, hour, media.UPLOAD_HOURLY_LIMIT)
    upload_id = new_id()
    url = media.presign_put(media.upload_key(k, ctx.user_id, upload_id), content_type, size)
    return 201, {'uploadId': upload_id, 'url': url, 'method': 'PUT', 'headers': {'Content-Type': content_type},
                 'expiresAt': int(time.time()) + media.URL_SECONDS}


def image_url(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k)
    message, _ = _visible_message(ctx, k, membership, params['m'])
    image = message.get('image')
    if not image:
        raise ApiError(404, 'not_found')
    return 200, {'url': media.presign_get(k, params['m'], image['contentType']),
                 'expiresAt': int(time.time()) + media.URL_SECONDS}
