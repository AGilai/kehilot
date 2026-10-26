"""Routes: membership requests, approval, member management and broadcast rights."""
import time

from . import inputs, push
from .authz import require
from .errors import ApiError
from .ids import ID_RE

CLASSIFICATIONS = ('', 'א', 'קבוע')
ROLES = ('listener', 'member', 'gabbai')
GABBAI = ('gabbai',)


def _target(ctx, params, missing):
    k, user_id = params['k'], params['userId']
    membership = ctx.repo.get_membership(k, user_id) if ID_RE.fullmatch(user_id) else None
    if not membership:
        raise ApiError(404, missing)
    return membership


def request_membership(ctx, params):
    k = params['k']
    membership = require(ctx.repo, ctx.user_id, k, ('listener',))
    ctx.repo.put_request(k, ctx.user_id, membership.get('displayName', ''), 'rejectedAt' in membership,
                         time.time())
    push.enqueue('request', k, 'requests')
    return 202, {}


def list_requests(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], GABBAI)
    rows = [{'userId': r['sk'][len('REQ#'):], 'displayName': r['displayName'], 'createdAt': int(r['createdAt']),
             'previouslyRejected': bool(r.get('previouslyRejected'))} for r in ctx.repo.list_requests(params['k'])]
    return 200, sorted(rows, key=lambda r: r['createdAt'])


def approve(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    classification = inputs.choice(inputs.body_object(ctx), 'classification', CLASSIFICATIONS)
    _target(ctx, params, 'request_not_found')
    default = ctx.repo.get_kehila(k).get('settings', {}).get('memberBroadcastDefault', False)
    ctx.repo.approve_request(k, params['userId'], classification, bool(default))
    return 200, {}


def reject(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], GABBAI)
    _target(ctx, params, 'request_not_found')
    ctx.repo.reject_request(params['k'], params['userId'], time.time())
    return 200, {}


def list_members(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], GABBAI)
    return 200, [{'userId': m['userId'], 'displayName': m.get('displayName', ''), 'role': m['role'],
                  'classification': m.get('classification', ''), 'canBroadcast': bool(m.get('canBroadcast'))}
                 for m in ctx.repo.list_members(params['k'])]


def update_member(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    d = inputs.body_object(ctx)
    fields = {}
    if 'role' in d:
        fields['role'] = inputs.choice(d, 'role', ROLES)
    if 'classification' in d:
        fields['classification'] = inputs.choice(d, 'classification', CLASSIFICATIONS)
    if 'canBroadcast' in d:
        fields['canBroadcast'] = inputs.boolean(d, 'canBroadcast')
    if not fields:
        raise ApiError(400, 'invalid_body')
    target = _target(ctx, params, 'member_not_found')
    if 'role' in fields and 'listener' in (fields['role'], target['role']):
        raise ApiError(409, 'role_change_not_allowed')  # listeners become members only through approve
    ctx.repo.update_member(k, params['userId'], target['role'], fields)
    return 200, {}


def set_broadcast(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], GABBAI)
    ctx.repo.set_all_broadcast(params['k'], inputs.boolean(inputs.body_object(ctx), 'allow'))
    return 200, {}


def remove_member(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], GABBAI)
    target = _target(ctx, params, 'member_not_found')
    ctx.repo.remove_member(params['k'], params['userId'], target['role'])
    return 204, None


def leave(ctx, params):
    membership = require(ctx.repo, ctx.user_id, params['k'])
    ctx.repo.remove_member(params['k'], ctx.user_id, membership['role'])
    return 204, None


POST_POLICIES = ('management', 'broadcasters')


def _channel_fields(ctx):
    d = inputs.body_object(ctx)
    return (inputs.text(d, 'name', 60, required=True), inputs.boolean(d, 'listenersCanRead'),
            inputs.choice(d, 'postPolicy', POST_POLICIES))


def _channel_json(item):
    return {'channelId': item['sk'][len('C#'):], 'name': item['name'],
            'listenersCanRead': item['listenersCanRead'], 'postPolicy': item['postPolicy']}


def create_channel(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], GABBAI)
    return 201, _channel_json(ctx.repo.put_channel(params['k'], *_channel_fields(ctx)))


def update_channel(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], GABBAI)
    fields = _channel_fields(ctx)
    if not ID_RE.fullmatch(params['c']):
        raise ApiError(404, 'channel_not_found')
    return 200, _channel_json(ctx.repo.update_channel(params['k'], params['c'], *fields))
