"""Routes: gabbai-managed groups (spec 3c) and the shared group-ID validation. Who reads what is visibility.py."""
from collections import Counter

from . import inputs, push, visibility
from .authz import ROLES, require
from .errors import ApiError
from .ids import ID_RE

GABBAI = ('gabbai',)
MAX_GROUPS = 20


def _key(name):
    return name.strip().casefold()


def group_ids(ctx, k, value, existing=None):
    """A list of at most 20 distinct, existing group IDs as a set; 400 invalid_groups otherwise."""
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ApiError(400, 'invalid_groups')
    ids = set(value)
    if len(ids) > MAX_GROUPS or not all(ID_RE.fullmatch(i) for i in ids):
        raise ApiError(400, 'invalid_groups')
    if ids:
        known = existing if existing is not None else {g['sk'][len('G#'):] for g in ctx.repo.list_groups(k)}
        if not ids <= known:
            raise ApiError(400, 'invalid_groups')
    return ids


def _group_name(ctx, k, own_id=None):
    name = inputs.text(inputs.body_object(ctx), 'name', 60, required=True)
    for g in ctx.repo.list_groups(k):
        if g['sk'][len('G#'):] != own_id and _key(g['name']) == _key(name):
            raise ApiError(409, 'group_name_taken')
    return name


def _existing_group(ctx, params):
    if not ID_RE.fullmatch(params['g']):
        raise ApiError(404, 'group_not_found')
    return params['g']


