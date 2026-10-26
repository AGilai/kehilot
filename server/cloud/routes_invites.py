"""Routes: create, preview and accept invites."""
import time

from . import inputs
from .authz import require
from .routes_admin import CLASSIFICATIONS
from .errors import ApiError
from .repo_members import normalize_code


def _live_invite(repo, code):
    invite = repo.get_invite(code)
    if not invite:
        raise ApiError(404, 'invite_not_found')
    return invite


def create(ctx, params):
    membership = require(ctx.repo, ctx.user_id, params['k'], ('member', 'gabbai'))
    d = inputs.body_object(ctx) if ctx.body else {}
    role = d.get('role', 'listener')
    if role not in ('listener', 'member'):
        raise ApiError(400, 'invalid_role')
    if role == 'member' and membership['role'] != 'gabbai':
        raise ApiError(403, 'forbidden')
    classification = d.get('classification', '')
    if 'classification' in d and (role != 'member' or classification not in CLASSIFICATIONS):
        raise ApiError(400, 'invalid_classification')
    uses = inputs.integer(d, 'uses', 1, 50) if 'uses' in d else 10
    days = inputs.integer(d, 'days', 1, 30) if 'days' in d else 7
    code = ctx.repo.create_invite(params['k'], ctx.user_id, role, uses, days, classification)
    return 201, {'code': code, 'expiresAt': int(ctx.repo.get_invite(code)['expiresAt'])}


def preview(ctx, params):
    invite = _live_invite(ctx.repo, normalize_code(params['code']))
    if invite['usesLeft'] <= 0 or invite['expiresAt'] <= time.time():
        raise ApiError(410, 'invite_expired')
    kehila = ctx.repo.get_kehila(invite['kehilaId'])
    if not kehila:
        raise ApiError(404, 'invite_not_found')
    return 200, {'kehilaName': kehila['name'], 'role': invite['role'], 'expiresAt': int(invite['expiresAt'])}


def accept(ctx, params):
    profile = ctx.repo.get_profile(ctx.user_id)
    if not profile:
        raise ApiError(409, 'profile_required')
    name = f"{profile['firstName']} {profile['lastName']}".strip()
    code = normalize_code(params['code'])
    invite = _live_invite(ctx.repo, code)
    settings = (ctx.repo.get_kehila(invite['kehilaId']) or {}).get('settings', {})
    membership = ctx.repo.accept_invite(code, ctx.user_id, name, int(time.time()),
                                        bool(settings.get('memberBroadcastDefault', False)))
    return 200, {'kehilaId': membership['kehilaId'], 'role': membership['role']}
