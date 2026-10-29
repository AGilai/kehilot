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
DEFAULT_DEADLINE = '14:00'
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


def lanes(layout, block):
    """The sides of a block that are a lane: the column just outside is inside the hall and in no block.
    Subset of ['left', 'right'], in that order. The hall's outer edges are walls."""
    out = []
    for side, col in (('left', block['colStart'] - 1), ('right', block['colEnd'] + 1)):
        if 0 <= col < len(layout['cells'][0]) and block_index(layout, col) == -1:
            out.append(side)
    return out


def _bimah_centre(layout):
    cols = [c for row in layout['cells'] for c, k in enumerate(row) if k == 'bimah']
    return sum(cols) / len(cols) if cols else None


def _front_row(layout):
    """The row of the Aron (ark cells; row 0, the front row, when the layout has none)."""
    return next((r for r, row in enumerate(layout['cells']) if 'ark' in row), 0)


def _aisle_sides(layout, block):
    """The sides of a block that count as an aisle for the free order: a lane, or the hall's side wall (owner: "wall is
    an aisle"). So every block has at least its outer side."""
    out = []
    for side, col in (('left', block['colStart'] - 1), ('right', block['colEnd'] + 1)):
        if not 0 <= col < len(layout['cells'][0]) or block_index(layout, col) == -1:
            out.append(side)
    return out


def _aisle_gap(layout, block, seat):
    """Seats (anyone's) between this seat and the nearer aisle of its block, in its row; None without an aisle."""
    row, col = layout['cells'][seat['row']], seat['col']
    gaps = []
    for side in _aisle_sides(layout, block):
        span = range(block['colStart'], col) if side == 'left' else range(col + 1, block['colEnd'] + 1)
        gaps.append(sum(1 for c in span if row[c] == 'seat'))
    return min(gaps) if gaps else None


def keep_key(layout, seat, centre=None, front=None):
    """How good a seat is, best first, a total order (§15.10.11, owner 2026-10-29): the row nearer the Aron; next to an
    aisle; fewer seats to an aisle; nearer the bimah (column distance); the right seat facing the Aron."""
    centre = _bimah_centre(layout) if centre is None else centre
    front = _front_row(layout) if front is None else front
    bi = block_index(layout, seat['col'])
    gap = _aisle_gap(layout, layout['blocks'][bi], seat) if bi >= 0 else None
    return (abs(seat['row'] - front), seat['row'], 0 if gap == 0 else 1, gap if gap is not None else 1 << 30,
            abs(seat['col'] - centre) if centre is not None else 0, -seat['col'])


def _is_aisle_seat(key):
    return key[2] == 0


def _head(keys):
    """The head's seat: the best aisle seat by rank when the family has one, else the best seat."""
    aisle = [sid for sid, k in keys.items() if _is_aisle_seat(k)]
    return min(aisle or keys, key=keys.__getitem__)


def _touch(a, b):
    """Two seats touch when they are neighbours in a row (a gap or a bimah cell in between breaks it) or sit directly
    in front of / behind one another in neighbouring rows."""
    return (a['row'] == b['row'] and abs(a['col'] - b['col']) == 1) or (a['col'] == b['col'] and abs(a['row'] - b['row']) == 1)


def keep_chain(layout, ordered):
    """The family's seats in keep order (§15.10.11, owner 2026-10-29): the head's seat (_head), then each
    next seat is the best by keep_key among the seats that touch the chain, or the best left when none touches."""
    pos = {s['id']: s for s in layout['seats']}
    centre, front = _bimah_centre(layout), _front_row(layout)
    key = {sid: keep_key(layout, pos[sid], centre, front) for sid in ordered}
    left = sorted(ordered, key=key.__getitem__)
    chain = []
    if left:
        head = _head(key)
        chain.append(head)
        left.remove(head)
    while left:
        near = [sid for sid in left if any(_touch(pos[sid], pos[c]) for c in chain)]
        nxt = (near or left)[0]
        chain.append(nxt)
        left.remove(nxt)
    return chain


def free_order(layout, ordered):
    """Seat ids, first to free first: the keep chain backwards, so the kept seats stay one group around the head."""
    return keep_chain(layout, ordered)[::-1]


def to_release(free_ordered, count):
    """A released count frees the first `count` seats of the free order."""
    count = max(0, min(count, len(free_ordered)))
    return set(free_ordered[:count]) if count else set()


def is_released(item, seat_id):
    return bool(((item or {}).get('seats') or {}).get(seat_id, {}).get('r'))


def _label(layout, row):
    return layout['rowLabels'][row]


def frames(layout, ordered, states):
    """The member's frames. `states` maps prayer -> week item (or None). Others are plain `other` cells: no id, no
    name, no state. Seats of one block within SPLIT_GAP rows share a frame, else one frame per group."""
    pos = {s['id']: s for s in layout['seats']}
    order = {sid: i + 1 for i, sid in enumerate(ordered)}
    hall_first = min(r for r, row in enumerate(layout['cells']) if any(k in ('seat', 'bimah') for k in row))
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
                        'rowFrom': _label(layout, lo), 'rowTo': _label(layout, hi), 'rows': rows,
                        'lanes': lanes(layout, block), 'gapAbove': lo > hall_first})
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
