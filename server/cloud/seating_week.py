"""Seating, weekly state: the deadline, a family's order, the member's cut (his block, his rows +-2, nothing else)
and the released-count rule. Mirrors src/seats/frame.ts; the server is the authority."""
import re
from datetime import date, datetime, time as dtime
from zoneinfo import ZoneInfo

from .errors import ApiError

TZ = ZoneInfo('Asia/Jerusalem')
PRAYERS = ('erev', 'day')
REACH = 2
SPLIT_GAP = 4
DEFAULT_DEADLINE = '12:00'
_HHMM = re.compile(r'([01]\d|2[0-3]):[0-5]\d')
AREA_MAX = 24
MAX_AREAS = 12
MAX_ROWS = 1200


def valid_deadline(value):
    if not isinstance(value, str) or not _HHMM.fullmatch(value):
        raise ApiError(400, 'invalid_seat_deadline')
    return value


def deadline_of(friday, hhmm):
    """The moment members stop changing a week: that Friday at hh:mm Jerusalem time."""
    hhmm = hhmm if isinstance(hhmm, str) and _HHMM.fullmatch(hhmm) else DEFAULT_DEADLINE
    return datetime.combine(date.fromisoformat(friday), dtime(int(hhmm[:2]), int(hhmm[3:])), TZ)


def block_index(layout, col):
    for i, b in enumerate(layout['blocks']):
        if b['colStart'] <= col <= b['colEnd']:
            return i
    return -1


def family_order(layout, seat_ids):
    """Seat ids in the family's order: blocks right to left, rows front to back, columns right to left."""
    pos = {s['id']: s for s in layout['seats']}
    mine = [pos[i] for i in seat_ids if i in pos]
    mine.sort(key=lambda s: (-block_index(layout, s['col']), s['row'], -s['col']))
    return [s['id'] for s in mine]


def to_release(ordered, count):
    """A released count frees seats from the highest order down."""
    count = max(0, min(count, len(ordered)))
    return set(ordered[len(ordered) - count:]) if count else set()


def is_released(item, seat_id):
    return bool(((item or {}).get('seats') or {}).get(seat_id, {}).get('r'))


def _label(layout, row):
    return layout['rowLabels'][row]


def frames(layout, ordered, states):
    """The member's frames. `states` maps prayer -> week item (or None). Others are plain `other` cells: no id, no
    name, no state. Seats of one block within SPLIT_GAP rows share a frame, else one frame per group."""
    pos = {s['id']: s for s in layout['seats']}
    order = {sid: i + 1 for i, sid in enumerate(ordered)}
    out = []
    for bi in sorted(range(len(layout['blocks'])), reverse=True):
        block = layout['blocks'][bi]
        seats = sorted((pos[i] for i in ordered if block['colStart'] <= pos[i]['col'] <= block['colEnd']),
                       key=lambda s: s['row'])
        if not seats:
            continue
        used = [r for r, row in enumerate(layout['cells'])
                if any(k in ('seat', 'bimah') for k in row[block['colStart']:block['colEnd'] + 1])]
        lo_all, hi_all = min(used), max(used)
        groups = []
        for s in seats:
            if groups and s['row'] - groups[-1][-1]['row'] <= SPLIT_GAP:
                groups[-1].append(s)
            else:
                groups.append([s])
        for g in groups:
            lo, hi = max(lo_all, g[0]['row'] - REACH), min(hi_all, g[-1]['row'] + REACH)
            mine = {(s['row'], s['col']): s['id'] for s in g}
            rows = []
            for r in range(lo, hi + 1):
                cells = []
                for c in range(block['colStart'], block['colEnd'] + 1):
                    kind = layout['cells'][r][c]
                    sid = mine.get((r, c))
                    if sid:
                        cells.append({'kind': 'mine', 'k': order[sid], 'n': len(ordered),
                                      'state': {p: 'released' if is_released(states.get(p), sid) else 'kept'
                                                for p in PRAYERS}})
                    elif kind == 'bimah':
                        cells.append({'kind': 'bimah'})
                    elif kind == 'seat':
                        cells.append({'kind': 'other'})
                    else:
                        cells.append({'kind': 'gap'})
                rows.append({'label': _label(layout, r), 'mine': any(c['kind'] == 'mine' for c in cells),
                             'bimah': any(c['kind'] == 'bimah' for c in cells), 'cells': cells})
            out.append({'blockName': block['name'], 'cols': block['colEnd'] - block['colStart'] + 1,
                        'rowFrom': _label(layout, lo), 'rowTo': _label(layout, hi), 'rows': rows})
    return out


def parse_released(value, ordered):
    """Orders (ints 1..n) or the family's own seat ids -> a set of seat ids; anything else 400."""
    if not isinstance(value, list) or len(value) > len(ordered):
        raise ApiError(400, 'invalid_released')
    out = set()
    for v in value:
        if isinstance(v, bool):
            raise ApiError(400, 'invalid_released')
        if isinstance(v, int) and 1 <= v <= len(ordered):
            out.add(ordered[v - 1])
        elif isinstance(v, str) and v in ordered:
            out.add(v)
        else:
            raise ApiError(400, 'invalid_released')
    return out


def validate_requests(value):
    if not isinstance(value, dict) or len(value) > MAX_AREAS:
        raise ApiError(400, 'invalid_responses', 'requests')
    out = {}
    for area, n in value.items():
        if not isinstance(area, str) or not area.strip() or len(area) > AREA_MAX or isinstance(n, bool) \
                or not isinstance(n, int) or not 0 <= n <= 99:
            raise ApiError(400, 'invalid_responses', 'requests')
        out[area.strip()] = n
    return out
