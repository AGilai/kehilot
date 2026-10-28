"""Family tree rules (UX-DESIGN 17.5): strict validation of the `people` list, and the conversions between the
older `children` list and `people`. Pure: no repo access. Errors carry codes only, never names."""
import re
from datetime import date
from decimal import Decimal

from pyluach import dates, hebrewcal

from ..hebrew_calendar import MONTH_NUMBERS
from .errors import ApiError

RELATIONS = ('self', 'spouse', 'father', 'mother', 'child', 'childSpouse', 'grandchild')
PERSON_KEYS = {'id', 'relation', 'of', 'gender', 'hebrewFirst', 'surname', 'fatherName', 'motherName', 'tribe',
               'birth', 'deceased', 'death', 'barMitzvah', 'figure'}
NAME_KEYS = ('hebrewFirst', 'surname', 'fatherName', 'motherName')
MAX_NAME = 40
MAX_CHILDREN = 20
MAX_GRANDCHILDREN = 20
MAX_GENERATIONS = 6
YEAR_RANGE = (5000, 6000)
ID_PATTERN = re.compile(r'^[0-9A-Za-z_-]{1,40}$')  # server ULIDs and client-made ids
COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
MAX_DAYS = dict(nisan=30, iyar=29, sivan=30, tamuz=29, av=30, elul=29, tishrei=30, cheshvan=30, kislev=30,
                tevet=29, shevat=30, adar=29, adar_i=30, adar_ii=29)
FIGURE_ENUMS = {'headCovering': ('tichel', 'hat', 'wig', 'none'), 'kippah': ('knitted', 'small', 'velvet', 'none'),
                'beard': ('none', 'short', 'full')}
FIGURE_COLORS = ('coverColor', 'hair')
CHILD_SIDE = ('child', 'childSpouse', 'grandchild')


def _bad(code):
    raise ApiError(400, code)


def _name(value):
    if not isinstance(value, str):
        _bad('invalid_name')
    value = value.strip()
    if len(value) > MAX_NAME:
        _bad('invalid_name')
    return value


def month_key(number, year):
    leap = hebrewcal.Year(year).leap
    if number == 12:
        return 'adar_i' if leap else 'adar'
    if number == 13:
        return 'adar_ii'
    return next(k for k, v in MONTH_NUMBERS.items() if v == number and not k.startswith('adar'))


def _hebrew_date(value, code):
    """(cleaned HebDate, python date or None when there is no year)."""
    if not isinstance(value, dict) or not {'day', 'month'} <= set(value) <= {'day', 'month', 'year'}:
        _bad(code)
    day, month = value['day'], value['month']
    if isinstance(day, bool) or not isinstance(day, int) or not isinstance(month, str) or month not in MONTH_NUMBERS:
        _bad(code)
    if not 1 <= day <= MAX_DAYS[month]:
        _bad(code)
    clean = {'day': day, 'month': month}
    if 'year' not in value:
        return clean, None
    year = value['year']
    if isinstance(year, bool) or not isinstance(year, int) or not YEAR_RANGE[0] <= year <= YEAR_RANGE[1]:
        _bad(code)
    leap = hebrewcal.Year(year).leap
    if (leap and month == 'adar') or (not leap and month in ('adar_i', 'adar_ii')):
        _bad('invalid_adar')  # never silently mapped to the other Adar
    try:
        py = dates.HebrewDate(year, MONTH_NUMBERS[month], day).to_pydate()
    except ValueError:
        _bad('invalid_hebrew_date')
    clean['year'] = year
    return clean, py


def _figure(value):
    if not isinstance(value, dict) or not set(value) <= set(FIGURE_ENUMS) | set(FIGURE_COLORS) | {'glasses', 'skin'}:
        _bad('invalid_figure')
    for key, options in FIGURE_ENUMS.items():
        if key in value and (not isinstance(value[key], str) or value[key] not in options):
            _bad('invalid_figure')
    for key in FIGURE_COLORS:
        if key in value and (not isinstance(value[key], str) or not COLOR_RE.fullmatch(value[key])):
            _bad('invalid_figure')
    if 'glasses' in value and not isinstance(value['glasses'], bool):
        _bad('invalid_figure')
    if 'skin' in value and (isinstance(value['skin'], bool) or value['skin'] not in (0, 1, 2)):
        _bad('invalid_figure')
    return dict(value)


