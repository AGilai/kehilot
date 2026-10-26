"""Routes: health, my profile, one Kehila."""
from .authz import ROLES, require


def health(ctx, params):
    return 200, {'ok': True}


def me(ctx, params):
    kehilot = []
    for membership in ctx.repo.list_memberships(ctx.user_id):
        kehila = ctx.repo.get_kehila(membership['kehilaId'])
        if kehila:
            kehilot.append({'kehilaId': kehila['kehilaId'], 'name': kehila['name'], 'role': membership['role']})
    return 200, {'userId': ctx.user_id, 'email': ctx.caller.email,
                 'profile': ctx.repo.get_profile(ctx.user_id), 'kehilot': kehilot}


def kehila(ctx, params):
    membership = require(ctx.repo, ctx.user_id, params['k'], ROLES)
    item = ctx.repo.get_kehila(params['k'])
    return 200, {'kehilaId': item['kehilaId'], 'name': item['name'], 'role': membership['role'],
                 'classification': membership.get('classification', '')}
