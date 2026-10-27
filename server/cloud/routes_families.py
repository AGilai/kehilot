"""Routes: the family view and its children (families & privacy spec 3.2)."""
import logging
import time

from . import inputs, push, repo_messages
from .authz import require
from .errors import ApiError
from .families import clean_child, family_name
from .ids import ID_RE, new_id

log = logging.getLogger(__name__)

MEMBERS = ('member', 'gabbai')
MAX_CHILDREN = 20
SENT_KEEP = 7 * 86400  # a sent marker is ignored this long after it expired


def notice_of(repo, k, membership):
    """{gabbaiName, partnerName} from the membership's familyNotice, names from the current memberships (a
    departed gabbai's name is ''). None when there is no notice or the partner is no longer a member."""
    notice = membership.get('familyNotice')
    if not notice:
        return None
    found = repo.batch_get([(f'K#{k}', f'M#{notice["byUserId"]}'), (f'K#{k}', f'M#{notice["partnerUserId"]}')])
    partner = found.get((f'K#{k}', f'M#{notice["partnerUserId"]}'))
    if not partner or partner.get('role') not in MEMBERS:
        return None
    by = found.get((f'K#{k}', f'M#{notice["byUserId"]}')) or {}
    return {'gabbaiName': by.get('displayName', ''), 'partnerName': partner.get('displayName', '')}


def live_received(repo, k, user_id, live_count, now):
    """The caller's live received requests, oldest first, as (request item, sender membership) pairs. None while
    the family already has two live adults (a stale request after a link race), and senders who are no longer
    members are left out."""
    if live_count >= 2:
        return []
    requests = repo.received_requests(k, user_id, now)
    found = repo.batch_get([(f'K#{k}', f'M#{r["fromUserId"]}') for r in requests])
    return [(r, found[(f'K#{k}', f'M#{r["fromUserId"]}')]) for r in requests
            if (found.get((f'K#{k}', f'M#{r["fromUserId"]}')) or {}).get('role') in MEMBERS]


def request_card(repo, k, user_id, membership):
    """cards.request: the oldest live received request, or None."""
    if not repo.received_requests(k, user_id, int(time.time())):
        return None
    family = repo.family_of(k, user_id)
    live = len(repo.live_adults(k, family)) if family else 1
    pairs = live_received(repo, k, user_id, live, int(time.time()))
    return {'fromUserId': pairs[0][0]['fromUserId'], 'fromName': pairs[0][1].get('displayName', '')} if pairs else None


def family_view(ctx, k, membership):
    """FamilyView of the caller's family; creates a one-adult family when the membership has none. A departed
    adult is pruned from the family (written back) before anything is shown."""
    repo = ctx.repo
    family_id = repo.ensure_family(k, ctx.user_id)  # heals a missing or foreign familyId
    family = repo.get_family(k, family_id) if family_id else None
    if not family:
        raise ApiError(404, 'family_not_found')
    now = int(time.time())
    family, live = repo.prune_family(k, family)
    adults = [m['userId'] for m in live] or list(family['adults'])
    names = {m['userId']: m.get('displayName', '') for m in live}
    received = live_received(repo, k, ctx.user_id, len(live), now)
    keys = [(f'U#{u}', 'PROFILE') for u in adults] + [(f'K#{k}', f'PS#{ctx.user_id}')]
    found = repo.batch_get(keys)
    marker = found.get((f'K#{k}', f'PS#{ctx.user_id}'))
    sent = None
    if marker and int(marker['expiresAt']) + SENT_KEEP > now:
        state = marker['state']
        if state == 'pending' and int(marker['expiresAt']) <= now:
            state = 'expired'
        to_user = marker['toUserId']
        sent = {'toUserId': to_user, 'toName': _name_of_missing(repo, k, to_user),
                'expiresAt': int(marker['expiresAt']), 'state': state}
    me = repo.get_membership(k, ctx.user_id) or membership
    return {'familyId': family['familyId'],
            'name': family_name([found.get((f'U#{u}', 'PROFILE')) for u in adults]),
            'adults': [{'userId': u, 'displayName': names.get(u, ''), 'me': u == ctx.user_id} for u in adults],
            'children': family.get('children') or [], 'sent': sent,
            'received': [{'fromUserId': r['fromUserId'], 'fromName': m.get('displayName', ''),
                          'expiresAt': int(r['expiresAt'])} for r, m in received],
            'notice': notice_of(repo, k, me) if len(live) > 1 else None}


