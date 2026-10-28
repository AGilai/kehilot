"""Routes: the family tree (UX-DESIGN 17). The family's adults read and write; the Kehila's gabbaim read."""
import json
from datetime import date

from . import inputs, repo_messages, tree_rules
from .authz import require
from .errors import ApiError
from .ids import ID_RE

MEMBERS = ('member', 'gabbai')
MAX_BODY = tree_rules.MAX_TREE_BYTES  # body and people JSON


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
    if len(json.dumps(people, ensure_ascii=False).encode('utf-8')) > MAX_BODY:
        raise ApiError(400, 'tree_too_large')
    family_id = ctx.repo.ensure_family(k, ctx.user_id)

    def apply(stored):
        family = ctx.repo.get_family(k, family_id)
        adults = [m['userId'] for m in ctx.repo.live_adults(k, family)] if family else []
        return tree_rules.assign_user_ids(people, stored, ctx.user_id, adults)
    saved = ctx.repo.update_people(k, family_id, apply, if_version=version)
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
