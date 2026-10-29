"""Routes: weekly seat release. A member sees and changes only his family's seats (his cut, before the deadline);
a gabbai sees the whole hall for a week, changes anything any time (marked), applies the old Form's responses and
undoes the last apply. Per Shabbat (its Friday) and prayer (`erev`, `day`)."""
import re
import time
from datetime import datetime, timedelta

from . import inputs, seat_reminders, seat_times, seating_rules as rules, seating_week as wk
from . import authz
from .errors import ApiError
from .ids import ID_RE

_REF = re.compile(r'(family|holder):([0-9A-HJKMNP-TV-Z]{26})')
BODY_MAX = 200 * 1024


def _now():
    return datetime.fromtimestamp(time.time(), wk.TZ)


def _week(value, today):
    return rules.effective_from(value, today)


def _prayer(value):
    if value not in wk.PRAYERS:
        raise ApiError(400, 'invalid_prayer')
    return value


def _deadline(ctx, k, friday):
    return wk.deadline_of(friday, seat_times.deadline_hm(ctx.repo.get_kehila(k).get('settings', {})))


def _ms():
    return int(time.time() * 1000)


# A seat's `by` is 'm' (the member) or the staff code of authz.STAFF_CODES ('g' gabbai, 't' tech).
def _is_staff(by):
    return by in authz.CODE_ROLES


def _staff_role(by):
    return authz.CODE_ROLES[by]


def _states(ctx, k, friday):
    return {p: ctx.repo.get_week(k, friday, p) for p in wk.PRAYERS}


def _effective(item, held):
    """The week item's seat records that still stand: one made for a holder that no longer holds the seat is no
    answer (the seat reads as kept, unflagged)."""
    item = item or {}
    return {**item, 'seats': {s: v for s, v in (item.get('seats') or {}).items() if v.get('h') == held.get(s)}}


def _undo_entry(prev, new_ref):
    """A seat record as the undo data keeps it, small: None (no record), or [r, by, at] plus a 4th item only when
    the holder ref `h` differs from the apply's (0 = the record had none). Keeps a full apply's item bounded."""
    if prev is None:
        return None
    entry = [prev['r'], prev['by'], prev['at']]
    if prev.get('h') != new_ref:
        entry.append(prev.get('h') or 0)
    return entry


def _undo_restore(prev, cur):
    """The seat record an undo entry stands for; `cur` is the record the apply left (its `h` is the apply's)."""
    if isinstance(prev, dict):  # entries written before the compact form
        return prev
    record = {'r': prev[0], 'by': prev[1], 'at': prev[2]}
    ref = prev[3] if len(prev) > 3 else cur.get('h')
    if ref:
        record['h'] = ref
    return record


def _is_released(seats, sid):
    return bool((seats.get(sid) or {}).get('r'))


def _held(ctx, k, layout, only_family=None):
    return ctx.repo.held_seats(k, layout, only_family)


def _had_seats(ctx, k, friday, family_id):
    """His family held a seat in the previous Friday's week (the row's wording after seats were dropped)."""
    if not family_id:
        return False
    before = (datetime.strptime(friday, '%Y-%m-%d') - timedelta(days=7)).strftime('%Y-%m-%d')
    layout = ctx.repo.layout_for(k, before)
    return bool(layout and f'family:{family_id}' in ctx.repo.held_seats(k, layout, family_id).values())


def _out_member(ctx, k, friday, family_id):
    layout = ctx.repo.layout_for(k, friday)
    now = _now()
    deadline = _deadline(ctx, k, friday)
    base = {'week': friday, 'deadline': deadline.isoformat(), 'open': now <= deadline,
            'remindable': seat_reminders.remindable(ctx.repo, k, ctx.repo.family_of(k, ctx.user_id), ctx.user_id)}
    ref = f'family:{family_id}'
    held = _held(ctx, k, layout, family_id) if layout and family_id else {}
    mine = [s for s, r in held.items() if r == ref]
    if not mine:
        return {**base, 'seats': 0, 'hadSeats': _had_seats(ctx, k, friday, family_id)}
    ordered = wk.family_order(layout, mine)
    raw = _states(ctx, k, friday)
    states = {p: _effective(raw[p], held) for p in wk.PRAYERS}
    staff = [v for p in wk.PRAYERS for s in ordered
             if _is_staff((v := (states[p]['seats']).get(s) or {}).get('by'))]
    # His family's own answer; else the latest staff edit on his seats for that prayer (so he is never told "not sent"
    # after the gabbai changed his seats; nothing is stored, so an undo takes it away again).
    answered_at = {}
    for p in wk.PRAYERS:
        own = ((raw[p] or {}).get('answered') or {}).get(ref)
        by_staff = [v.get('at') or 0 for s in ordered if _is_staff((v := states[p]['seats'].get(s) or {}).get('by'))]
        answered_at[p] = own if own is not None else (max(by_staff) or 1 if by_staff else None)
    newest = max(staff, key=lambda v: v.get('at') or 0) if staff else None
    latest = newest['by'] if newest else None
    return {**base, 'seats': len(ordered), 'updatedByGabbai': bool(staff),
            'updatedByRole': _staff_role(latest) if staff else None,
            'updatedByAt': (newest.get('at') or None) if newest else None,
            'freeOrder': [ordered.index(sid) + 1 for sid in wk.free_order(layout, ordered)],
            'answeredAt': {p: answered_at[p] for p in wk.PRAYERS},
            'updatedAt': {p: (raw[p] or {}).get('updatedAt') for p in wk.PRAYERS},
            'answered': {p: answered_at[p] is not None for p in wk.PRAYERS},
            'frames': wk.frames(layout, ordered, states)}


