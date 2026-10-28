"""Family tree rules (UX-DESIGN 17.5): strict validation of the `people` list, and the conversions between the
older `children` list and `people`. Pure: no repo access. Errors carry codes only, never names."""
import re
from datetime import date
from decimal import Decimal

from pyluach import dates, hebrewcal

from ..hebrew_calendar import MONTH_NUMBERS
from .errors import ApiError
from .ids import new_id

RELATIONS = ('self', 'spouse', 'formerSpouse', 'father', 'mother', 'child', 'childSpouse', 'grandchild')
PERSON_KEYS = {'userId', 'id', 'relation', 'of', 'gender', 'hebrewFirst', 'surname', 'fatherName', 'motherName', 'tribe',
               'birth', 'deceased', 'death', 'barMitzvah', 'figure'}
NAME_KEYS = ('hebrewFirst', 'surname', 'fatherName', 'motherName')
MAX_NAME = 40
MAX_TREE_BYTES = 300 * 1024
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
PARENT_OF = ('self', 'spouse', 'father', 'mother')  # whose parents the tree may hold


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
    if gender != 'm' or not isinstance(value, dict) or not {'date', 'parasha', 'manual'} <= set(value) <= {'date', 'parasha', 'manual', 'label'}:
        _bad('invalid_bar_mitzvah')
    when, parasha, manual = value['date'], value['parasha'], value['manual']
    # parasha is '' on a holiday Shabbat; `label` then names the Shabbat
    if not isinstance(when, str) or not DATE_RE.fullmatch(when) or not isinstance(manual, bool) \
            or not isinstance(parasha, str) or len(parasha) > MAX_NAME:
        _bad('invalid_bar_mitzvah')
    try:
        date.fromisoformat(when)
    except ValueError:
        _bad('invalid_bar_mitzvah')
    clean = {'date': when, 'parasha': parasha, 'manual': manual}
    if 'label' in value:
        if not isinstance(value['label'], str) or len(value['label']) > MAX_NAME:
            _bad('invalid_bar_mitzvah')
        clean['label'] = value['label']
    return clean


def _clean_person(raw, today):
    if not isinstance(raw, dict) or not set(raw) <= PERSON_KEYS:
        _bad('invalid_people')
    raw = {k: v for k, v in raw.items() if k != 'userId'}
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
        elif relation in ('spouse', 'formerSpouse', 'child'):
            if (of is None and relation != 'child') or (of is not None and of != self_id):
                _bad('invalid_relation')
            slot = (relation,) if relation != 'child' else None
            if slot:
                if slot in seen_slots:
                    _bad('invalid_relation')
                seen_slots.add(slot)
            else:
                counts['child'] += 1
        elif relation in ('father', 'mother'):
            if target is None or target['relation'] not in PARENT_OF \
                    or p['gender'] != ('m' if relation == 'father' else 'f'):
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
    """Fields of `a` win; empty ones are filled from `b`; the more complete date or manual choice wins."""
    out = dict(a)
    for key, value in b.items():
        out[key] = _merge_field(key, a[key], value) if key in a else value
    born, died = iso_from_hebrew(out.get('birth')), iso_from_hebrew(out.get('death'))
    if born and died and died < born:  # dates from two sources contradict each other: `a`'s stand
        for key in ('birth', 'death'):
            if key in a:
                out[key] = a[key]
            else:
                out.pop(key, None)
    if out.get('gender') == 'f':
        out.pop('tribe', None)
        out.pop('barMitzvah', None)
    if 'death' in out:
        out['deceased'] = True
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
    """Parent figures reachable from `root` through father/mother links (root excluded), parents first."""
    found, queue = [], [root]
    while queue:
        top = queue.pop(0)
        for p in people:
            if p['relation'] in ('father', 'mother') and p.get('of') == top and p not in found:
                found.append(p)
                queue.append(p['id'])
    return found


def self_id_of(people):
    return next((p['id'] for p in people if p['relation'] == 'self'), None)


def _replace(people, old, new):
    for i, p in enumerate(people):
        if p['id'] == old['id']:
            people[i] = new
            return


def _names_compatible(a, b):
    x, y = normalize_name(a.get('hebrewFirst')), normalize_name(b.get('hebrewFirst'))
    return not x or not y or x == y


def _names_only(entry, people, relation, of):
    """A figure reduced to names: first name, surname, tribe, deceased and the parents' first names as text."""
    out = {'id': entry['id'], 'relation': relation, 'of': of, 'gender': entry['gender']}
    for key in ('hebrewFirst', 'surname', 'tribe', 'deceased', 'fatherName', 'motherName'):
        if key in entry:
            out[key] = entry[key]
    for parent, key in (('father', 'fatherName'), ('mother', 'motherName')):
        found = next((p for p in people if p['relation'] == parent and p.get('of') == entry['id']), None)
        if found and found.get('hebrewFirst'):
            out[key] = found['hebrewFirst']
    return out


