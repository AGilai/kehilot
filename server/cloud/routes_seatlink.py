"""Routes: suggest and confirm linking a seat holder (no account) to a registered family. Gabbai-only. A link is a
gabbai's confirm (spec ruling 7: a family that already holds seats gets the union), except the one certain case the owner
allowed: when a gabbai approves a member, auto_link_family links the single holder that unmistakably is that family (below),
leaves a record the gabbai sees for 14 days and can undo."""
import logging
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
CERTAIN = ('phone-surname', 'surname-initial')  # what may auto-link; everything else (a bare phone too) stays a suggestion
UNDO_SECONDS = 14 * 86400
KEEP_SECONDS = 30 * 86400  # the record (names, phone) is erased by the table TTL after this
log = logging.getLogger(__name__)


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
    rec = ctx.repo.get_auto_link(k, item['holderId'])
    if rec and rec.get('state') == 'pending':
        raise ApiError(409, 'try_again')  # the automatic link is mid-way: finish it first
    seats = _move(ctx, k, item['holderId'], family_id, adults)
    return 200, {'familyId': family_id, 'seats': seats}


def _move(ctx, k, holder_id, family_id, adults, seats=None):
    """The confirmed link itself (shared by the gabbai's confirm and the auto-link); returns the seat count."""
    if seats is None:
        seats = _seats_of(ctx, k, f'holder:{holder_id}')  # before the move: notices are idempotent per holder
    if seats:
        for m in adults:
            ctx.repo.add_seat_link_notice(k, m['userId'], holder_id, seats, int(time.time()))
    ctx.repo.move_holder_seats(k, holder_id, family_id)
    ctx.repo.rename_week_ref(k, f'holder:{holder_id}', f'family:{family_id}')
    if ctx.repo.holder_ref_left(k, holder_id):
        raise ApiError(409, 'try_again')
    ctx.repo.delete_holder_record(k, holder_id)
    return seats


# ------------------------------------------------------------------------------------------------- auto-link
def _person(profile):
    return {'lastName': profile.get('lastName'), 'firstNames': [profile['firstName']] if profile.get('firstName') else [],
            'phones': [profile['phone']] if profile.get('phone') else []}


def _initial(profile):
    return link.normalize(profile.get('firstName') or '')[:1]


def certain_holder(ctx, k, adults):
    """The one holder that unmistakably is this family, or None. Certain means ALL of:
    - one candidate only: a holder whose explicit initial + surname are ONE adult's own first initial and surname, or whose
      phone is the same adult's and who also has that adult's surname (a bare phone is only a suggestion);
    - surname+initial: no other holder has that surname (spelling variants, any initial or none), and nobody else in the
      Kehila (members, listeners, requesters) has that surname with that initial (or no first name);
    - phone: no other holder has that phone and no other profile has it."""
    holders = ctx.repo.list_holders(k)
    ids = [m['userId'] for m in adults]
    profiles = _profiles(ctx, ids)
    found = {}
    for h in holders:
        for uid in ids:
            m = link.match(h, _person(profiles[uid]))
            if m and m[0] in CERTAIN:
                found.setdefault(h['holderId'], (h, m[0], uid))
    if len(found) != 1:
        return None
    holder, why, uid = next(iter(found.values()))
    others = [o for o in holders if o['holderId'] != holder['holderId']]
    mine = set(ids)
    holding = {r for item in ctx.repo.list_assignments(k).values() for r in item['assignments'].values()}
    # (userId, can't-be-ruled-out-when-unknown): members not yet seated and requesters could be a holder's own household
    people = {m['userId']: m.get('role') in MEMBER_ROLES and f'family:{m.get("familyId")}' not in holding
              for m in ctx.repo.list_members(k) if m['userId'] not in mine}
    for r in ctx.repo.list_requests(k):
        uid = r['sk'][len('REQ#'):]
        if uid not in mine:
            people[uid] = True
    others_profiles = _profiles(ctx, list(people))
    if why == 'phone-surname':
        digits = link.digits(holder.get('phone'))
        if any(link.digits(o.get('phone')) == digits for o in others):
            return None
        if any(link.digits(p.get('phone')) == digits for p in others_profiles.values()):
            return None
        return holder
    if any(link.holder_blocks(holder['name'], o['name']) for o in others):
        return None
    initial = link.split_holder_name(holder['name'])[1]
    for uid, p in others_profiles.items():
        known = link.has_hebrew(p.get('lastName'))
        if not known and people[uid]:
            return None  # no Hebrew surname on file: can't be ruled out
        first = _initial(p)
        if known and link.surname_alike(holder['name'], p.get('lastName')) and (not first or not link.has_hebrew(first) or first == initial):
            return None
    return holder