def _family_id(ctx, k):
    family = ctx.repo.family_of(k, ctx.user_id)
    return family['familyId'] if family else None


def get_mine(ctx, params):
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.ADULTS)
    week = ctx.query.get('week') or rules.current_shabbat(_now().date()).isoformat()
    return 200, _out_member(ctx, k, _week(week, _now().date()), _family_id(ctx, k))


def put_mine(ctx, params):
    """`{week, prayer, released: [orders | own seat ids]}` replaces the released set of his family for that prayer."""
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.ADULTS)
    d = inputs.body_object(ctx, 8 * 1024)
    if set(d) != {'week', 'prayer', 'released', 'ifUpdatedAt'}:
        raise ApiError(400, 'invalid_body')
    guard = rules.guard_of(d, 'invalid_body')
    friday = _week(d['week'], _now().date())
    prayer = _prayer(d['prayer'])
    family_id = _family_id(ctx, k)
    layout = ctx.repo.layout_for(k, friday)
    ref = f'family:{family_id}'
    held = _held(ctx, k, layout, family_id) if layout and family_id else {}
    mine = [s for s, r in held.items() if r == ref]
    if not mine:
        raise ApiError(404, 'no_seats')
    ordered = wk.family_order(layout, mine)
    wanted = wk.parse_released(d['released'], ordered)
    if _now() > _deadline(ctx, k, friday):
        raise ApiError(403, 'deadline_passed')
    now = _ms()
    item = ctx.repo.get_week(k, friday, prayer)
    seats = dict((item or {}).get('seats') or {})
    current = _effective(item, held)['seats']
    for sid in ordered:
        want = int(sid in wanted)
        if int(_is_released(current, sid)) != want:
            seats[sid] = {'r': want, 'by': 'm', 'at': now, 'h': ref}
    fields = {**{key: v for key, v in (item or {}).items() if key not in ('pk', 'sk', 'updatedAt')}, 'seats': seats,
              'answered': {**((item or {}).get('answered') or {}), ref: now}}
    ctx.repo.put_week(k, friday, prayer, fields, guard)
    return 200, _out_member(ctx, k, friday, family_id)


def _names(ctx, k, refs):
    names = {}
    holders = None
    for ref in refs:
        kind, ident = ref.split(':')
        if kind == 'family':
            family = ctx.repo.get_family(k, ident)
            live = ctx.repo.live_adults(k, family) if family else []
            names[ref] = ', '.join(m.get('displayName', '') for m in live)
        else:
            if holders is None:
                holders = {h['holderId']: h['name'] for h in ctx.repo.list_holders(k)}
            names[ref] = holders.get(ident, '')
    return names


def _prayer_out(item, held):
    item = _effective(item, held)
    return {'seats': {s: {'released': bool(v.get('r')), 'by': _staff_role(v['by']) if _is_staff(v.get('by')) else 'member',
                          'at': v.get('at')} for s, v in (item.get('seats') or {}).items()},
            'requests': item.get('requests') or {}, 'canUndo': bool(item.get('undo')),
            'answered': {r: at for r, at in (item.get('answered') or {}).items() if r in held.values()},
            'updatedAt': item.get('updatedAt')}


def get_week(ctx, params):
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    friday = _week(params['week'], _now().date())
    layout = ctx.repo.layout_for(k, friday)
    if not layout:
        raise ApiError(404, 'layout_not_found')
    held = _held(ctx, k, layout)
    deadline = _deadline(ctx, k, friday)
    states = _states(ctx, k, friday)
    return 200, {'week': friday, 'deadline': deadline.isoformat(), 'open': _now() <= deadline,
                 'layout': {key: layout[key] for key in ('effectiveFrom', 'rows', 'cols', 'cells', 'blocks',
                                                         'rowLabels', 'seats')},
                 'assignments': held, 'households': _names(ctx, k, set(held.values())),
                 'prayers': {p: _prayer_out(states[p], held) for p in wk.PRAYERS}}