def _name_of_missing(repo, k, user_id):
    return (repo.get_membership(k, user_id) or {}).get('displayName', '')


def _family_id(ctx, k, membership):
    return ctx.repo.ensure_family(k, ctx.user_id)


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
    if _live_pair(repo, k, ctx.user_id):
        raise ApiError(409, 'already_linked')
    if _live_pair(repo, k, to_user):
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
    members = repo.list_members(k)
    family_of_user = {m['userId']: m.get('familyId') for m in members if m['role'] in MEMBERS}
    others = [m for m in members if m['role'] in MEMBERS and m['userId'] != ctx.user_id]
    found = repo.batch_get([(f'K#{k}', f'F#{m["familyId"]}') for m in others if m.get('familyId')])
    cooldowns = repo.decline_markers(k, ctx.user_id, now)
    out = []
    for m in sorted(others, key=lambda m: (m.get('displayName') or '', m['userId'])):
        family = found.get((f'K#{k}', f'F#{m["familyId"]}')) if m.get('familyId') else None
        if family and len([a for a in family['adults'] if family_of_user.get(a) == family['familyId']]) > 1:
            continue
        entry = {'userId': m['userId'], 'displayName': m.get('displayName', '')}
        if m['userId'] in cooldowns:
            entry['cooldownUntil'] = int(cooldowns[m['userId']]['until'])
        out.append(entry)
    return 200, out


def _live_pair(repo, k, user_id):
    """True when the user's family has two live adults."""
    family = repo.family_of(k, user_id)
    return bool(family) and len(repo.live_adults(k, family)) > 1


def admin_families(ctx, params):
    k, repo = params['k'], ctx.repo
    require(repo, ctx.user_id, k, ('gabbai',))
    families = repo.list_families(k)
    keys = [(f'K#{k}', f'M#{u}') for f in families for u in f['adults']]
    keys += [(f'U#{u}', 'PROFILE') for f in families for u in f['adults']]
    found = repo.batch_get(keys)
    rows = []
    for family in families:
        live = [found[(f'K#{k}', f'M#{u}')] for u in family['adults']
                if (found.get((f'K#{k}', f'M#{u}')) or {}).get('role') in MEMBERS
                and found[(f'K#{k}', f'M#{u}')].get('familyId') == family['familyId']]
        if not live:
            continue
        children = []
        for child in family.get('children') or []:
            row = {'firstName': child['firstName'], 'gender': child['gender']}
            if child.get('birthDate'):
                row['birthYear'] = int(child['birthDate'][:4])
            children.append(row)
        rows.append({'familyId': family['familyId'],
                     'name': family_name([found.get((f'U#{m["userId"]}', 'PROFILE')) for m in live]),
                     'adults': [{'userId': m['userId'], 'displayName': m.get('displayName', '')} for m in live],
                     'children': children})
    return 200, sorted(rows, key=lambda r: (r['name'], r['familyId']))


def gabbai_link(ctx, params):
    k, repo = params['k'], ctx.repo
    require(repo, ctx.user_id, k, ('gabbai',))
    ids = inputs.body_object(ctx).get('userIds')
    if not isinstance(ids, list) or len(ids) != 2 or not all(isinstance(u, str) and ID_RE.fullmatch(u) for u in ids) \
            or ids[0] == ids[1]:
        raise ApiError(400, 'invalid_user_ids')
    a, b = ids
    if any((repo.get_membership(k, u) or {}).get('role') not in MEMBERS for u in ids):
        raise ApiError(400, 'invalid_user_ids')
    try:
        family_id = repo.link(k, keep_user=a, move_user=b)
    except ApiError as error:
        raise ApiError(409, 'partner_taken') if error.code == 'already_linked' else error
    now = time.time()
    for user, partner in ((a, b), (b, a)):
        try:
            repo.set_family_notice(k, user, ctx.user_id, partner, now)
        except Exception:  # the link stands; the card is a courtesy
            log.warning('family notice failed kehila=%s', k)
        push.enqueue('family_gabbai', k, user)
    return 200, {'familyId': family_id}
