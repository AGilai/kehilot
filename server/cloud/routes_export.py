"""Routes: download my data (spec §7). The link and the key are never logged."""
import os
import time

from . import export, media
from .errors import ApiError
from .repo_messages import local_date

LINK_SECONDS = 600


def _link(key, day):
    return {'url': media.presign_export(key, day), 'expiresAt': int(time.time()) + LINK_SECONDS}


def get_export(ctx, params):
    day = local_date()
    key = media.export_key(ctx.user_id, day)
    if not media.object_exists(key):
        raise ApiError(404, 'export_not_found')
    return 200, _link(key, day)


def post_export(ctx, params):
    day = local_date()
    key = media.export_key(ctx.user_id, day)
    if media.object_exists(key):
        return 200, _link(key, day)
    if ctx.repo.get_export_marker(ctx.user_id, day):
        raise ApiError(429, 'export_limit')
    remaining = getattr(ctx.context, 'get_remaining_time_in_millis', None)
    path = export.build(ctx.repo, ctx.user_id, ctx.caller.email, remaining)
    try:
        media.put_export(key, path)
        ctx.repo.put_export_marker(ctx.user_id, day, key)
    finally:
        if os.path.exists(path):
            os.remove(path)
    return 200, _link(key, day)
