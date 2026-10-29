"""Routes: my profile, language and push devices."""
import logging
import os
import re
from urllib.parse import unquote

from . import authz, inputs, media, posts, private_replies
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
    return 200, ctx.repo.get_profile(ctx.user_id)


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
    """Refuse while the last gabbai or tech anywhere; then data first, Cognito last (a retry finishes either half)."""
    if not os.environ.get('USER_POOL_ID'):
        raise RuntimeError('USER_POOL_ID not set')  # misconfiguration: fail before deleting anything
    memberships = ctx.repo.list_memberships(ctx.user_id)
    managing = {m['kehilaId']: m['role'] for m in memberships if authz.role_in(m, authz.MANAGEMENT)}
    for k in managing:
        if not any(authz.role_in(m, authz.MANAGEMENT) and m['userId'] != ctx.user_id for m in ctx.repo.list_members(k)):
            raise ApiError(409, 'last_gabbai')
    n_messages = n_replies = 0
    if ctx.query.get('deletePosts') == '1':  # first: a 503 try_again leaves membership intact, the retry continues
        n_messages, n_replies = posts.delete_posts(
            ctx.repo, ctx.user_id, getattr(ctx.context, 'get_remaining_time_in_millis', None))
    remaining = getattr(ctx.context, 'get_remaining_time_in_millis', None)
    n_received = private_replies.drop_received(ctx.repo, ctx.user_id, remaining)[1]  # 503 try_again like the posts step
    for m in memberships:  # before the purge, so the scan never meets the person in a family
        if authz.role_in(m, authz.ADULTS):
            ctx.repo.drop_adult(m['kehilaId'], ctx.user_id)
    for k, role in managing.items():  # guarded removal: re-checks another gabbai or tech atomically (409 last_gabbai)
        ctx.repo.remove_member(k, ctx.user_id, role)
    reports = ctx.repo.list_user_reports(ctx.user_id)
    for report in reports:  # images before items: a 503 retry still finds them
        if report.get('image'):
            media.delete_key(report['image']['key'])
    ctx.repo.delete_user_reports(reports)
    deleted, blanked = ctx.repo.purge_user(ctx.user_id, ctx.caller.sub)
    _delete_cognito_user(ctx.caller.sub)
    log.info('account deleted user=%s items=%d blanked=%d posts=%d replies=%d received=%d', ctx.user_id, deleted, blanked,
             n_messages, n_replies, n_received)
    return 204, None