def _merge_ancestors(base, target_id, other, other_id, other_wins):
    """Merge the parent figures of `other_id` into those of `target_id` slot by slot (father, mother), recursively."""
    for relation in ('father', 'mother'):
        mine = next((p for p in base if p['relation'] == relation and p.get('of') == target_id), None)
        theirs = next((p for p in other if p['relation'] == relation and p.get('of') == other_id), None)
        if theirs is None:
            continue
        if mine is None:
            base.append(dict(theirs, of=target_id))
            base.extend(_ancestors(other, theirs['id']))
            continue
        merged = _merge_entry(theirs, mine) if other_wins else _merge_entry(mine, theirs)
        merged.update(id=mine['id'], of=target_id, relation=relation)
        _replace(base, mine, merged)
        _merge_ancestors(base, mine['id'], other, theirs['id'], other_wins)


def _reid(people, taken):
    """`people` with every id in `taken` replaced by a new one (and the `of` links rewritten)."""
    mapping = {p['id']: new_id() for p in people if p['id'] in taken}
    return [dict(p, id=mapping.get(p['id'], p['id']), **({'of': mapping.get(p['of'], p['of'])} if 'of' in p else {}))
            for p in people]


def _add_former(base, entry, people, self_entry):
    """Carry `entry` as the names-only `formerSpouse` of the self when that slot is free (never folded into
    another person); returns whether it was carried."""
    if any(p['relation'] == 'formerSpouse' for p in base):
        return False
    base.append(_names_only(entry, people, 'formerSpouse', self_entry['id']))
    return True


def _to_former(base, spouse, self_entry):
    """The spouse figure leaves the spouse slot (its parent figures go): it becomes the former spouse when that
    slot is free, else it is dropped."""
    people = list(base)
    gone = {p['id'] for p in _ancestors(base, spouse['id'])} | {spouse['id']}
    base[:] = [p for p in base if p['id'] not in gone]
    _add_former(base, spouse, people, self_entry)


def _matches_kept_self(ks, figure):
    """Whether the moved tree's spouse figure can be the kept user: same gender, compatible name, not deceased."""
    return figure['gender'] == ks['gender'] and not figure.get('deceased') and _names_compatible(figure, ks)


def _merge_children(keep, moved):
    kids, mapping = _dedupe([p for p in keep if p['relation'] == 'child'], [p for p in moved if p['relation'] == 'child'])
    out = list(kids)
    for kind in ('childSpouse', 'grandchild'):
        for kid in kids:
            mine = [p for p in keep if p['relation'] == kind and p.get('of') == kid['id']]
            theirs = [dict(p, of=kid['id']) for p in moved if p['relation'] == kind
                      and mapping.get(p['of'], p['of']) == kid['id']]
            merged = _dedupe(mine, theirs)[0]
            if kind == 'childSpouse' and len(merged) > 1:  # one spouse per child: fold the duplicates
                first = merged[0]
                for other in merged[1:]:
                    first = _merge_entry(first, {k: v for k, v in other.items() if k not in ('id', 'of', 'relation')})
                merged = [first]
            out += merged
    return out