def _bar_mitzvah(value, gender):
    if gender != 'm' or not isinstance(value, dict) or set(value) != {'date', 'parasha', 'manual'}:
        _bad('invalid_bar_mitzvah')
    when, parasha, manual = value['date'], value['parasha'], value['manual']
    if not isinstance(when, str) or not DATE_RE.fullmatch(when) or not isinstance(manual, bool) \
            or not isinstance(parasha, str) or not parasha.strip() or len(parasha) > MAX_NAME:
        _bad('invalid_bar_mitzvah')
    try:
        date.fromisoformat(when)
    except ValueError:
        _bad('invalid_bar_mitzvah')
    return {'date': when, 'parasha': parasha, 'manual': manual}


def _clean_person(raw, today):
    if not isinstance(raw, dict) or not set(raw) <= PERSON_KEYS:
        _bad('invalid_people')
    pid = raw.get('id')
    if not isinstance(pid, str) or not ID_PATTERN.fullmatch(pid):
        _bad('invalid_people')
    if raw.get('relation') not in RELATIONS:
        _bad('invalid_relation')
    if raw.get('gender') not in ('m', 'f'):
        _bad('invalid_gender')
    person = {'id': pid, 'relation': raw['relation'], 'gender': raw['gender']}
    if 'of' in raw:
        if not isinstance(raw['of'], str):
            _bad('invalid_relation')
        person['of'] = raw['of']
    for key in NAME_KEYS:
        if key in raw:
            text = _name(raw[key])
            if text:
                person[key] = text
    if 'tribe' in raw:
        if raw['tribe'] not in ('kohen', 'levi', 'yisrael') or raw['gender'] != 'm':
            _bad('invalid_tribe')
        person['tribe'] = raw['tribe']
    if 'deceased' in raw:
        if not isinstance(raw['deceased'], bool):
            _bad('invalid_people')
        person['deceased'] = raw['deceased']
    born = None
    if 'birth' in raw:
        person['birth'], born = _hebrew_date(raw['birth'], 'invalid_hebrew_date')
        if born and born > today:
            _bad('invalid_birth')
    if 'death' in raw:
        if not raw.get('deceased'):
            _bad('invalid_death')
        person['death'], died = _hebrew_date(raw['death'], 'invalid_hebrew_date')
        if died and (died > today or (born and died < born)):
            _bad('invalid_death')
    if 'barMitzvah' in raw:
        person['barMitzvah'] = _bar_mitzvah(raw['barMitzvah'], raw['gender'])
    if 'figure' in raw:
        person['figure'] = _figure(raw['figure'])
    return person


def _depth(person, by_id):
    """Generations above the first non-parent person: a parent of self is 1, a grandparent 2."""
    depth, seen = 0, set()
    while person['relation'] in ('father', 'mother'):
        if person['id'] in seen:
            _bad('invalid_relation')  # a cycle of parents
        seen.add(person['id'])
        depth += 1
        person = by_id[person['of']]
    return depth


def validate_people(people, today):
    """The cleaned `people` list; raises ApiError(400, code). `today` is a date (Israel)."""
    if not isinstance(people, list):
        _bad('invalid_people')
    cleaned = [_clean_person(p, today) for p in people]
    by_id = {p['id']: p for p in cleaned}
    if len(by_id) != len(cleaned):
        _bad('invalid_people')
    if not cleaned:
        return cleaned
    selves = [p for p in cleaned if p['relation'] == 'self']
    if len(selves) != 1:
        _bad('invalid_people')
    self_id = selves[0]['id']
    seen_slots = set()
    counts = {'child': 0}
    grandchildren = {}
    for p in cleaned:
        relation, of = p['relation'], p.get('of')
        target = by_id.get(of)
        if relation == 'self':
            if of is not None:
                _bad('invalid_relation')
        elif relation in ('spouse', 'child'):
            if (of is None and relation == 'spouse') or (of is not None and of != self_id):
                _bad('invalid_relation')
            slot = ('spouse',) if relation == 'spouse' else None
            if slot:
                if slot in seen_slots:
                    _bad('invalid_relation')
                seen_slots.add(slot)
            else:
                counts['child'] += 1
        elif relation in ('father', 'mother'):
            if target is None or p['gender'] != ('m' if relation == 'father' else 'f'):
                _bad('invalid_relation')
            slot = (relation, of)
            if slot in seen_slots:
                _bad('invalid_relation')
            seen_slots.add(slot)
        else:  # childSpouse, grandchild: of = a child
            if target is None or target['relation'] != 'child':
                _bad('invalid_relation')
            if relation == 'childSpouse':
                if ('childSpouse', of) in seen_slots:
                    _bad('invalid_relation')
                seen_slots.add(('childSpouse', of))
            else:
                grandchildren[of] = grandchildren.get(of, 0) + 1
    for p in cleaned:
        if p['relation'] in ('father', 'mother'):
            if _depth(p, by_id) > MAX_GENERATIONS:
                _bad('generations_limit')
    if counts['child'] > MAX_CHILDREN:
        _bad('children_limit')
    if any(n > MAX_GRANDCHILDREN for n in grandchildren.values()):
        _bad('grandchildren_limit')
    return cleaned


