"""Routes: the family view and its children (families & privacy spec 3.2)."""
import time

from . import inputs, push, repo_messages
from .authz import require
from .errors import ApiError
from .families import clean_child, family_name
from .ids import ID_RE, new_id

MEMBERS = ('member', 'gabbai')
MAX_CHILDREN = 20
SENT_KEEP = 7 * 86400  # a sent marker is ignored this long after it expired


def family_view(ctx, k, membership):
    """FamilyView of the caller's family; creates a one-adult family when the membership has none."""
    repo = ctx.repo
    family_id = membership.get('familyId') or repo.ensure_family(k, ctx.user_id)
    family = repo.get_family(k, family_id) if family_id else None
    if not family:
        raise ApiError(404, 'family_not_found')
    now = int(time.time())
    adults = list(family['adults'])
    received = repo.received_requests(k, ctx.user_id, now)
    keys = [key for u in adults for key in ((f'U#{u}', 'PROFILE'), (f'K#{k}', f'M#{u}'))]
    keys.append((f'K#{k}', f'PS#{ctx.user_id}'))
    keys += [(f'K#{k}', f'M#{r["fromUserId"]}') for r in received]
    found = repo.batch_get(keys)

    def name_of(user_id):
        return (found.get((f'K#{k}', f'M#{user_id}')) or {}).get('displayName', '')
    marker = found.get((f'K#{k}', f'PS#{ctx.user_id}'))
    sent = None
    if marker and int(marker['expiresAt']) + SENT_KEEP > now:
        state = marker['state']
        if state == 'pending' and int(marker['expiresAt']) <= now:
            state = 'expired'
        to_user = marker['toUserId']
        sent = {'toUserId': to_user, 'toName': name_of(to_user) or _name_of_missing(repo, k, to_user),
                'expiresAt': int(marker['expiresAt']), 'state': state}
    return {'familyId': family['familyId'],
            'name': family_name([found.get((f'U#{u}', 'PROFILE')) for u in adults]),
            'adults': [{'userId': u, 'displayName': name_of(u), 'me': u == ctx.user_id} for u in adults],
            'children': family.get('children') or [], 'sent': sent,
            'received': [{'fromUserId': r['fromUserId'], 'fromName': name_of(r['fromUserId']),
                          'expiresAt': int(r['expiresAt'])} for r in received],
            'notice': None}


def _name_of_missing(repo, k, user_id):
    return (repo.get_membership(k, user_id) or {}).get('displayName', '')


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


def _refreshed_view(ctx, k):
    return family_view(ctx, k, ctx.repo.get_membership(k, ctx.user_id) or {})


def _user_id(value):
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise ApiError(400, 'invalid_to_user_id')
    return value


def create_request(ctx, params):
    k, repo = params['k'], ctx.repo
    require(repo, ctx.user_id, k, MEMBERS)
    to_user = _user_id(inputs.body_object(ctx).get('toUserId'))
    target = repo.get_membership(k, to_user)
    if to_user == ctx.user_id or not target or target.get('role') not in MEMBERS:
        raise ApiError(400, 'invalid_to_user_id')
    mine, theirs = repo.family_of(k, ctx.user_id), repo.family_of(k, to_user)
    if mine and len(mine['adults']) > 1:
        raise ApiError(409, 'already_linked')
    if theirs and len(theirs['adults']) > 1:
        raise ApiError(409, 'partner_taken')
    now = int(time.time())
    if repo.live_decline(k, ctx.user_id, to_user, now):
        raise ApiError(409, 'request_cooldown')
    expires = repo.put_link_request(k, ctx.user_id, to_user, now)
    push.enqueue('family_request', k, to_user)
    return 201, {'toUserId': to_user, 'expiresAt': expires}


def withdraw_request(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], MEMBERS)
    ctx.repo.withdraw_request(params['k'], ctx.user_id)
    return 204, None


def _from_user(params):
    value = params['fromUserId']
    if not ID_RE.fullmatch(value):
        raise ApiError(404, 'request_not_found')
    return value


def confirm_request(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, MEMBERS)
    from_user = _from_user(params)
    ctx.repo.link(k, keep_user=ctx.user_id, move_user=from_user, request_from=from_user)
    return 200, _refreshed_view(ctx, k)


def decline_request(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, MEMBERS)
    ctx.repo.decline_request(k, ctx.user_id, _from_user(params), int(time.time()))
    return 204, None


def unlink(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, MEMBERS)
    ctx.repo.unlink(k, ctx.user_id)
    return 200, _refreshed_view(ctx, k)


def candidates(ctx, params):
    k, repo = params['k'], ctx.repo
    require(repo, ctx.user_id, k, MEMBERS)
    now = int(time.time())
    others = [m for m in repo.list_members(k) if m['role'] in MEMBERS and m['userId'] != ctx.user_id]
    found = repo.batch_get([(f'K#{k}', f'F#{m["familyId"]}') for m in others if m.get('familyId')])
    cooldowns = repo.decline_markers(k, ctx.user_id, now)
    out = []
    for m in sorted(others, key=lambda m: (m.get('displayName') or '', m['userId'])):
        family = found.get((f'K#{k}', f'F#{m["familyId"]}')) if m.get('familyId') else None
        if family and len(family['adults']) > 1:
            continue
        entry = {'userId': m['userId'], 'displayName': m.get('displayName', '')}
        if m['userId'] in cooldowns:
            entry['cooldownUntil'] = int(cooldowns[m['userId']]['until'])
        out.append(entry)
    return 200, out