def _times_out(ctx, k):
    settings = ctx.repo.get_kehila(k).get('settings', {})
    friday = rules.current_shabbat(_now().date()).isoformat()
    layout = ctx.repo.layout_for(k, friday)
    sent = ctx.repo.seat_reminders_sent(k, friday)
    return {'opens': dict(seat_times.OPENS), 'reminders': seat_times.reminders_of(settings),
            'deadline': seat_times.deadline_hm(settings), 'week': friday, 'layout': bool(layout),
            'pending': len(seat_reminders.unanswered_families(ctx.repo, k, friday)) if layout else None,
            'sent': {n: n in sent for n in seat_times.DEFAULT_REMINDERS}}


def get_times(ctx, params):
    authz.require(ctx.repo, ctx.user_id, params['k'], authz.MANAGEMENT)
    return 200, _times_out(ctx, params['k'])


def put_times(ctx, params):
    """`{deadline?, reminders?: {n: {on?, day?, time?}}}` (at least one): the merged chain must stay in order."""
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    d = inputs.body_object(ctx)
    if not d or not set(d) <= {'deadline', 'reminders'}:
        raise ApiError(400, 'invalid_body')
    settings = ctx.repo.get_kehila(k).get('settings', {})
    current = seat_times.reminders_of(settings)
    reminders = seat_times.parse_reminders(d['reminders'], current) if 'reminders' in d else current
    deadline = wk.valid_deadline(d['deadline']) if 'deadline' in d else seat_times.deadline_hm(settings)
    changed = f"reminders.{next(iter(d['reminders']))}" if 'reminders' in d and d['reminders'] else 'deadline'
    seat_times.check(reminders, deadline, changed)
    ctx.repo.set_settings(k, seat_deadline=deadline if 'deadline' in d else None,
                          seat_reminders=reminders if 'reminders' in d else None,
                          expect={'seatReminders': settings.get('seatReminders'), 'seatDeadline': settings.get('seatDeadline')})
    return 200, _times_out(ctx, k)


def put_week(ctx, params):
    """On behalf: `{prayer, released: {seatId: bool}, ifUpdatedAt}`, any time, any assigned seat, marked gabbai."""
    k = params['k']
    staff = authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)['role']
    friday = _week(params['week'], _now().date())
    d = inputs.body_object(ctx, 64 * 1024)
    if set(d) != {'prayer', 'released', 'ifUpdatedAt'}:
        raise ApiError(400, 'invalid_body')
    prayer = _prayer(d['prayer'])
    guard = rules.guard_of(d, 'invalid_body')
    layout = ctx.repo.layout_for(k, friday)
    if not layout:
        raise ApiError(404, 'layout_not_found')
    held = _held(ctx, k, layout)
    changes = d['released']
    if not isinstance(changes, dict) or len(changes) > wk.MAX_ROWS * 2 \
            or any(s not in held or not isinstance(v, bool) for s, v in changes.items()):
        raise ApiError(400, 'invalid_released')
    item = ctx.repo.get_week(k, friday, prayer)
    seats = dict((item or {}).get('seats') or {})
    current = _effective(item, held)['seats']
    now = _ms()
    for sid, want in changes.items():
        if _is_released(current, sid) != want:
            seats[sid] = {'r': int(want), 'by': authz.STAFF_CODES[staff], 'at': now, 'h': held[sid]}
    answered = dict((item or {}).get('answered') or {})
    for sid in changes:
        answered[held[sid]] = now
    fields = {**{key: v for key, v in (item or {}).items() if key not in ('pk', 'sk', 'updatedAt')}, 'seats': seats,
              'answered': answered}
    updated = ctx.repo.put_week(k, friday, prayer, fields, guard)
    return 200, {'updatedAt': updated}


