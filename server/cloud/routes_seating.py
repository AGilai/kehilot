"""Routes: hall layouts (versioned by the Friday they take effect), seat holders and seat assignments.
Gabbai-only: members never receive the hall or any name (their own cut comes in a later route)."""
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from . import inputs, seating_rules as rules
from . import authz
from .errors import ApiError
from .ids import ID_RE, new_id


def _today():
    return datetime.fromtimestamp(time.time(), ZoneInfo('Asia/Jerusalem')).date()


def _friday(params):
    return rules.effective_from(params['from'], _today())


def _layout_out(item):
    return {key: item[key] for key in ('effectiveFrom', 'rows', 'cols', 'cells', 'blocks', 'rowLabels', 'seats',
                                       'updatedAt')}


def list_layouts(ctx, params):
    """History, newest first. `current` marks the version in effect today (the latest one not after today)."""
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    today = _today().isoformat()
    layouts = sorted(ctx.repo.list_layouts(k), key=lambda i: i['effectiveFrom'], reverse=True)
    assigned = ctx.repo.list_assignments(k)
    current = next((i['effectiveFrom'] for i in layouts if i['effectiveFrom'] <= today), None)
    out = []
    for item in layouts:
        ids = {s['id'] for s in item['seats']}
        held = assigned.get(item['effectiveFrom'], {}).get('assignments', {})
        out.append({'effectiveFrom': item['effectiveFrom'], 'updatedAt': item['updatedAt'],
                    'seats': len(item['seats']), 'assigned': sum(1 for s in held if s in ids),
                    'current': item['effectiveFrom'] == current})
    return 200, {'layouts': out}


def get_layout(ctx, params):
    authz.require(ctx.repo, ctx.user_id, params['k'], authz.MANAGEMENT)
    item = ctx.repo.get_layout(params['k'], _friday(params))
    if not item:
        raise ApiError(404, 'layout_not_found')
    return 200, _layout_out(item)


def put_layout(ctx, params):
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    friday = _friday(params)
    rules.not_in_past(friday, _today())
    d = inputs.body_object(ctx, rules.LAYOUT_BODY_MAX)
    layout = rules.validate_layout(d)
    guard = rules.guard_of(d, 'invalid_layout')
    old = ctx.repo.get_layout(k, friday)
    earlier = [i['seats'] for i in sorted(ctx.repo.list_layouts(k), key=lambda i: i['effectiveFrom'], reverse=True)
               if i['effectiveFrom'] < friday]  # nearest first: a seat removed and re-added gets its old id back
    seats = rules.assign_seats(layout['cells'], old['seats'] if old else [], *earlier)
    ctx.repo.add_seat_kehila(k)  # before the save: a registered Kehila without a layout is harmless, the reverse is not
    updated = ctx.repo.put_layout(k, friday, layout, seats, guard)
    ctx.repo.prune_assignments(k, friday, {s['id'] for s in seats})
    return 200, {**_layout_out({**layout, 'effectiveFrom': friday, 'seats': seats, 'updatedAt': updated})}


def get_assignments(ctx, params):
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    friday = _friday(params)
    layout = ctx.repo.get_layout(k, friday)
    if not layout:
        raise ApiError(404, 'layout_not_found')
    item = ctx.repo.get_assignments(k, friday)
    ids = {s['id'] for s in layout['seats']}
    live = {}  # a family that no longer exists holds nothing
    held = {}
    for s, r in (item['assignments'] if item else {}).items():
        if s not in ids:
            continue
        if r.startswith('family:'):
            fid = r[len('family:'):]
            if fid not in live:
                live[fid] = bool(ctx.repo.get_family(k, fid))
            if not live[fid]:
                continue
        held[s] = r
    return 200, {'assignments': held, 'updatedAt': item['updatedAt'] if item else None}


def _live_family(ctx, k, family_id):
    family = ctx.repo.get_family(k, family_id)
    return bool(family and ctx.repo.live_adults(k, family))


