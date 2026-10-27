"""Routes: membership requests, approval, member management and broadcast rights."""
import logging
import os
import re
import time
from collections import Counter

from . import accounts, importer, inputs, push
from .authz import require
from .errors import ApiError
from .ids import ID_RE
from .routes_groups import GABBAI, group_ids

CLASSIFICATIONS = ('', 'א', 'קבוע')
LANGS = ('he', 'en')
# control characters (Cc, incl. tab and newlines), line/paragraph separators and bidi overrides/isolates/marks
_UNSAFE_TEXT = re.compile('[\\x00-\\x1f\\x7f-\\x9f\\u2028\\u2029\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]')
ROLES = ('listener', 'member', 'gabbai')
IMPORT_MAX_ROWS = 10
IMPORT_MAX_BODY = 64 * 1024

log = logging.getLogger(__name__)


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
    existing = {g['sk'][len('G#'):] for g in ctx.repo.list_groups(params['k'])}  # a deleted group's ID is not listed
    return 200, [{'userId': m['userId'], 'displayName': m.get('displayName', ''), 'role': m['role'],
                  'classification': m.get('classification', ''), 'canBroadcast': bool(m.get('canBroadcast')),
                  'groups': sorted(set(m.get('groups') or ()) & existing)}
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
    if 'groups' in d:
        fields['groups'] = group_ids(ctx, k, d['groups'])
    if not fields:
        raise ApiError(400, 'invalid_body')
    target = _target(ctx, params, 'member_not_found')
    if 'role' in fields and 'listener' in (fields['role'], target['role']):
        raise ApiError(409, 'role_change_not_allowed')  # listeners become members only through approve
    if 'groups' in fields:  # admin rights follow group membership
        fields['adminGroups'] = set(target.get('adminGroups') or ()) & fields['groups']
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
    ctx.repo.revoke_member_invites(params['k'], params['userId'])
    return 204, None


def leave(ctx, params):
    membership = require(ctx.repo, ctx.user_id, params['k'])
    ctx.repo.remove_member(params['k'], ctx.user_id, membership['role'])
    ctx.repo.revoke_member_invites(params['k'], ctx.user_id)
    return 204, None


POST_POLICIES = ('management', 'broadcasters')


def _channel_fields(ctx, k):
    """(name, listenersCanRead, postPolicy, groups); groups is None when the body omits it."""
    d = inputs.body_object(ctx)
    name, readable, policy = (inputs.text(d, 'name', 60, required=True), inputs.boolean(d, 'listenersCanRead'),
                              inputs.choice(d, 'postPolicy', POST_POLICIES))
    groups = group_ids(ctx, k, d['groups']) if 'groups' in d else None
    if groups and readable:  # group channels are members-only
        raise ApiError(400, 'invalid_groups')
    conversation = inputs.boolean(d, 'conversation') if 'conversation' in d else None
    if conversation and readable:  # a conversation is for members (and listeners admitted to its group)
        raise ApiError(400, 'invalid_listeners_can_read')
    limit = inputs.integer(d, 'chatHourlyLimit', 0, 200) if 'chatHourlyLimit' in d else None
    return name, readable, policy, groups, conversation, limit


def _channel_json(item, with_groups=False, is_admin=None):
    out = {'channelId': item['sk'][len('C#'):], 'name': item['name'],
           'listenersCanRead': item['listenersCanRead'], 'postPolicy': item['postPolicy'],
           'conversation': bool(item.get('conversation')), 'chatHourlyLimit': int(item.get('chatHourlyLimit', 30))}
    if with_groups:
        out['groups'] = sorted(item.get('groups') or ())
    if is_admin is not None:
        out['isAdmin'] = is_admin
    return out


def create_channel(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    name, readable, policy, groups, conversation, limit = _channel_fields(ctx, k)
    item = ctx.repo.put_channel(k, name, readable, policy, groups or frozenset(), bool(conversation), limit)
    return 201, _channel_json(item, True, True)


def update_channel(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    name, readable, policy, groups, conversation, limit = _channel_fields(ctx, k)
    if not ID_RE.fullmatch(params['c']):
        raise ApiError(404, 'channel_not_found')
    if readable and (groups is None or conversation is None):  # omitted fields keep the stored ones
        stored = ctx.repo.get_channel(k, params['c'])
        if stored and groups is None and stored.get('groups'):
            raise ApiError(400, 'invalid_groups')
        if stored and conversation is None and stored.get('conversation'):
            raise ApiError(400, 'invalid_listeners_can_read')
    item = ctx.repo.update_channel(k, params['c'], name, readable, policy, groups, conversation, limit)
    return 200, _channel_json(item, True, True)


def import_list(ctx, params):
    """Pre-create accounts and memberships from the gabbai's list. Idempotent by email; logs only counts."""
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    rows = inputs.body_object(ctx, IMPORT_MAX_BODY).get('rows')
    if not isinstance(rows, list) or not 1 <= len(rows) <= IMPORT_MAX_ROWS or not all(isinstance(r, dict) for r in rows):
        raise ApiError(400, 'invalid_rows')
    pool_id = os.environ.get('USER_POOL_ID')
    if not pool_id:
        raise RuntimeError('USER_POOL_ID not set')
    results = importer.import_rows(ctx.repo, accounts.cognito_client(), pool_id, k, rows,
                                  getattr(ctx.context, 'get_remaining_time_in_millis', None))
    counts = Counter(r['status'] for r in results)
    log.info('import k=%s %s', k, ' '.join(f'{s}={counts.get(s, 0)}'
                                          for s in ('created', 'added', 'upgraded', 'exists', 'invalid', 'skipped')))
    return 200, {'results': results}


def set_settings(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], GABBAI)
    ctx.repo.set_max_listeners(params['k'], inputs.integer(inputs.body_object(ctx), 'maxListeners', 0, 5000))
    return 200, {}


def get_push_texts(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], GABBAI)
    stored = (ctx.repo.get_kehila(params['k']) or {}).get('pushTexts') or {}
    custom = {key: {lang: t for lang, t in langs.items() if lang in LANGS and t}
              for key, langs in stored.items() if key in push.PUSH_TEXT and isinstance(langs, dict)}
    return 200, {'defaults': push.PUSH_TEXT, 'custom': {key: v for key, v in custom.items() if v}}


def put_push_text(ctx, params):
    """Set or (with "") remove the custom push text. It is shown on the lock screen, so it is one line of at
    most 80 code points; it is never logged."""
    require(ctx.repo, ctx.user_id, params['k'], GABBAI)
    d = inputs.body_object(ctx)
    key, lang = d.get('key'), d.get('lang')
    if not isinstance(key, str) or key not in push.PUSH_TEXT:
        raise ApiError(400, 'invalid_key')
    if not isinstance(lang, str) or lang not in LANGS:
        raise ApiError(400, 'invalid_lang')
    text = d.get('text')
    if not isinstance(text, str) or _UNSAFE_TEXT.search(text):  # checked before the strip: no hidden controls
        raise ApiError(400, 'invalid_text')
    text = text.strip()
    if len(text) > push.PUSH_TEXT_MAX:
        raise ApiError(400, 'invalid_text')
    ctx.repo.set_push_text(params['k'], key, lang, text)
    return 200, {}
