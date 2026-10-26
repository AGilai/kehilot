"""Routes: create, preview and accept invites."""
import time

from . import inputs
from .authz import require
from .errors import ApiError


def _live_invite(repo, code):
    invite = repo.get_invite(code)
    if not invite:
        raise ApiError(404, 'invite_not_found')
    return invite


def create(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], ('member', 'gabbai'))
    d = inputs.body_object(ctx) if ctx.body else {}
    uses = inputs.integer(d, 'uses', 1, 50) if 'uses' in d else 10
    days = inputs.integer(d, 'days', 1, 30) if 'days' in d else 7
    code = ctx.repo.create_invite(params['k'], ctx.user_id, 'listener', uses, days)
    return 201, {'code': code, 'expiresAt': int(ctx.repo.get_invite(code)['expiresAt'])}


def preview(ctx, params):
    invite = _live_invite(ctx.repo, params['code'])
    if invite['usesLeft'] <= 0 or invite['expiresAt'] <= time.time():
        raise ApiError(410, 'invite_expired')
    kehila = ctx.repo.get_kehila(invite['kehilaId'])
    if not kehila:
        raise ApiError(404, 'invite_not_found')
    return 200, {'kehilaName': kehila['name']}


def accept(ctx, params):
    profile = ctx.repo.get_profile(ctx.user_id)
    if not profile:
        raise ApiError(409, 'profile_required')
    name = f"{profile['firstName']} {profile['lastName']}".strip()
    membership = ctx.repo.accept_invite(params['code'], ctx.user_id, name, int(time.time()))
    return 200, {'kehilaId': membership['kehilaId'], 'role': membership['role']}
