"""Routes: role tags (spec item 9, UX §12.6). Gabbaim define and assign them; they are labels and grant nothing."""
from collections import Counter

from . import inputs
from .authz import require
from .errors import ApiError
from .ids import ID_RE
from .routes_admin import _UNSAFE_TEXT, _target
from .routes_groups import GABBAI
from .tags import sort_key as _sort_key, tag_map

MAX_TAGS = 20
NAME_MAX = 24


def _name(d, tags, own_id=None):
    name = d.get('name')
    if not isinstance(name, str) or _UNSAFE_TEXT.search(name):
        raise ApiError(400, 'invalid_tag_name')
    name = name.strip()
    if not 1 <= len(name) <= NAME_MAX:
        raise ApiError(400, 'invalid_tag_name')
    if any(t['sk'][len('TAG#'):] != own_id and t['name'].strip().casefold() == name.casefold() for t in tags):
        raise ApiError(409, 'tag_exists')
    return name


def list_tags(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    tags = ctx.repo.list_tags(k)
    ids = {t['sk'][len('TAG#'):] for t in tags}
    held = Counter(i for m in ctx.repo.list_members(k) for i in set(m.get('tagIds') or ()) & ids)
    rows = [{'tagId': i, 'name': t['name'], 'memberCount': held[i]}
            for t in tags for i in (t['sk'][len('TAG#'):],)]
    return 200, sorted(rows, key=_sort_key)


def create_tag(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    tags = ctx.repo.list_tags(k)
    name = _name(inputs.body_object(ctx), tags)
    if len(tags) >= MAX_TAGS:
        raise ApiError(409, 'too_many_tags')
    item = ctx.repo.put_tag(k, name)
    return 201, {'tagId': item['sk'][len('TAG#'):], 'name': name}


def _existing(params):
    if not ID_RE.fullmatch(params['tagId']):
        raise ApiError(404, 'tag_not_found')
    return params['tagId']


def rename_tag(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    d = inputs.body_object(ctx)
    tag_id = _existing(params)
    tags = ctx.repo.list_tags(k)
    if tag_id not in {t['sk'][len('TAG#'):] for t in tags}:
        raise ApiError(404, 'tag_not_found')
    name = _name(d, tags, tag_id)
    ctx.repo.rename_tag(k, tag_id, name)
    return 200, {'tagId': tag_id, 'name': name}


def delete_tag(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    ctx.repo.delete_tag(k, _existing(params))
    return 204, None


def set_member_tags(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    value = inputs.body_object(ctx).get('tagIds')
    if not isinstance(value, list) or len(value) > MAX_TAGS or not all(isinstance(v, str) and ID_RE.fullmatch(v) for v in value):
        raise ApiError(400, 'invalid_tag_ids')
    ids = set(value)
    names = tag_map(ctx.repo, k)
    if not ids <= set(names):
        raise ApiError(400, 'invalid_tag_ids')
    _target(ctx, params, 'member_not_found')
    ctx.repo.set_member_tags(k, params['userId'], ids)
    return 200, {'tags': sorted(({'tagId': i, 'name': names[i]} for i in ids), key=_sort_key)}