def put_assignments(ctx, params):
    """`{assignments: {seatId: 'family:<id>'|'holder:<id>'|null}, ifUpdatedAt}`: a merge; null frees the seat."""
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    friday = _friday(params)
    rules.not_in_past(friday, _today())
    d = inputs.body_object(ctx, rules.ASSIGN_BODY_MAX)
    if set(d) - {'assignments', 'ifUpdatedAt'} or 'assignments' not in d:
        raise ApiError(400, 'invalid_assignments')
    guard = rules.guard_of(d, 'invalid_assignments')
    layout = ctx.repo.get_layout(k, friday)
    if not layout:
        raise ApiError(404, 'layout_not_found')
    parsed = rules.validate_assignments(d['assignments'], {s['id'] for s in layout['seats']})
    families, holders = set(), set()
    for ref in parsed.values():
        if ref:
            (families if ref[0] == 'family' else holders).add(ref[1])
    known_holders = {h['holderId'] for h in ctx.repo.list_holders(k)} if holders else set()
    if holders - known_holders or any(not _live_family(ctx, k, f) for f in families):
        raise ApiError(400, 'invalid_assignments', 'assignments.<ref>')
    current = ctx.repo.get_assignments(k, friday)
    merged = {s: r for s, r in (current['assignments'] if current else {}).items()}
    for seat, ref in parsed.items():
        if ref is None:
            merged.pop(seat, None)
        else:
            merged[seat] = f'{ref[0]}:{ref[1]}'
    updated = ctx.repo.put_assignments(k, friday, merged, guard)
    return 200, {'updatedAt': updated}


def _holder_out(item):
    return {'holderId': item['holderId'], 'name': item['name'], 'phone': item.get('phone'),
            'createdAt': item['createdAt'], 'updatedAt': item['updatedAt']}


def list_holders(ctx, params):
    authz.require(ctx.repo, ctx.user_id, params['k'], authz.MANAGEMENT)
    return 200, [_holder_out(h) for h in sorted(ctx.repo.list_holders(params['k']),
                                                key=lambda h: (h['createdAt'], h['holderId']))]


def create_holder(ctx, params):
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    name, phone = rules.validate_holder(inputs.body_object(ctx, rules.HOLDER_BODY_MAX))
    if len(ctx.repo.list_holders(k)) >= rules.MAX_HOLDERS:
        raise ApiError(409, 'too_many_holders')
    return 201, _holder_out(ctx.repo.put_holder(k, new_id(), name, phone))


def _holder(ctx, params):
    holder_id = params['holderId']
    item = ctx.repo.get_holder(params['k'], holder_id) if ID_RE.fullmatch(holder_id) else None
    if not item:
        raise ApiError(404, 'holder_not_found')
    return item


def update_holder(ctx, params):
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    item = _holder(ctx, params)
    name, phone = rules.validate_holder(inputs.body_object(ctx, rules.HOLDER_BODY_MAX))
    return 200, _holder_out(ctx.repo.put_holder(k, item['holderId'], name, phone, item['createdAt'], item['updatedAt']))


def holder_seats(ctx, params):
    """Seats the holder holds per layout version (only versions where it holds any, oldest first; `past` = before the
    current Shabbat). The delete confirm shows these: a delete frees them in every version."""
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    item = _holder(ctx, params)
    ref = f'holder:{item["holderId"]}'
    current = rules.current_shabbat(_today()).isoformat()
    assigned = ctx.repo.list_assignments(k)
    versions = []
    for layout in sorted(ctx.repo.list_layouts(k), key=lambda i: i['effectiveFrom']):
        frm = layout['effectiveFrom']
        ids = {s['id'] for s in layout['seats']}
        n = sum(1 for s, r in assigned.get(frm, {}).get('assignments', {}).items() if r == ref and s in ids)
        if n:
            versions.append({'effectiveFrom': frm, 'seats': n, 'past': frm < current})
    return 200, {'total': sum(v['seats'] for v in versions), 'versions': versions}


def delete_holder(ctx, params):
    k = params['k']
    authz.require(ctx.repo, ctx.user_id, k, authz.MANAGEMENT)
    item = _holder(ctx, params)
    ctx.repo.delete_holder(k, item['holderId'])
    return 204, None
