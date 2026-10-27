"""Routes: weekly seat release. A member sees and changes only his family's seats (his cut, before the deadline);
a gabbai sees the whole hall for a week, changes anything any time (marked), applies the old Form's responses and
undoes the last apply. Per Shabbat (its Friday) and prayer (`erev`, `day`)."""
import re
import time
from datetime import datetime

from . import inputs, seating_rules as rules, seating_week as wk
from .authz import require
from .errors import ApiError
from .ids import ID_RE
from .routes_families import MEMBERS
from .routes_groups import GABBAI

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
    return wk.deadline_of(friday, ctx.repo.get_kehila(k).get('settings', {}).get('seatDeadline'))


def _ms():
    return int(time.time() * 1000)


def _states(ctx, k, friday):
    return {p: ctx.repo.get_week(k, friday, p) for p in wk.PRAYERS}


def _held(ctx, k, layout):
    """seatId -> ref for the layout version's live assignments (a vanished family holds nothing)."""
    item = ctx.repo.get_assignments(k, layout['effectiveFrom'])
    ids = {s['id'] for s in layout['seats']}
    live, out = {}, {}
    for seat, ref in (item['assignments'] if item else {}).items():
        if seat not in ids:
            continue
        if ref.startswith('family:'):
            fid = ref[len('family:'):]
            if fid not in live:
                family = ctx.repo.get_family(k, fid)
                live[fid] = bool(family and ctx.repo.live_adults(k, family))
            if not live[fid]:
                continue
        out[seat] = ref
    return out


def _out_member(ctx, k, friday, family_id):
    layout = ctx.repo.layout_for(k, friday)
    now = _now()
    deadline = _deadline(ctx, k, friday)
    base = {'week': friday, 'deadline': deadline.isoformat(), 'open': now <= deadline}
    if not layout or not family_id:
        return {**base, 'seats': 0}
    ref = f'family:{family_id}'
    mine = [s for s, r in _held(ctx, k, layout).items() if r == ref]
    if not mine:
        return {**base, 'seats': 0}
    ordered = wk.family_order(layout, mine)
    states = _states(ctx, k, friday)
    flagged = any(((states[p] or {}).get('seats', {}).get(s) or {}).get('by') == 'g' for p in wk.PRAYERS for s in ordered)
    return {**base, 'seats': len(ordered), 'updatedByGabbai': flagged, 'frames': wk.frames(layout, ordered, states)}


def _family_id(ctx, k):
    family = ctx.repo.family_of(k, ctx.user_id)
    return family['familyId'] if family else None


def get_mine(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, MEMBERS)
    week = ctx.query.get('week') or rules.current_shabbat(_now().date()).isoformat()
    return 200, _out_member(ctx, k, _week(week, _now().date()), _family_id(ctx, k))


def put_mine(ctx, params):
    """`{week, prayer, released: [orders | own seat ids]}` replaces the released set of his family for that prayer."""
    k = params['k']
    require(ctx.repo, ctx.user_id, k, MEMBERS)
    d = inputs.body_object(ctx, 8 * 1024)
    if set(d) != {'week', 'prayer', 'released'}:
        raise ApiError(400, 'invalid_body')
    friday = _week(d['week'], _now().date())
    prayer = _prayer(d['prayer'])
    family_id = _family_id(ctx, k)
    layout = ctx.repo.layout_for(k, friday)
    ref = f'family:{family_id}'
    mine = [s for s, r in _held(ctx, k, layout).items() if r == ref] if layout and family_id else []
    if not mine:
        raise ApiError(404, 'no_seats')
    ordered = wk.family_order(layout, mine)
    wanted = wk.parse_released(d['released'], ordered)
    if _now() > _deadline(ctx, k, friday):
        raise ApiError(403, 'deadline_passed')
    now = _ms()

    def change(item):
        seats = dict((item or {}).get('seats') or {})
        for sid in ordered:
            want = int(sid in wanted)
            if int((seats.get(sid) or {}).get('r', 0)) != want:
                seats[sid] = {'r': want, 'by': 'm', 'at': now}
        return {**{key: v for key, v in (item or {}).items() if key not in ('pk', 'sk', 'updatedAt')}, 'seats': seats}
    ctx.repo.change_week(k, friday, prayer, change)
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