# older `children` list <-> people ----------------------------------------------------------------------------

def hebrew_from_iso(value):
    """HebDate dict for a yyyy-mm-dd Gregorian date."""
    year, month, day = (int(x) for x in value.split('-'))
    h = dates.GregorianDate(year, month, day).to_heb()
    return {'day': h.day, 'month': month_key(h.month, h.year), 'year': h.year}


def iso_from_hebrew(birth):
    """yyyy-mm-dd for a HebDate with a year, else None."""
    if not birth or 'year' not in birth:
        return None
    try:
        return dates.HebrewDate(birth['year'], MONTH_NUMBERS[birth['month']], birth['day']).to_pydate().isoformat()
    except (ValueError, KeyError):
        return None


def people_from_children(children):
    out = []
    for c in children:
        p = {'id': c['id'], 'relation': 'child', 'gender': c['gender'], 'hebrewFirst': c['firstName']}
        if c.get('birthDate'):
            p['birth'] = hebrew_from_iso(c['birthDate'])
        out.append(p)
    return out


def children_view(people):
    """The old `children` shape ({id, firstName, gender, birthDate?}) of the `child` entries."""
    out = []
    for p in people:
        if p['relation'] != 'child':
            continue
        child = {'id': p['id'], 'firstName': p.get('hebrewFirst', ''), 'gender': p['gender']}
        iso = iso_from_hebrew(p.get('birth'))
        if iso:
            child['birthDate'] = iso
        out.append(child)
    return out


def _plain(value):
    """DynamoDB returns numbers as Decimal: back to int."""
    if isinstance(value, Decimal):
        return int(value)
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def people_of(family):
    """The family's people: `people` when it exists, else derived from the older `children` list."""
    if family.get('people') is not None:
        return _plain(list(family['people']))
    return people_from_children(family.get('children') or [])


def children_of(family):
    return children_view(_plain(family['people'])) if family.get('people') is not None else list(family.get('children') or [])


def _descendants(people, root_ids):
    keep = set(root_ids)
    grew = True
    while grew:
        grew = False
        for p in people:
            if p['id'] not in keep and p.get('of') in keep:
                keep.add(p['id'])
                grew = True
    return keep


def apply_children(people, children):
    """People after the older children routes changed the children list: matching ids keep their other fields,
    new ids are appended, removed ids take their spouse and grandchildren with them."""
    old = {p['id']: p for p in people if p['relation'] == 'child'}
    wanted = {c['id'] for c in children}
    gone = _descendants(people, set(old) - wanted)
    out = [p for p in people if p['id'] not in gone]
    index = {p['id']: i for i, p in enumerate(out)}
    for c in children:
        entry = old.get(c['id'])
        if entry is None:
            out.append(people_from_children([c])[0])
            continue
        entry = dict(entry, hebrewFirst=c['firstName'], gender=c['gender'])
        if c.get('birthDate'):
            if c['birthDate'] != iso_from_hebrew(entry.get('birth')):
                entry['birth'] = hebrew_from_iso(c['birthDate'])
        elif iso_from_hebrew(entry.get('birth')):
            del entry['birth']  # an old client cleared a date it could see; a yearless Hebrew date is kept
        out[index[c['id']]] = entry
    return out


def child_side(people):
    """Children, their spouses and grandchildren: what a split family copies."""
    return [p for p in people if p['relation'] in CHILD_SIDE]


_NIQQUD = re.compile('[\u0591-\u05C7]')
_FINALS = str.maketrans('ךםןףץ', 'כמנפצ')
_PUNCT = re.compile(r'[\s\u05F3\u05F4\'"`\u2019\u201C\u201D\-_.,]')


