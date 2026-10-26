"""Routes: my profile, language and push devices."""
import re
from urllib.parse import unquote

from . import inputs
from .errors import ApiError

LANGS = ('he', 'en')
PLATFORMS = ('ios', 'android', 'web')
TOKEN_RE = re.compile(r'^ExponentPushToken\[[A-Za-z0-9_-]{10,}\]$')


def put_profile(ctx, params):
    d = inputs.body_object(ctx)
    first = inputs.text(d, 'firstName', 60, required=True)
    last = inputs.text(d, 'lastName', 60)
    lang = inputs.choice(d, 'lang', LANGS)
    ctx.repo.put_profile(ctx.user_id, first, last, lang)
    return 200, {'firstName': first, 'lastName': last, 'lang': lang}


def put_device(ctx, params):
    d = inputs.body_object(ctx)
    token = d.get('token')
    if not isinstance(token, str) or not TOKEN_RE.fullmatch(token):
        raise ApiError(400, 'invalid_token')
    ctx.repo.put_device(ctx.user_id, token, inputs.choice(d, 'platform', PLATFORMS))
    return 204, None


def delete_device(ctx, params):
    ctx.repo.delete_device(ctx.user_id, unquote(params['token']))
    return 204, None
