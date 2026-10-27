"""Routes: my profile, language and push devices."""
import logging
import os
import re
from urllib.parse import unquote

from . import inputs
from .errors import ApiError

log = logging.getLogger(__name__)

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


def _delete_cognito_user(sub):
    import boto3
    client = boto3.client('cognito-idp')
    try:
        client.admin_delete_user(UserPoolId=os.environ['USER_POOL_ID'], Username=sub)
    except client.exceptions.UserNotFoundException:  # a retry after the user was already removed
        pass


def finish_deleted_account(caller):
    """A retry of DELETE /v1/me after the data purge (tombstone written): only the Cognito user can be left."""
    if not os.environ.get('USER_POOL_ID'):
        raise RuntimeError('USER_POOL_ID not set')
    _delete_cognito_user(caller.sub)
    return 204, None


def delete_account(ctx, params):
    """Refuse while last gabbai anywhere; then data first, Cognito last (a retry finishes either half)."""
    if not os.environ.get('USER_POOL_ID'):
        raise RuntimeError('USER_POOL_ID not set')  # misconfiguration: fail before deleting anything
    memberships = ctx.repo.list_memberships(ctx.user_id)
    gabbai_of = [m['kehilaId'] for m in memberships if m['role'] == 'gabbai']
    for k in gabbai_of:
        if not any(m['role'] == 'gabbai' and m['userId'] != ctx.user_id for m in ctx.repo.list_members(k)):
            raise ApiError(409, 'last_gabbai')
    for k in gabbai_of:  # guarded removal: re-checks the other gabbai atomically (409 last_gabbai on a race)
        ctx.repo.remove_member(k, ctx.user_id, 'gabbai')
    for m in memberships:  # before the purge, so the scan never meets the person in a family
        if m['role'] in ('member', 'gabbai'):
            ctx.repo.drop_adult(m['kehilaId'], ctx.user_id)
    deleted, blanked = ctx.repo.purge_user(ctx.user_id, ctx.caller.sub)
    _delete_cognito_user(ctx.caller.sub)
    log.info('account deleted user=%s items=%d blanked=%d', ctx.user_id, deleted, blanked)
    return 204, None