def normalize_name(name):
    """Hebrew first name for matching: no niqqud, geresh, quotes, spaces; final letters made regular."""
    return _PUNCT.sub('', _NIQQUD.sub('', name or '')).translate(_FINALS).casefold()


def _births_agree(a, b):
    if not a or not b:
        return True
    if (a['day'], a['month']) != (b['day'], b['month']):
        return False
    return 'year' not in a or 'year' not in b or a['year'] == b['year']


def _same_person(a, b):
    name = normalize_name(a.get('hebrewFirst'))
    return bool(name) and name == normalize_name(b.get('hebrewFirst')) and a['gender'] == b['gender'] \
        and _births_agree(a.get('birth'), b.get('birth'))


def _merge_field(key, a, b):
    if a == b:
        return a
    if key in ('birth', 'death'):
        return b if 'year' not in a and 'year' in b else a
    if key == 'barMitzvah':
        return b if not a.get('manual') and b.get('manual') else a
    if key == 'figure':
        return {**b, **a}
    if key == 'deceased':
        return a or b
    return a


def _merge_entry(a, b):
    out = dict(a)
    for key, value in b.items():
        out[key] = _merge_field(key, a[key], value) if key in a else value
    return out


def _dedupe(first, second):
    """(merged list, {second id: merged id}): pairs that are the same person become one (the first one's id and
    priority); everything unmatched is kept."""
    out, mapping, used = list(first), {}, set()
    for b in second:
        for i, a in enumerate(first):
            if i not in used and _same_person(a, b):
                used.add(i)
                out[i] = _merge_entry(a, b)
                mapping[b['id']] = a['id']
                break
        else:
            out.append(b)
    return out, mapping


def _ancestors(people, root):
    """Parent figures reachable from `root` through father/mother links (root excluded)."""
    found, queue = [], [root]
    while queue:
        top = queue.pop()
        for p in people:
            if p['relation'] in ('father', 'mother') and p.get('of') == top and p not in found:
                found.append(p)
                queue.append(p['id'])
    return found


def self_id_of(people):
    return next((p['id'] for p in people if p['relation'] == 'self'), None)


def merge_people(keep, moved, keep_self_id, moved_self_id):
    """People of a family after `moved` (the other user's) joins `keep`. The kept self stays `self`; the moved
    self becomes the spouse with their parents; the moved user's own spouse figure (the kept user) is dropped.
    Children, their spouses and grandchildren are matched by normalized Hebrew first name, gender and
    non-contradicting birth, and merged; the rest is kept. No limit is enforced here: a merge over a limit is
    kept whole (the next tree save asks the family to trim)."""
    keep, moved = [dict(p) for p in keep], [dict(p) for p in moved]
    if keep_self_id is None and moved_self_id is not None:  # the kept side has only children: use the moved tree
        keep, moved, keep_self_id, moved_self_id = moved, keep, moved_self_id, None
    base = [p for p in keep if p['relation'] not in CHILD_SIDE]
    if moved_self_id is not None and keep_self_id is not None:
        me = next(p for p in moved if p['id'] == moved_self_id)
        spouse = next((p for p in base if p['relation'] == 'spouse'), None)
        parents = _ancestors(moved, moved_self_id)
        if spouse is None:
            base.append(dict(me, relation='spouse', of=keep_self_id))
            base += parents
        else:
            spouse.update(_merge_entry(spouse, {k: v for k, v in me.items() if k not in ('id', 'relation', 'of')}))
            taken = {p['relation'] for p in base if p['relation'] in ('father', 'mother') and p.get('of') == spouse['id']}
            dropped = set()
            for p in parents:  # parents come before their own parents
                if p['of'] in dropped or (p['of'] == moved_self_id and p['relation'] in taken):
                    dropped.add(p['id'])  # ancestors are never merged
                else:
                    base.append(dict(p, of=spouse['id'] if p['of'] == moved_self_id else p['of']))
    kids_a = [p for p in keep if p['relation'] == 'child']
    kids_b = [p for p in moved if p['relation'] == 'child']
    kids, mapping = _dedupe(kids_a, kids_b)
    out = list(base) + kids
    for kind in ('childSpouse', 'grandchild'):
        for kid in kids:
            theirs = [dict(p, of=kid['id']) for p in moved if p['relation'] == kind and mapping.get(p['of'], p['of']) == kid['id']]
            mine = [p for p in keep if p['relation'] == kind and p.get('of') == kid['id']]
            out += _dedupe(mine, theirs)[0]
    return out
