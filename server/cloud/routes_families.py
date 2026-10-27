"""Routes: the family view and its children (families & privacy spec 3.2)."""
from . import inputs, repo_messages
from .authz import require
from .errors import ApiError
from .families import clean_child, family_name
from .ids import ID_RE, new_id

MEMBERS = ('member', 'gabbai')
MAX_CHILDREN = 20


def family_view(ctx, k, membership):
    """FamilyView of the caller's family; creates a one-adult family when the membership has none."""
    repo = ctx.repo
    family_id = membership.get('familyId') or repo.ensure_family(k, ctx.user_id)
    family = repo.get_family(k, family_id) if family_id else None
    if not family:
        raise ApiError(404, 'family_not_found')
    adults = list(family['adults'])
    keys = [key for u in adults for key in ((f'U#{u}', 'PROFILE'), (f'K#{k}', f'M#{u}'))]
    found = repo.batch_get(keys)
    return {'familyId': family['familyId'],
            'name': family_name([found.get((f'U#{u}', 'PROFILE')) for u in adults]),
            'adults': [{'userId': u, 'displayName': (found.get((f'K#{k}', f'M#{u}')) or {}).get('displayName', ''),
                        'me': u == ctx.user_id} for u in adults],
            'children': family.get('children') or [], 'sent': None, 'received': [], 'notice': None}


def _family_id(ctx, k, membership):
    return membership.get('familyId') or ctx.repo.ensure_family(k, ctx.user_id)


def get_family(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, MEMBERS)
    return 200, family_view(ctx, k, membership)


def _child_id(params):
    if not ID_RE.fullmatch(params['childId']):
        raise ApiError(404, 'child_not_found')
    return params['childId']


def add_child(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, MEMBERS)
    child = {'id': new_id(), **clean_child(inputs.body_object(ctx), repo_messages.local_date())}

    def add(children):
        if len(children) >= MAX_CHILDREN:
            raise ApiError(409, 'children_limit')
        return children + [child]
    ctx.repo.update_children(k, _family_id(ctx, k, membership), add)
    return 201, child


def edit_child(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, MEMBERS)
    child_id = _child_id(params)
    fields = clean_child(inputs.body_object(ctx), repo_messages.local_date())
    updated = {'id': child_id, **fields}

    def edit(children):
        if not any(c['id'] == child_id for c in children):
            raise ApiError(404, 'child_not_found')
        return [updated if c['id'] == child_id else c for c in children]
    ctx.repo.update_children(k, _family_id(ctx, k, membership), edit)
    return 200, updated


def delete_child(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, MEMBERS)
    child_id = _child_id(params)

    def remove(children):
        if not any(c['id'] == child_id for c in children):
            raise ApiError(404, 'child_not_found')
        return [c for c in children if c['id'] != child_id]
    ctx.repo.update_children(k, _family_id(ctx, k, membership), remove)
    return 204, None