def apply_responses(ctx, params):
    """`{event, rows:[{household, released, requests?}]}`; later rows win. Counts above the seats clamp (warning)."""
    k = params['k']
    staff = authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)['role']
    friday = _week(params['week'], _now().date())
    d = inputs.body_object(ctx, BODY_MAX)
    if set(d) != {'event', 'rows'} or not isinstance(d['rows'], list) or len(d['rows']) > wk.MAX_ROWS:
        raise ApiError(400, 'invalid_responses')
    prayer = _prayer(d['event'])
    layout = ctx.repo.layout_for(k, friday)
    if not layout:
        raise ApiError(404, 'layout_not_found')
    held = _held(ctx, k, layout)
    by_household = {}
    duplicates = 0
    holders = None
    for i, row in enumerate(d['rows']):
        path = f'rows.{i}'
        if not isinstance(row, dict) or not {'household', 'released'} <= set(row) <= {'household', 'released', 'requests', 'override'} \
                or not isinstance(row.get('override', False), bool):
            raise ApiError(400, 'invalid_responses', path)
        ref, count = row['household'], row['released']
        if not isinstance(ref, str) or not _REF.fullmatch(ref):
            raise ApiError(400, 'invalid_responses', path + '.household')
        if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 9999:
            raise ApiError(400, 'invalid_responses', path + '.released')
        requests = wk.validate_requests(row['requests']) if 'requests' in row else None
        if ref not in held.values():
            kind, ident = ref.split(':')
            if kind == 'family':
                family = ctx.repo.get_family(k, ident)
                known = bool(family and ctx.repo.live_adults(k, family))
            else:
                if holders is None:
                    holders = {h['holderId'] for h in ctx.repo.list_holders(k)}
                known = ident in holders
            if not known:
                raise ApiError(400, 'unknown_household', path + '.household')
        duplicates += ref in by_household
        by_household[ref] = (count, requests, bool(row.get('override')))
    seats_of = {}
    for sid, ref in held.items():
        seats_of.setdefault(ref, []).append(sid)
    now = _ms()
    result = {}

    def change(item):
        eff = _effective(item, held)['seats']
        item = item or {}
        seats = dict(item.get('seats') or {})
        reqs = dict(item.get('requests') or {})
        undo_seats, undo_reqs, warnings, applied, released_n, kept_n = {}, {}, [], 0, 0, 0
        totals = {}

        def store_requests(ref, requests):
            if requests is not None:
                undo_reqs[ref] = reqs.get(ref)
                reqs[ref] = requests
                for area, n in requests.items():
                    totals[area] = totals.get(area, 0) + n
        for ref, (count, requests, override) in by_household.items():
            ordered = wk.family_order(layout, seats_of.get(ref, []))
            if not ordered:
                warnings.append({'household': ref, 'code': 'no_seats'})  # about the release only
                store_requests(ref, requests)  # requests are kept for any valid household, seats or not
                continue
            if not override and any((eff.get(sid) or {}).get('by') == 'm' for sid in ordered):
                warnings.append({'household': ref, 'code': 'app_answer_kept'})
                store_requests(ref, requests)  # the seat answer stays the member's; the extra-seat requests still count
                continue
            if count > len(ordered):
                warnings.append({'household': ref, 'code': 'above_seats'})
            free = wk.to_release(wk.free_order(layout, ordered), count)
            applied += 1
            released_n += len(free)
            kept_n += len(ordered) - len(free)
            for sid in ordered:
                want = int(sid in free)
                if int(_is_released(eff, sid)) != want:
                    undo_seats[sid] = _undo_entry(seats.get(sid), ref)
                    seats[sid] = {'r': want, 'by': authz.STAFF_CODES[staff], 'at': now, 'h': ref}
            store_requests(ref, requests)
        result.update(households=applied, released=released_n, kept=kept_n, warnings=warnings, requestTotals=totals)
        return {'seats': seats, 'requests': reqs, 'answered': item.get('answered') or {},
                'undo': {'at': now, 'seats': undo_seats, 'requests': undo_reqs}}
    ctx.repo.change_week(k, friday, prayer, change)
    return 200, {'event': prayer, 'duplicates': duplicates, **result}


def undo_responses(ctx, params):
    """Undo the last apply for that week and event: seats still as the apply left them go back; seats changed
    since (by a member or a gabbai) stay."""
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    friday = _week(params['week'], _now().date())
    d = inputs.body_object(ctx, 1024)
    if set(d) != {'event'}:
        raise ApiError(400, 'invalid_body')
    prayer = _prayer(d['event'])
    if not (ctx.repo.get_week(k, friday, prayer) or {}).get('undo'):
        raise ApiError(404, 'nothing_to_undo')
    skipped = []

    def change(item):
        undo = (item or {}).get('undo')
        if not undo:
            raise ApiError(404, 'nothing_to_undo')
        seats = dict(item.get('seats') or {})
        skipped.clear()
        for sid, prev in undo['seats'].items():
            cur = seats.get(sid) or {}
            if _is_staff(cur.get('by')) and cur.get('at') == undo['at']:  # still as the apply left it
                if prev is None:
                    seats.pop(sid, None)
                else:
                    seats[sid] = _undo_restore(prev, cur)
            else:
                skipped.append(sid)
        reqs = dict(item.get('requests') or {})
        for ref, prev in undo['requests'].items():
            if prev is None:
                reqs.pop(ref, None)
            else:
                reqs[ref] = prev
        return {'seats': seats, 'requests': reqs, 'answered': item.get('answered') or {}}
    ctx.repo.change_week(k, friday, prayer, change)
    return 200, {'event': prayer, 'restored': True, 'skipped': len(skipped)}