def _finish(ctx, k, rec):
    """Run (or resume) the recorded link: add the seats put on the holder since, then the confirmed link itself."""
    holder_id, family_id = rec['holderId'], rec['familyId']
    fresh = ctx.repo.get_auto_link(k, holder_id)
    if not fresh or fresh.get('state') != 'pending':
        return  # cancelled, being undone or expired meanwhile: never run it
    family = ctx.repo.get_family(k, family_id)
    adults = ctx.repo.live_adults(k, family) if family else []
    if not adults:
        raise ApiError(404, 'family_not_found')
    ref = f'holder:{holder_id}'
    moved = {f: list(v) for f, v in (rec.get('moved') or {}).items()}
    grown = False
    for friday, item in ctx.repo.list_assignments(k).items():
        extra = [s for s, r in item['assignments'].items() if r == ref and s not in moved.get(friday, ())]
        if extra:
            moved[friday] = sorted(moved.get(friday, []) + extra)
            grown = True
    if grown:
        ctx.repo.update_auto_link(k, holder_id, {'moved': moved})
    _move(ctx, k, holder_id, family_id, adults, int(rec['seats']))
    if not ctx.repo.update_auto_link(k, holder_id, {'state': 'done'}, if_state='pending'):
        # A cancel landed while we moved: put everything back the way the cancel would have (the cancel itself found
        # nothing moved yet). Week records were not restored by it either: their snapshot is gone with the scrub.
        if not ctx.repo.get_holder(k, holder_id):
            ctx.repo.put_holder(k, holder_id, fresh['holderName'], fresh.get('holderPhone'), created=int(fresh['holderCreatedAt']))
        _restore_seats(ctx, k, holder_id, family_id, moved)
        for m in adults:
            ctx.repo.drop_seat_link_holder(k, m['userId'], holder_id, int(rec['seats']))


def auto_link_family(ctx, k, user_id):
    """Called when a gabbai approved `user_id` as a member. Links the ONE holder that certainly is this family
    (certain_holder), after recording a pending snapshot (seats and week records that move) so the run can be resumed and
    undone. Idempotent; leaves linked, mid-link and un-linked (tombstoned) holders alone. Returns the holder id or None.
    Never logs names."""
    membership = ctx.repo.get_membership(k, user_id)
    family_id = (membership or {}).get('familyId')
    if not family_id or membership.get('role') not in MEMBER_ROLES:
        return None
    family = ctx.repo.get_family(k, family_id)
    adults = ctx.repo.live_adults(k, family) if family else []
    if not adults or not ctx.repo.list_holders(k):
        return None
    holder = certain_holder(ctx, k, adults)
    if not holder:
        return None
    holder_id = holder['holderId']
    if ctx.repo.has_auto_tombstone(k, holder_id):
        return None  # a gabbai said 'not them' before
    if any(holder_id in (m.get('seatLinkHolders') or ()) for m in ctx.repo.list_members(k)):
        return None  # a manual link is mid-way
    ref = f'holder:{holder_id}'
    moved = {friday: sorted(s for s, r in item['assignments'].items() if r == ref)
             for friday, item in ctx.repo.list_assignments(k).items()}
    now = int(time.time())
    rec = {'state': 'pending', 'familyId': family_id, 'holderName': holder['name'], 'holderPhone': holder.get('phone'),
           'holderCreatedAt': holder['createdAt'], 'familyName': ', '.join(m.get('displayName', '') for m in adults),
           'seats': _seats_of(ctx, k, ref), 'moved': {f: v for f, v in moved.items() if v},
           'weeks': ctx.repo.week_snapshots(k, ref, f'family:{family_id}'), 'at': now, 'expiresAt': now + KEEP_SECONDS}
    if not ctx.repo.put_auto_link(k, holder_id, rec):
        return None
    _finish(ctx, k, {**rec, 'holderId': holder_id})
    log.info('seat auto-link kehila=%s holder=%s family=%s', k, holder_id, family_id)
    return holder_id


def resume_pending(ctx, k):
    """Finish auto-links that stopped half-way (every later approval retries them)."""
    now = int(time.time())
    for rec in ctx.repo.list_auto_links(k):
        if rec.get('state') == 'pending' and int(rec['at']) + UNDO_SECONDS <= now:
            ctx.repo.update_auto_link(k, rec['holderId'], {'state': 'expired'})  # too late to run unseen: a suggestion again
        elif rec.get('state') == 'pending':
            try:
                _finish(ctx, k, rec)
            except Exception as error:
                _warn('seat auto-link resume failed', k, error, rec['holderId'])


def _warn(text, k, error, ref):
    log.warning('%s kehila=%s ref=%s error=%s%s', text, k, ref, type(error).__name__,
                f' code={error.code}' if isinstance(error, ApiError) else '')


def try_auto_link(ctx, k, user_id):
    """The hook: an auto-link never breaks the approval."""
    try:
        resume_pending(ctx, k)
    except Exception as error:
        _warn('seat auto-link resume failed', k, error, user_id)
    try:
        auto_link_family(ctx, k, user_id)
    except Exception as error:
        _warn('seat auto-link failed', k, error, user_id)


