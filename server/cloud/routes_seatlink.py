"""Routes: suggest and confirm linking a seat holder (no account) to a registered family. Gabbai-only; nothing is
linked without a confirm (spec ruling 7: a family that already holds seats gets the union)."""
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from . import inputs, seating_link as link, seating_rules as rules
from .authz import require
from .errors import ApiError
from .ids import ID_RE
from .routes_groups import GABBAI
from .routes_seating import _holder, _live_family

MEMBER_ROLES = ('member', 'gabbai')


def _profiles(ctx, user_ids):
    found = ctx.repo.batch_get([(f'U#{u}', 'PROFILE') for u in user_ids])
    return {u: found.get((f'U#{u}', 'PROFILE')) or {} for u in user_ids}


def _families(ctx, k):
    """{familyId: {names, people: {userId: person}}} from the live memberships and their profiles. The person of an
    adult carries the family's first names and phones (an initial or a phone matches either adult)."""
    members = [m for m in ctx.repo.list_members(k) if m.get('role') in MEMBER_ROLES and m.get('familyId')]
    profiles = _profiles(ctx, [m['userId'] for m in members])
    out = {}
    for m in members:
        fam = out.setdefault(m['familyId'], {'members': []})
        fam['members'].append(m)
    for fam in out.values():
        firsts = [profiles[m['userId']].get('firstName') for m in fam['members']]
        phones = [profiles[m['userId']].get('phone') for m in fam['members']]
        fam['names'] = ', '.join(m.get('displayName', '') for m in fam['members'])
        fam['people'] = {m['userId']: {'lastName': profiles[m['userId']].get('lastName'),
                                       'firstNames': [f for f in firsts if f], 'phones': [p for p in phones if p]}
                         for m in fam['members']}
    return out


def link_suggestions(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    holders = ctx.repo.list_holders(k)
    if not holders:
        return 200, {'count': 0, 'suggestions': []}
    families = _families(ctx, k)
    people = {(fid, uid): p for fid, fam in families.items() for uid, p in fam['people'].items()}
    best = {}
    for s in link.suggest(holders, people):  # best first: the first per (holder, family) wins
        best.setdefault((s['holderId'], s['key'][0]), s)
    holding = {r for item in ctx.repo.list_assignments(k).values() for r in item['assignments'].values()}
    names = {h['holderId']: h['name'] for h in holders}
    items = [{'holderId': s['holderId'], 'holderName': names[s['holderId']], 'familyId': fid,
              'familyName': families[fid]['names'], 'why': s['why'], 'level': s['level'],
              'familyHoldsSeats': f'family:{fid}' in holding} for (_, fid), s in best.items()]
    items.sort(key=lambda i: (-link.WHY[i['why']], i['familyHoldsSeats'], i['holderId'], i['familyId']))
    return 200, {'count': len(items), 'suggestions': items}


def request_suggestions(ctx, k, rows, holders=None):
    """For the approval card: per requester (a listener, no family yet), the holders that look like them. Returns
    {userId: {count, items: [{holderId, holderName, why, level}]}} for requesters with at least one."""
    holders = ctx.repo.list_holders(k) if holders is None else holders
    if not holders or not rows:
        return {}
    profiles = _profiles(ctx, [r['userId'] for r in rows])
    people = {r['userId']: {'lastName': profiles[r['userId']].get('lastName'),
                            'firstNames': [profiles[r['userId']].get('firstName')] if profiles[r['userId']].get('firstName') else [],
                            'phones': [profiles[r['userId']].get('phone')] if profiles[r['userId']].get('phone') else []}
              for r in rows}
    names = {h['holderId']: h['name'] for h in holders}
    per = {}
    for s in link.suggest(holders, people):
        per.setdefault(s['key'], []).append({'holderId': s['holderId'], 'holderName': names[s['holderId']],
                                             'why': s['why'], 'level': s['level']})
    return {u: link.top(items) for u, items in per.items()}


def _now():
    return datetime.fromtimestamp(time.time(), ZoneInfo('Asia/Jerusalem'))


def _seats_of(ctx, k, ref):
    """The most seats `ref` holds in any one layout version in effect today or later (0 when none)."""
    today = rules.current_shabbat(_now().date()).isoformat()
    layouts = ctx.repo.list_layouts(k)
    current = max((i['effectiveFrom'] for i in layouts if i['effectiveFrom'] <= today), default=today)
    counts = [sum(1 for r in item['assignments'].values() if r == ref)
              for friday, item in ctx.repo.list_assignments(k).items() if friday >= current]
    return max(counts, default=0)


def link_holder(ctx, params):
    """`{familyId, ifUpdatedAt?}`: the holder's seats join the family's in every version, the open and future weeks'
    answers follow, the holder is deleted, and each adult gets a one-time Home card."""
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    item = _holder(ctx, params)
    d = inputs.body_object(ctx, 1024)
    if not set(d) <= {'familyId', 'ifUpdatedAt'} or 'familyId' not in d:
        raise ApiError(400, 'invalid_body')
    family_id = d['familyId']
    if not isinstance(family_id, str) or not ID_RE.fullmatch(family_id):
        raise ApiError(400, 'invalid_body')
    guard = d.get('ifUpdatedAt')
    if 'ifUpdatedAt' in d and (isinstance(guard, bool) or not isinstance(guard, int) and guard is not None):
        raise ApiError(400, 'invalid_body')
    if 'ifUpdatedAt' in d and guard != item.get('updatedAt'):
        raise ApiError(409, 'holder_changed')
    family = ctx.repo.get_family(k, family_id)
    adults = ctx.repo.live_adults(k, family) if family else []
    if not adults:
        raise ApiError(404, 'family_not_found')
    holder_id = item['holderId']
    seats = _seats_of(ctx, k, f'holder:{holder_id}')  # before the move: notices are idempotent per holder
    if seats:
        for m in adults:
            ctx.repo.add_seat_link_notice(k, m['userId'], holder_id, seats, int(time.time()))
    ctx.repo.move_holder_seats(k, holder_id, family_id)
    ctx.repo.rename_week_ref(k, f'holder:{holder_id}', f'family:{family_id}')
    if ctx.repo.holder_ref_left(k, holder_id):
        raise ApiError(409, 'try_again')
    ctx.repo.delete_holder_record(k, holder_id)
    return 200, {'familyId': family_id, 'seats': seats}
