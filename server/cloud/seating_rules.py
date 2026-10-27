"""Seating shape: strict validation of hall layouts, holders and assignments. Seat ids are server-made and internal;
names and phones never appear in an error (the offending path only)."""
import re
import secrets
from datetime import date, timedelta

from .errors import ApiError
from .ids import ID_RE
from .phones import normalize_phone
from .schedule_rules import Checker

MAX_ROWS = 40
MAX_COLS = 60
MAX_BLOCKS = 12
BLOCK_NAME_MAX = 24
ROW_LABEL_MAX = 8
HOLDER_NAME_MAX = 60
MAX_HOLDERS = 600
KINDS = ('seat', 'aisle', 'bimah', 'ark', 'empty')
LAYOUT_BODY_MAX = 160 * 1024
ASSIGN_BODY_MAX = 160 * 1024
HOLDER_BODY_MAX = 2 * 1024
EARLIEST = date(2024, 1, 5)
HORIZON_DAYS = 380
_SEAT_ID = re.compile(r'[0-9a-f]{12}')
_REF = re.compile(r'(family|holder):([0-9A-HJKMNP-TV-Z]{26})')


def effective_from(value, today):
    """A Friday (YYYY-MM-DD) from 2024 to about a year ahead, else 400 invalid_effective_from."""
    try:
        if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ValueError
        day = date.fromisoformat(value)
    except ValueError:
        raise ApiError(400, 'invalid_effective_from')
    if day.weekday() != 4 or day < EARLIEST or day > today + timedelta(days=HORIZON_DAYS):
        raise ApiError(400, 'invalid_effective_from')
    return value


def guard_of(d, code):
    """`ifUpdatedAt` is required: an int, or null meaning "I expect nothing saved yet"."""
    if 'ifUpdatedAt' not in d:
        raise ApiError(400, code, 'ifUpdatedAt')
    guard = d['ifUpdatedAt']
    if guard is not None and (isinstance(guard, bool) or not isinstance(guard, int)):
        raise ApiError(400, code, 'ifUpdatedAt')
    return guard


def validate_layout(d):
    """-> {rows, cols, cells, blocks, rowLabels}; the body also carries ifUpdatedAt (checked by the caller)."""
    c = Checker('invalid_layout')
    c.obj(d, '', ('rows', 'cols', 'cells', 'blocks', 'rowLabels', 'ifUpdatedAt'))
    rows = c.integer(d['rows'], 1, MAX_ROWS, 'rows')
    cols = c.integer(d['cols'], 1, MAX_COLS, 'cols')
    cells = d['cells']
    if not isinstance(cells, list) or len(cells) != rows:
        c.fail('cells')
    seat_cols = set()
    seats = 0
    for r, row in enumerate(cells):
        if not isinstance(row, list) or len(row) != cols:
            c.fail('cells')
        for x, kind in enumerate(row):
            if not isinstance(kind, str) or kind not in KINDS:
                c.fail('cells')
            if kind == 'seat':
                seats += 1
                seat_cols.add(x)
    if not seats:
        c.fail('cells')
    blocks = d['blocks']
    if not isinstance(blocks, list) or not 1 <= len(blocks) <= MAX_BLOCKS:
        c.fail('blocks')
    out, last_end = [], -1
    for i, block in enumerate(blocks):
        path = f'blocks.{i}'
        c.obj(block, path, ('name', 'colStart', 'colEnd'))
        start = c.integer(block['colStart'], 0, cols - 1, path + '.colStart')
        end = c.integer(block['colEnd'], 0, cols - 1, path + '.colEnd')
        if end < start or start <= last_end:
            c.fail(path)
        last_end = end
        out.append({'name': c.string(block['name'], BLOCK_NAME_MAX, path + '.name'), 'colStart': start, 'colEnd': end})
    if any(not any(b['colStart'] <= x <= b['colEnd'] for b in out) for x in seat_cols):
        c.fail('blocks')
    labels = d['rowLabels']
    if not isinstance(labels, list) or len(labels) != rows:
        c.fail('rowLabels')
    clean = []
    for i, label in enumerate(labels):
        if label is None:
            clean.append(None)
            continue
        label = c.string(label, ROW_LABEL_MAX, f'rowLabels.{i}', required=False)
        clean.append(label or None)
    return {'rows': rows, 'cols': cols, 'cells': cells, 'blocks': out, 'rowLabels': clean}


def assign_seats(cells, *previous):
    """Seat list [{id,row,col}] in reading order. A seat keeps the id it had at the same position in the first
    `previous` seat list that has one (the same version's old seats, then the latest earlier version's)."""
    known = {}
    for seats in reversed(previous):
        for s in seats:
            known[(s['row'], s['col'])] = s['id']
    used, out = set(), []
    for r, row in enumerate(cells):
        for x, kind in enumerate(row):
            if kind != 'seat':
                continue
            sid = known.get((r, x))
            if sid is None or sid in used:
                sid = secrets.token_hex(6)
                while sid in used:
                    sid = secrets.token_hex(6)
            used.add(sid)
            out.append({'id': sid, 'row': r, 'col': x})
    return out


def validate_holder(d):
    c = Checker('invalid_holder')
    for key in d:
        if key not in ('name', 'phone'):
            raise ApiError(400, 'invalid_holder', '<unknown>')
    name = d.get('name')
    try:
        name = c.string(name, HOLDER_NAME_MAX, 'name')
    except ApiError:
        raise ApiError(400, 'invalid_name')
    phone = d.get('phone')
    if phone is not None and phone != '':
        phone = normalize_phone(phone)
        if not phone:
            raise ApiError(400, 'invalid_phone')
    else:
        phone = None
    return name, phone


def validate_assignments(value, seat_ids):
    """{seatId: 'family:<id>'|'holder:<id>'|None} -> same, with refs split to (kind, id) for the caller to check."""
    c = Checker('invalid_assignments')
    if not isinstance(value, dict) or len(value) > MAX_ROWS * MAX_COLS:
        c.fail('assignments')
    out = {}
    for seat, ref in value.items():
        if not isinstance(seat, str) or seat not in seat_ids:
            c.fail('assignments.<seat>')
        if ref is None:
            out[seat] = None
            continue
        found = _REF.fullmatch(ref) if isinstance(ref, str) else None
        if not found:
            c.fail('assignments.<ref>')
        out[seat] = (found.group(1), found.group(2))
    return out