def list_auto_links(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    now = int(time.time())
    items = [{'holderId': r['holderId'], 'holderName': r['holderName'], 'familyId': r['familyId'],
              'familyName': r['familyName'], 'seats': int(r['seats']), 'state': 'pending' if r['state'] == 'pending' else 'done', 'at': int(r['at']),
              'expiresAt': int(r['at']) + UNDO_SECONDS}
             for r in ctx.repo.list_auto_links(k) if r.get('state') in ('pending', 'done', 'cancelled', 'undoing') and int(r['at']) + UNDO_SECONDS > now]
    items.sort(key=lambda i: (-i['at'], i['holderId']))
    return 200, {'count': len(items), 'items': items}


def _auto_record(ctx, params, live_states):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
    holder_id = params['holderId']
    rec = ctx.repo.get_auto_link(k, holder_id) if ID_RE.fullmatch(holder_id) else None
    if not rec or rec.get('state') in ('undone', 'expired'):
        raise ApiError(404, 'autolink_not_found')
    if rec['state'] not in live_states:
        raise ApiError(409, 'autolink_not_pending')
    return k, rec


def finish_auto_link(ctx, params):
    """A gabbai's retry of an auto-link that stopped half-way."""
    k, rec = _auto_record(ctx, params, ('pending',))
    _finish(ctx, k, rec)
    return 200, {'holderId': rec['holderId']}


def _restore_weeks(ctx, k, rec):
    ctx.repo.restore_week_ref(k, f'holder:{rec["holderId"]}', f'family:{rec["familyId"]}', rec.get('weeks') or {})


def _restore_seats(ctx, k, holder_id, family_id, moved):
    """Moves each recorded seat that is still the family's back to the holder (the guard is applied on the fresh read of
    every attempt); returns how many seats were left alone because they changed meanwhile."""
    family_ref, ref = f'family:{family_id}', f'holder:{holder_id}'
    skipped = 0
    for friday, seats in moved.items():
        for _ in range(4):
            item = ctx.repo.get_assignments(k, friday)
            if not item:
                skipped += len(seats)
                break
            back = dict(item['assignments'])
            skipped_here = 0
            for sid in seats:  # the guard is applied on the fresh read of every attempt
                if back.get(sid) == family_ref:
                    back[sid] = ref
                elif back.get(sid) != ref:
                    skipped_here += 1
            try:
                if back != item['assignments']:
                    ctx.repo.put_assignments(k, friday, back, item['updatedAt'])
                skipped += skipped_here
                break
            except ApiError:
                continue
        else:
            raise ApiError(409, 'try_again')
    return skipped


def undo_auto_link(ctx, params):
    """Restores the holder and moves back every seat that is still the family's (a seat the gabbai changed since is left
    as it is and counted in `skipped`; 409 `autolink_changed` when none could be restored). Week records follow, the
    family's Home card loses the holder, and a tombstone keeps the holder from being auto-linked again. Resumable."""
    k, rec = _auto_record(ctx, params, ('pending', 'done', 'cancelled', 'undoing'))
    holder_id = rec['holderId']
    if int(rec['at']) + UNDO_SECONDS <= int(time.time()):
        raise ApiError(410, 'autolink_expired')
    family_ref, ref = f'family:{rec["familyId"]}', f'holder:{holder_id}'
    if rec['state'] in ('pending', 'done'):
        current = ctx.repo.list_assignments(k)
        todo = skipped = 0
        for friday, seats in (rec.get('moved') or {}).items():
            assigned = (current.get(friday) or {}).get('assignments') or {}
            for sid in seats:
                if assigned.get(sid) == family_ref:
                    todo += 1
                elif assigned.get(sid) != ref:
                    skipped += 1
        if rec['state'] == 'done' and skipped and not todo:
            raise ApiError(409, 'autolink_changed')
        # from here on resume and finish refuse the record, a retry of the undo just carries on; the tombstone is written
        # first so nothing can link the holder again, not even after the record's TTL
        ctx.repo.put_auto_tombstone(k, holder_id, rec['familyId'])
        ctx.repo.update_auto_link(k, holder_id, {'state': 'cancelled' if rec['state'] == 'pending' else 'undoing'})
    if not ctx.repo.get_holder(k, holder_id):
        ctx.repo.put_holder(k, holder_id, rec['holderName'], rec.get('holderPhone'), created=int(rec['holderCreatedAt']))
    skipped = _restore_seats(ctx, k, holder_id, rec['familyId'], rec.get('moved') or {})
    _restore_weeks(ctx, k, rec)
    family = ctx.repo.get_family(k, rec['familyId'])
    for m in (ctx.repo.live_adults(k, family) if family else []):
        ctx.repo.drop_seat_link_holder(k, m['userId'], holder_id, int(rec['seats']))
    ctx.repo.update_auto_link(k, holder_id, {'state': 'undone', 'holderName': '', 'holderPhone': None, 'familyName': '',
                                             'moved': {}, 'weeks': {}})  # no personal data stays; the tombstone item is permanent
    return 200, {'holderId': holder_id, 'skipped': skipped}