def list_groups(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    members = Counter(g for m in ctx.repo.list_members(k) for g in m.get('groups') or ())
    channels = Counter(g for c in ctx.repo.list_channels(k) for g in c.get('groups') or ())
    admins = Counter(g for m in ctx.repo.list_members(k) if m['role'] == 'member'
                     for g in m.get('adminGroups') or ())
    pending = Counter(r['groupId'] for r in ctx.repo.list_group_requests_all(k))
    rows = [{'groupId': g['sk'][len('G#'):], 'name': g['name'], 'memberCount': members[g['sk'][len('G#'):]],
             'channelCount': channels[g['sk'][len('G#'):]], 'adminCount': admins[g['sk'][len('G#'):]],
             'pendingCount': pending[g['sk'][len('G#'):]]} for g in ctx.repo.list_groups(k)]
    return 200, sorted(rows, key=lambda r: r['name'].casefold())


def create_group(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    name = _group_name(ctx, k)
    if len(ctx.repo.list_groups(k)) >= MAX_GROUPS:
        raise ApiError(409, 'too_many_groups')
    item = ctx.repo.put_group(k, name)
    return 201, {'groupId': item['sk'][len('G#'):], 'name': item['name']}


def rename_group(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    name = _group_name(ctx, k, params['g'])
    group_id = _existing_group(ctx, params)
    item = ctx.repo.rename_group(k, group_id, name)
    return 200, {'groupId': group_id, 'name': item['name']}


def delete_group(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    group_id = _existing_group(ctx, params)
    if group_id in {g['sk'][len('G#'):] for g in ctx.repo.list_groups(k)} and any(
            group_id in (c.get('groups') or ()) for c in ctx.repo.list_channels(k)):
        raise ApiError(409, 'group_in_use')
    ctx.repo.delete_group(k, group_id)
    return 204, None


# Group join requests, group admins and group members (spec 3c). Who may do what: visibility.py.
def _group_of(ctx, k, params):
    """The group's ID when it exists in this Kehila, else 404 group_not_found."""
    group_id = params['g']
    if not ID_RE.fullmatch(group_id) or not ctx.repo.get_group(k, group_id):
        raise ApiError(404, 'group_not_found')
    return group_id


def _admin_of(ctx, params):
    """(k, group_id, caller membership) after checking the caller administers the group."""
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, ROLES)
    group_id = _group_of(ctx, k, params)
    if not visibility.is_group_admin(membership, group_id):
        raise ApiError(403, 'forbidden')
    return k, group_id, membership


def _user(ctx, k, params):
    """The target membership, or None for a malformed or unknown ID."""
    return ctx.repo.get_membership(k, params['u']) if ID_RE.fullmatch(params['u']) else None


def my_groups(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, ROLES)
    mine = set(membership.get('groups') or ())
    asked = {r['groupId'] for r in ctx.repo.list_my_group_requests(k, ctx.user_id)}
    rows = [{'groupId': g['sk'][len('G#'):], 'name': g['name'], 'isMember': g['sk'][len('G#'):] in mine,
             'isAdmin': visibility.is_group_admin(membership, g['sk'][len('G#'):]),
             'requested': g['sk'][len('G#'):] in asked} for g in ctx.repo.list_groups(k)]
    return 200, sorted(rows, key=lambda r: r['name'].casefold())


def request_join(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, ROLES)
    group_id = _group_of(ctx, k, params)
    if group_id in (membership.get('groups') or ()):
        raise ApiError(409, 'already_in_group')
    if ctx.repo.put_group_request(k, group_id, ctx.user_id):
        push.enqueue('group_request', k, group_id)
    return 202, {}


def withdraw_request(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, ROLES)
    if ID_RE.fullmatch(params['g']):
        ctx.repo.delete_group_request(k, params['g'], ctx.user_id)
    return 204, None


def list_requests(ctx, params):
    k, group_id, _ = _admin_of(ctx, params)
    rows = []
    for r in ctx.repo.list_group_requests(k, group_id):
        member = ctx.repo.get_membership(k, r['userId'])
        if member:
            rows.append({'userId': r['userId'], 'displayName': member.get('displayName', ''),
                         'role': member['role'], 'createdAt': int(r['createdAt'])})
        else:
            ctx.repo.delete_group_request(k, group_id, r['userId'])
    return 200, sorted(rows, key=lambda r: r['createdAt'])


def approve_request(ctx, params):
    k, group_id, _ = _admin_of(ctx, params)
    if not ID_RE.fullmatch(params['u']) or not ctx.repo.get_group_request(k, group_id, params['u']):
        raise ApiError(404, 'request_not_found')
    if not _user(ctx, k, params):
        ctx.repo.delete_group_request(k, group_id, params['u'])
        raise ApiError(404, 'member_not_found')
    ctx.repo.add_member_groups(k, params['u'], {group_id})
    ctx.repo.delete_group_request(k, group_id, params['u'])
    return 200, {}


def reject_request(ctx, params):
    k, group_id, _ = _admin_of(ctx, params)
    if ID_RE.fullmatch(params['u']):
        ctx.repo.delete_group_request(k, group_id, params['u'])
    return 204, None


def list_group_members(ctx, params):
    k, group_id, _ = _admin_of(ctx, params)
    rows = [{'userId': m['userId'], 'displayName': m.get('displayName', ''), 'role': m['role'],
             'isAdmin': visibility.is_group_admin(m, group_id)} for m in ctx.repo.list_group_members(k, group_id)]
    return 200, sorted(rows, key=lambda r: r['displayName'].casefold())


def remove_group_member(ctx, params):
    k, group_id, caller = _admin_of(ctx, params)
    target = _user(ctx, k, params)
    if not target or group_id not in (target.get('groups') or ()):
        raise ApiError(404, 'member_not_found')
    if (params['u'] != ctx.user_id and group_id in (target.get('adminGroups') or ())
            and not visibility.is_gabbai(caller)):
        raise ApiError(403, 'forbidden')
    ctx.repo.remove_member_group(k, params['u'], group_id)
    return 204, None


def leave_group(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, ROLES)
    if ID_RE.fullmatch(params['g']):
        ctx.repo.remove_member_group(k, ctx.user_id, params['g'])
    return 204, None


def _appoint(ctx, params, admin):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    group_id = _group_of(ctx, k, params)
    target = _user(ctx, k, params)
    if not target:
        raise ApiError(404, 'member_not_found')
    if target['role'] == 'gabbai':  # already an admin of every group
        return 204, None
    if target['role'] != 'member':
        if admin:
            raise ApiError(400, 'invalid_role')
        return 204, None
    ctx.repo.set_group_admin(k, group_id, params['u'], admin)
    return 204, None


def appoint_admin(ctx, params):
    return _appoint(ctx, params, True)


def unappoint_admin(ctx, params):
    return _appoint(ctx, params, False)
