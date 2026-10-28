"""Routes: the family tree (UX-DESIGN 17). The family's adults read and write; the Kehila's gabbaim read."""
from datetime import date

from . import inputs, repo_messages, tree_rules
from .authz import require
from .errors import ApiError
from .ids import ID_RE

MEMBERS = ('member', 'gabbai')
MAX_BODY = 256 * 1024


def get_tree(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, MEMBERS)
    family_id = ctx.repo.ensure_family(k, ctx.user_id)
    family = ctx.repo.get_family(k, family_id) if family_id else None
    if not family:
        raise ApiError(404, 'family_not_found')
    return 200, {'people': tree_rules.people_of(family), 'version': int(family['version'])}


def put_tree(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, MEMBERS)
    body = inputs.body_object(ctx, MAX_BODY)
    version = body.get('ifVersion')
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ApiError(400, 'invalid_if_version')
    people = tree_rules.validate_people(body.get('people'), date.fromisoformat(repo_messages.local_date()))
    family_id = ctx.repo.ensure_family(k, ctx.user_id)
    saved = ctx.repo.update_people(k, family_id, lambda _: people, if_version=version)
    return 200, {'version': int(saved['version'])}


def admin_tree(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, ('gabbai',))
    if not ID_RE.fullmatch(params['familyId']):
        raise ApiError(404, 'family_not_found')
    family = ctx.repo.get_family(k, params['familyId'])
    if not family:
        raise ApiError(404, 'family_not_found')
    return 200, {'people': tree_rules.people_of(family), 'version': int(family['version'])}
