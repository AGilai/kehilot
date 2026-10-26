"""Routes: gabbai-managed groups (spec 3c) and the shared group-ID validation. Who reads what is visibility.py."""
from collections import Counter

from . import inputs
from .authz import require
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
    rows = [{'groupId': g['sk'][len('G#'):], 'name': g['name'], 'memberCount': members[g['sk'][len('G#'):]],
             'channelCount': channels[g['sk'][len('G#'):]]} for g in ctx.repo.list_groups(k)]
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
