"""Routes: create, preview and accept invites."""
import time

from . import inputs
from .authz import require
from .routes_admin import CLASSIFICATIONS
from .errors import ApiError
from .repo_members import normalize_code


MAX_MEMBER_LISTENER_LINKS = 3
DEFAULT_MAX_LISTENERS = 500


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
    if role == 'listener' and membership['role'] != 'gabbai' \
            and ctx.repo.count_active_listener_invites(params['k'], ctx.user_id) >= MAX_MEMBER_LISTENER_LINKS:
        raise ApiError(409, 'too_many_invites')  # soft: parallel creates may overshoot by a few
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
    k = invite['kehilaId']
    if invite['inviterId'] != 'admin-cli' and not ctx.repo.get_membership(k, invite['inviterId']):
        raise ApiError(410, 'invite_expired')  # the inviter left or was removed: same answer as an expired link
    settings = (ctx.repo.get_kehila(k) or {}).get('settings', {})
    if invite['role'] == 'listener' and not ctx.repo.get_membership(k, ctx.user_id):
        # Soft cap: the count is read, not reserved, so concurrent accepts may overshoot by a few.
        if ctx.repo.count_listeners(k) >= int(settings.get('maxListeners', DEFAULT_MAX_LISTENERS)):
            raise ApiError(409, 'kehila_full')
    membership = ctx.repo.accept_invite(code, ctx.user_id, name, int(time.time()),
                                        bool(settings.get('memberBroadcastDefault', False)))
    return 200, {'kehilaId': membership['kehilaId'], 'role': membership['role']}


def list_invites(ctx, params):
    membership = require(ctx.repo, ctx.user_id, params['k'], ('member', 'gabbai'))
    own_only = None if membership['role'] == 'gabbai' else ctx.user_id
    return 200, [{'code': i['pk'][len('INV#'):], 'role': i['role'], 'usesLeft': int(i['usesLeft']),
                  'expiresAt': int(i['expiresAt']), 'mine': i['inviterId'] == ctx.user_id}
                 for i in ctx.repo.list_invites(params['k'], own_only)]


def revoke(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, ('member', 'gabbai'))
    invite = ctx.repo.get_invite(normalize_code(params['code']))
    if not invite or invite['kehilaId'] != k:
        raise ApiError(404, 'invite_not_found')  # another Kehila's code looks exactly like a missing one
    if membership['role'] != 'gabbai' and invite['inviterId'] != ctx.user_id:
        raise ApiError(403, 'forbidden')
    ctx.repo.revoke_invite(k, invite)
    return 204, None