def _prayer_out(item):
    item = item or {}
    return {'seats': {s: {'released': bool(v.get('r')), 'by': 'gabbai' if v.get('by') == 'g' else 'member',
                          'at': v.get('at')} for s, v in (item.get('seats') or {}).items()},
            'requests': item.get('requests') or {}, 'canUndo': bool(item.get('undo')),
            'updatedAt': item.get('updatedAt')}


def get_week(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
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
                 'prayers': {p: _prayer_out(states[p]) for p in wk.PRAYERS}}


def put_week(ctx, params):
    """On behalf: `{prayer, released: {seatId: bool}, ifUpdatedAt}`, any time, any assigned seat, marked gabbai."""
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
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
    now = _ms()
    for sid, want in changes.items():
        if bool((seats.get(sid) or {}).get('r')) != want:
            seats[sid] = {'r': int(want), 'by': 'g', 'at': now}
    fields = {**{key: v for key, v in (item or {}).items() if key not in ('pk', 'sk', 'updatedAt')}, 'seats': seats}
    updated = ctx.repo.put_week(k, friday, prayer, fields, guard)
    return 200, {'updatedAt': updated}


def apply_responses(ctx, params):
    """`{event, rows:[{household, released, requests?}]}`; later rows win. Counts above the seats clamp (warning)."""
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
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
        if not isinstance(row, dict) or not {'household', 'released'} <= set(row) <= {'household', 'released', 'requests'}:
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
        by_household[ref] = (count, requests)
    seats_of = {}
    for sid, ref in held.items():
        seats_of.setdefault(ref, []).append(sid)
    warnings, released_n, kept_n, touched = [], 0, 0, {}
    now = _ms()
    plan = {}  # seatId -> 0|1
    plan_requests = {}
    for ref, (count, requests) in by_household.items():
        ordered = wk.family_order(layout, seats_of.get(ref, []))
        if not ordered:
            warnings.append({'household': ref, 'code': 'no_seats'})
            continue
        if count > len(ordered):
            warnings.append({'household': ref, 'code': 'above_seats'})
        free = wk.to_release(ordered, count)
        for sid in ordered:
            plan[sid] = int(sid in free)
        released_n += len(free)
        kept_n += len(ordered) - len(free)
        if requests is not None:
            plan_requests[ref] = requests

    def change(item):
        item = item or {}
        seats = dict(item.get('seats') or {})
        reqs = dict(item.get('requests') or {})
        undo_seats = {}
        for sid, r in plan.items():
            new = {'r': r, 'by': 'g', 'at': now}
            undo_seats[sid] = {'prev': seats.get(sid), 'applied': new}
            seats[sid] = new
        undo_reqs = {}
        for ref, requests in plan_requests.items():
            undo_reqs[ref] = reqs.get(ref)
            reqs[ref] = requests
        return {'seats': seats, 'requests': reqs, 'undo': {'at': now, 'seats': undo_seats, 'requests': undo_reqs}}
    ctx.repo.change_week(k, friday, prayer, change)
    totals = {}
    for requests in plan_requests.values():
        for area, n in requests.items():
            totals[area] = totals.get(area, 0) + n
    return 200, {'event': prayer, 'households': len([r for r in by_household if r in seats_of]),
                 'released': released_n, 'kept': kept_n, 'duplicates': duplicates, 'warnings': warnings,
                 'requestTotals': totals}


def undo_responses(ctx, params):
    """Undo the last apply for that week and event: seats still as the apply left them go back; seats changed
    since (by a member or a gabbai) stay."""
    k = params['k']
    require(ctx.repo, ctx.user_id, k, GABBAI)
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
        for sid, rec in undo['seats'].items():
            if seats.get(sid) == rec['applied']:
                if rec['prev'] is None:
                    seats.pop(sid, None)
                else:
                    seats[sid] = rec['prev']
            else:
                skipped.append(sid)
        reqs = dict(item.get('requests') or {})
        for ref, prev in undo['requests'].items():
            if prev is None:
                reqs.pop(ref, None)
            else:
                reqs[ref] = prev
        return {'seats': seats, 'requests': reqs}
    ctx.repo.change_week(k, friday, prayer, change)
    return 200, {'event': prayer, 'restored': True, 'skipped': len(skipped)}
