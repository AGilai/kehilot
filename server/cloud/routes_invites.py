"""Routes: create, preview and accept invites."""
import logging
import time

from . import inputs
from . import authz
from .routes_admin import CLASSIFICATIONS
from .errors import ApiError
from .repo_members import normalize_code


log = logging.getLogger(__name__)
MAX_MEMBER_LISTENER_LINKS = 3
DEFAULT_MAX_LISTENERS = 500

INVITE_ROLES = (authz.LISTENER, authz.MEMBER, authz.TECH)  # an invite gives no gabbai (only the admin CLI does)


def _live_invite(repo, code):
    invite = repo.get_invite(code)
    if not invite:
        raise ApiError(404, 'invite_not_found')
    return invite


def create(ctx, params):
    membership = authz.require(ctx.repo, ctx.user_id, params['k'], authz.ADULTS)
    d = inputs.body_object(ctx) if ctx.body else {}
    role = d.get('role', authz.LISTENER)
    if role not in INVITE_ROLES:
        raise ApiError(400, 'invalid_role')
    if not authz.in_set(role, authz.LISTENER_ONLY) and not authz.role_in(membership, authz.MANAGEMENT):
        raise ApiError(403, 'forbidden')
    classification = d.get('classification', '')
    if 'classification' in d and (not authz.in_set(role, authz.MEMBER_ONLY) or classification not in CLASSIFICATIONS):
        raise ApiError(400, 'invalid_classification')
    if authz.in_set(role, authz.LISTENER_ONLY) and not authz.role_in(membership, authz.MANAGEMENT) \
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
    if invite['inviterId'] != 'admin-cli':
        inviter = ctx.repo.get_membership(k, invite['inviterId'])
        # The inviter left or was removed, or (member invites) is no longer a gabbai: same answer as an expired link.
        if not inviter or (not authz.role_in(invite, authz.LISTENER_ONLY) and not authz.role_in(inviter, authz.MANAGEMENT)):
            raise ApiError(410, 'invite_expired')
    settings = (ctx.repo.get_kehila(k) or {}).get('settings', {})
    if authz.role_in(invite, authz.LISTENER_ONLY) and not ctx.repo.get_membership(k, ctx.user_id):
        # Soft cap: the count is read, not reserved, so concurrent accepts may overshoot by a few.
        if ctx.repo.count_listeners(k) >= int(settings.get('maxListeners', DEFAULT_MAX_LISTENERS)):
            raise ApiError(409, 'kehila_full')
    membership = ctx.repo.accept_invite(code, ctx.user_id, name, int(time.time()),
                                        bool(settings.get('memberBroadcastDefault', False)))
    if authz.role_in(membership, authz.ADULTS):
        try:
            ctx.repo.ensure_family(k, ctx.user_id)
        except Exception:  # the lazy path (GET .../family) creates it later
            log.warning('ensure_family failed kehila=%s user=%s', k, ctx.user_id)
    return 200, {'kehilaId': membership['kehilaId'], 'role': membership['role']}


def list_invites(ctx, params):
    membership = authz.require(ctx.repo, ctx.user_id, params['k'], authz.ADULTS)
    own_only = None if authz.role_in(membership, authz.MANAGEMENT) else ctx.user_id
    return 200, [{'code': i['pk'][len('INV#'):], 'role': i['role'], 'usesLeft': int(i['usesLeft']),
                  'expiresAt': int(i['expiresAt']), 'mine': i['inviterId'] == ctx.user_id}
                 for i in ctx.repo.list_invites(params['k'], own_only)]


def revoke(ctx, params):
    k = params['k']
    membership = authz.require(ctx.repo, ctx.user_id, k, authz.ADULTS)
    invite = ctx.repo.get_invite(normalize_code(params['code']))
    if not invite or invite['kehilaId'] != k:
        raise ApiError(404, 'invite_not_found')  # another Kehila's code looks exactly like a missing one
    if not authz.role_in(membership, authz.MANAGEMENT) and invite['inviterId'] != ctx.user_id:
        raise ApiError(403, 'forbidden')
    ctx.repo.revoke_invite(k, invite)
    return 204, None