def merge_people(keep, moved, keep_user=None, moved_user=None):
    """People of a family after the `moved` user's family joins `keep`. Ids of `moved` that collide are replaced.
    The kept `self` stays; the moved self becomes the spouse (its values win for its own figure and parents),
    merged into an existing spouse figure unless that one contradicts it (other name or gender, or deceased),
    in which case the old figure becomes the names-only `formerSpouse` when that slot is free, else is dropped (two
    former spouses are never folded). The moved tree's figure of the kept user merges into the kept self (kept values
    win), parents slot by slot, only when it matches (same gender, compatible name, not deceased); otherwise it is
    carried as `formerSpouse` if the slot is free, else dropped. The moved tree's own former spouse is carried the
    same way. Children, their spouses and grandchildren
    are matched by normalized first name, gender and non-contradicting birth and merged; the rest is kept.
    Limits are not enforced here (the next save asks the family to trim). `userId`s of the two adults are set."""
    keep = [dict(p) for p in keep]
    moved = _reid([dict(p) for p in moved], {p['id'] for p in keep})
    ks = next((p for p in keep if p['relation'] == 'self'), None)
    ms = next((p for p in moved if p['relation'] == 'self'), None)
    if ks is None and ms is not None:  # the kept side holds only children: the moved tree is the base
        keep, moved, ks, ms, keep_user, moved_user = moved, keep, ms, None, moved_user, None
    base = [p for p in keep if p['relation'] not in CHILD_SIDE]
    if ks is not None:
        if keep_user:
            ks['userId'] = keep_user
        if ms is not None:
            spouse = next((p for p in base if p['relation'] == 'spouse'), None)
            fresh = dict(ms)
            if moved_user:
                fresh['userId'] = moved_user
            if spouse is not None and spouse['gender'] == ms['gender'] and not spouse.get('deceased') \
                    and _names_compatible(spouse, ms):
                merged = _merge_entry({k: v for k, v in fresh.items() if k not in ('id', 'of', 'relation')}, spouse)
                merged.update(id=spouse['id'], relation='spouse', of=ks['id'])
                _replace(base, spouse, merged)
                _merge_ancestors(base, spouse['id'], moved, ms['id'], other_wins=True)
            else:
                if spouse is not None:
                    _to_former(base, spouse, ks)
                base.append(dict(fresh, relation='spouse', of=ks['id']))
                base.extend(_ancestors(moved, ms['id']))
            theirs_of_mine = next((p for p in moved if p['relation'] == 'spouse' and p.get('of') == ms['id']), None)
            if theirs_of_mine is not None:
                if _matches_kept_self(ks, theirs_of_mine):
                    merged = _merge_entry(ks, {k: v for k, v in theirs_of_mine.items() if k not in ('id', 'of', 'relation', 'userId')})
                    _replace(base, ks, merged)
                    ks = merged
                    _merge_ancestors(base, ks['id'], moved, theirs_of_mine['id'], other_wins=False)
                else:  # a late or former partner of the moved user
                    _add_former(base, theirs_of_mine, moved, ks)
            moved_former = next((p for p in moved if p['relation'] == 'formerSpouse'), None)
            if moved_former is not None:
                _add_former(base, moved_former, moved, ks)
    out = base + _merge_children(keep, moved)
    self_id = self_id_of(out)
    return [dict(p, of=self_id) if p['relation'] == 'child' and 'of' in p and self_id else p for p in out]


def _figure_of(people, user_id):
    return next((p for p in people if p.get('userId') == user_id and p['relation'] in ('self', 'spouse')), None)


def _view(people, me, other):
    """The tree as `me` keeps it after a split: me as `self` with their own parents, the other as a names-only
    spouse, the children side as is."""
    original_self = next((p for p in people if p['relation'] == 'self'), None)
    mine = {k: v for k, v in me.items() if k != 'of'}
    mine['relation'] = 'self'
    out = [mine]
    if other is not None:
        out.append(_names_only(other, people, 'spouse', me['id']))
    out += _ancestors(people, me['id'])
    if original_self is not None and original_self['id'] == me['id']:
        out += [p for p in people if p['relation'] == 'formerSpouse']
    out += [dict(p, of=me['id']) if p['relation'] == 'child' and 'of' in p else p for p in child_side(people)]
    return out


def split_people(people, leaver, other):
    """(leaver's people, remaining adult's people) when `leaver` leaves a family of two (unlink, leaving the
    Kehila, account deletion). Figures are found by their server-set `userId`. Each adult keeps their own figure
    and ancestors; the other becomes a names-only spouse; children are copied to both. Without figures the
    leaver gets the children side and the remaining adult keeps the tree as it is."""
    mine, theirs = _figure_of(people, leaver), _figure_of(people, other)
    if mine is None:
        return child_side(people), list(people)
    return _view(people, mine, theirs), (_view(people, theirs, mine) if theirs is not None else child_side(people))


def assign_user_ids(new, stored, caller, adults):
    """`new` (validated, so without userIds) with the server-managed `userId`s: stored ones stay on their figures;
    adults who have none take a free `self` / `spouse` slot, the caller first."""
    held = {p['id']: p['userId'] for p in stored if p.get('userId')}
    out = []
    for p in new:
        p = dict(p)
        if p['id'] in held and p['relation'] in ('self', 'spouse'):
            p['userId'] = held[p['id']]
        out.append(p)
    used = {p['userId'] for p in out if 'userId' in p}
    pending = [u for u in [caller] + [a for a in adults if a != caller] if u in adults and u not in used]
    slots = [p for rel in ('self', 'spouse') for p in out if p['relation'] == rel and 'userId' not in p]
    for user, slot in zip(pending, slots):
        slot['userId'] = user
    return out


def tree_view(family):
    """The GET body: people, version and `updatedAt` (Unix seconds of the last tree write; null if none yet)."""
    updated = family.get('updatedAt')
    return {'people': people_of(family), 'version': int(family['version']),
            'updatedAt': int(updated) if updated is not None else None}
