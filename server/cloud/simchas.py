"""Upcoming simchas for gabbaim (UX-DESIGN 17.14): bar and bat mitzvahs of living children, from the family trees.
Pure: no repo access, no logging. An item carries only kind, first name, surname, date and whether the family set
the date by hand; nothing else about the child or the family leaves this module."""
from datetime import date, timedelta

from pyluach import dates, parshios

from ..hebrew_calendar import bar_mitzvah_date, bat_mitzvah_date
from .tree_rules import people_of

SATURDAY = 5
MAX_WEEKS = 12


def sunday_of(day):
    return day - timedelta(days=(day.weekday() + 1) % 7)


def shabbat_of(week_start):
    return week_start + timedelta(days=6)


def shabbat_info(day):
    """(parasha name or '', label) of the Shabbat `day`. A holiday Shabbat has no parasha."""
    greg = dates.GregorianDate.from_pydate(day)
    parasha = parshios.getparsha_string(greg, israel=True, hebrew=True) or ''
    if parasha:
        return parasha, 'שבת פרשת ' + parasha
    festival = dates.HebrewDate.from_pydate(day).festival(israel=True, hebrew=True, prefix_day=False)
    return '', 'שבת ' + festival if festival else 'שבת'


def next_shabbat(day):
    return day + timedelta(days=(SATURDAY - day.weekday()) % 7)


def _iso(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def _surname(child, people):
    own = (child.get('surname') or '').strip()
    if own:
        return own
    for relation in ('self', 'spouse'):
        for person in people:
            if person.get('relation') == relation and (person.get('surname') or '').strip():
                return person['surname'].strip()
    return ''


def _entries(people, today):
    """[(kind, firstName, surname, date, manual, label)] for each living child with a bar/bat mitzvah date."""
    out = []
    for child in people:
        first = (child.get('hebrewFirst') or '').strip()
        if child.get('relation') != 'child' or child.get('deceased') or not first:
            continue
        surname = _surname(child, people)
        if child.get('gender') == 'f':
            day = bat_mitzvah_date(child.get('birth'), today)
            if day:
                out.append(('bat', first, surname, day, False, None))
            continue
        stored = child.get('barMitzvah')
        if stored:
            day = _iso(stored.get('date'))
            if day:
                out.append(('bar', first, surname, day, bool(stored.get('manual')), stored.get('label') or None))
            continue
        day = bar_mitzvah_date(child.get('birth'), today)
        if day:
            out.append(('bar', first, surname, next_shabbat(day), False, None))
    return out


def upcoming_simchas(families, today, weeks=8):
    """`families` are lists of people. The `weeks` weeks (Sunday to Saturday) from the week of `today`, each
    `{week, shabbat, parasha, label, items}`; a quiet week has no items. Items run by date, then first name."""
    start = sunday_of(today)
    result = []
    for n in range(weeks):
        shabbat = shabbat_of(start + timedelta(days=7 * n))
        parasha, label = shabbat_info(shabbat)
        result.append({'week': (start + timedelta(days=7 * n)).isoformat(), 'shabbat': shabbat.isoformat(),
                       'parasha': parasha, 'label': label, 'items': []})
    last = shabbat_of(start + timedelta(days=7 * (weeks - 1)))
    found = []
    for people in families:
        found += _entries(people, today)
    for kind, first, surname, day, manual, label in sorted(found, key=lambda e: (e[3], e[1], e[0])):
        if day < today or day > last:
            continue
        item = {'kind': kind, 'firstName': first, 'surname': surname, 'date': day.isoformat(), 'manual': manual}
        if label:
            item['label'] = label
        result[(day - start).days // 7]['items'].append(item)
    return result


def families_people(families):
    return [people_of(family) for family in families]
