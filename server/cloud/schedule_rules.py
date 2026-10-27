"""Prayer schedule shape: strict validation of the JSON the shared TypeScript module (src/schedule/types.ts) computes
from, plus the Kehila location defaults. The server stores and checks; it never computes times."""
import math
import re
from datetime import date, timedelta
from decimal import Decimal

from .errors import ApiError

# The one server-side default for a Kehila that never set its location (Petah Tikva, sea level, 40 minutes).
DEFAULT_LOCATION = {'latitude': 32.0878, 'longitude': 34.8878, 'elevation': 'sea', 'candleMinutes': 40}
DEFAULT_SHEET = {'candleCities': []}

MAX_SECTIONS = 12
MAX_ROWS = 40
LABEL_MAX = 60
NOTE_MAX = 200
MAX_OVERRIDE_ROWS = 200
MAX_EXTRA_ROWS = 40
SCHEDULE_BODY_MAX = 192 * 1024
WEEK_BODY_MAX = 48 * 1024
CITY_COUNT_MAX = 2

ANCHORS = ('alotHaShachar', 'misheyakir', 'sunrise', 'sofZmanShmaMGA', 'sofZmanShmaGRA', 'sofZmanTfilaGRA', 'chatzot',
           'minchaGedola', 'minchaKetana', 'plagHaMincha', 'sunset', 'candleLighting', 'tzeit', 'shabbatEnd')
SHABBAT_DAYS = ('friday', 'shabbat')
WEEKDAY_DAYS = ('earliest', 'latest')
_UNSAFE = re.compile('[\\x00-\\x1f\\x7f-\\x9f\\u2028\\u2029\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]')
_CLOCK = re.compile(r'(?:[01]\d|2[0-3]):[0-5]\d')
_ID = re.compile(r'[A-Za-z0-9_-]{1,40}')


class Checker:
    """Raises 400 `<code>` with the path of the first offending field."""

    def __init__(self, code):
        self.code = code

    def fail(self, path):
        raise ApiError(400, self.code, path)

    def obj(self, value, path, required=(), optional=()):
        if not isinstance(value, dict):
            self.fail(path)
        for key in value:
            if key not in required and key not in optional:
                self.fail(f'{path}.{key}' if path else key)
        for key in required:
            if key not in value:
                self.fail(f'{path}.{key}' if path else key)
        return value

    def enum(self, value, options, path):
        if not isinstance(value, str) or value not in options:
            self.fail(path)
        return value

    def integer(self, value, lo, hi, path):
        if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
            self.fail(path)
        return value

    def number(self, value, lo, hi, path):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
                or not lo <= value <= hi:
            self.fail(path)
        return value

    def string(self, value, maximum, path, required=True):
        if not isinstance(value, str) or _UNSAFE.search(value):
            self.fail(path)
        value = value.strip()
        if len(value) > maximum or (required and not value):
            self.fail(path)
        return value

    def clock(self, value, path):
        if not isinstance(value, str) or not _CLOCK.fullmatch(value):
            self.fail(path)
        return value

    def ident(self, value, path):
        if not isinstance(value, str) or not _ID.fullmatch(value):
            self.fail(path)
        return value

    def text(self, value, path):
        self.obj(value, path, ('he',), ('en',))
        out = {'he': self.string(value['he'], LABEL_MAX, path + '.he')}
        if 'en' in value:
            out['en'] = self.string(value['en'], LABEL_MAX, path + '.en', required=False)
        return out

    def note(self, value, path):
        return self.string(value, NOTE_MAX, path, required=False)


def _formula(c, f, path, days, warn_id, warnings):
    c.obj(f, path, ('anchor', 'day', 'offset', 'rounding'), ('notEarlierThan', 'notLaterThan'))
    out = {'anchor': c.enum(f['anchor'], ANCHORS, path + '.anchor'), 'day': c.enum(f['day'], days, path + '.day')}
    c.obj(f['offset'], path + '.offset', ('minutes', 'direction'))
    out['offset'] = {'minutes': c.integer(f['offset']['minutes'], 0, 720, path + '.offset.minutes'),
                     'direction': c.enum(f['offset']['direction'], ('before', 'after'), path + '.offset.direction')}
    r = f['rounding']
    if isinstance(r, dict) and r.get('mode') == 'none':
        c.obj(r, path + '.rounding', ('mode',))
        out['rounding'] = {'mode': 'none'}
    else:
        c.obj(r, path + '.rounding', ('mode', 'step'))
        out['rounding'] = {'mode': c.enum(r['mode'], ('down', 'up', 'nearest'), path + '.rounding.mode'),
                           'step': c.enum_int(r['step'], (1, 5, 10, 15), path + '.rounding.step')}
    for key in ('notEarlierThan', 'notLaterThan'):
        if key in f:
            out[key] = c.clock(f[key], f'{path}.{key}')
    if 'notEarlierThan' in out and 'notLaterThan' in out and out['notEarlierThan'] > out['notLaterThan']:
        warnings.append({'rowId': warn_id, 'code': 'bounds_cross'})  # notLaterThan wins; not an error
    return out


def _enum_int(self, value, options, path):
    if isinstance(value, bool) or not isinstance(value, int) or value not in options:
        self.fail(path)
    return value


Checker.enum_int = _enum_int


def _time(c, t, path, days, warn_id, warnings):
    if not isinstance(t, dict):
        c.fail(path)
    kind = c.enum(t.get('kind'), ('none', 'fixed', 'formula'), path + '.kind')
    if kind == 'none':
        c.obj(t, path, ('kind',))
        return {'kind': 'none'}
    if kind == 'fixed':
        c.obj(t, path, ('kind', 'at'))
        return {'kind': 'fixed', 'at': c.clock(t['at'], path + '.at')}
    c.obj(t, path, ('kind', 'formula'))
    return {'kind': 'formula', 'formula': _formula(c, t['formula'], path + '.formula', days, warn_id, warnings)}


def _row(c, row, path, kind, seen, warnings):
    c.obj(row, path, ('id', 'label', 'time'), ('note', 'role', 'day'))
    rid = c.ident(row['id'], path + '.id')
    if rid in seen:
        c.fail(path + '.id')
    seen.add(rid)
    out = {'id': rid, 'label': c.text(row['label'], path + '.label')}
    if 'note' in row:
        out['note'] = c.note(row['note'], path + '.note')
    if 'role' in row:
        out['role'] = c.enum(row['role'], ('candles',), path + '.role')
    if 'day' in row:
        if kind != 'shabbat':
            c.fail(path + '.day')
        out['day'] = c.enum(row['day'], SHABBAT_DAYS, path + '.day')
    out['time'] = _time(c, row['time'], path + '.time', SHABBAT_DAYS if kind == 'shabbat' else WEEKDAY_DAYS, rid, warnings)
    return out


def validate_sections(sections):
    """-> (clean sections, warnings). Strict: unknown keys and enums are 400 invalid_schedule with a `field` hint."""
    c = Checker('invalid_schedule')
    if not isinstance(sections, list) or len(sections) > MAX_SECTIONS:
        c.fail('sections')
    out, warnings, section_ids, row_ids = [], [], set(), set()
    for i, s in enumerate(sections):
        path = f'sections[{i}]'
        c.obj(s, path, ('id', 'kind', 'title', 'rows'))
        sid = c.ident(s['id'], path + '.id')
        if sid in section_ids:
            c.fail(path + '.id')
        section_ids.add(sid)
        kind = c.enum(s['kind'], ('shabbat', 'weekday'), path + '.kind')
        title = c.text(s['title'], path + '.title')
        if not isinstance(s['rows'], list) or len(s['rows']) > MAX_ROWS:
            c.fail(path + '.rows')
        rows = [_row(c, r, f'{path}.rows[{j}]', kind, row_ids, warnings) for j, r in enumerate(s['rows'])]
        out.append({'id': sid, 'kind': kind, 'title': title, 'rows': rows})
    return out, warnings


def validate_week_overrides(value):
    """-> clean `{rows?, extra?}`. Row ids are only checked for shape (a row may be deleted from the schedule later)."""
    c = Checker('invalid_overrides')
    c.obj(value, '', (), ('rows', 'extra'))
    out = {}
    if 'rows' in value:
        rows = value['rows']
        if not isinstance(rows, dict) or len(rows) > MAX_OVERRIDE_ROWS:
            c.fail('rows')
        out['rows'] = {}
        for rid, o in rows.items():
            path = f'rows.{rid}'
            c.ident(rid, path)
            if not isinstance(o, dict):
                c.fail(path)
            if c.enum(o.get('kind'), ('time', 'hide'), path + '.kind') == 'hide':
                c.obj(o, path, ('kind',))
                out['rows'][rid] = {'kind': 'hide'}
            else:
                c.obj(o, path, ('kind', 'at'), ('note',))
                item = {'kind': 'time', 'at': c.clock(o['at'], path + '.at')}
                if 'note' in o:
                    item['note'] = c.note(o['note'], path + '.note')
                out['rows'][rid] = item
    if 'extra' in value:
        extra = value['extra']
        if not isinstance(extra, list) or len(extra) > MAX_EXTRA_ROWS:
            c.fail('extra')
        out['extra'], seen, warnings = [], set(), []
        for i, e in enumerate(extra):
            path = f'extra[{i}]'
            c.obj(e, path, ('id', 'sectionId', 'label', 'time'), ('afterRowId', 'note', 'day'))
            item = {'id': c.ident(e['id'], path + '.id'), 'sectionId': c.ident(e['sectionId'], path + '.sectionId')}
            if item['id'] in seen:
                c.fail(path + '.id')
            seen.add(item['id'])
            if 'afterRowId' in e and e['afterRowId'] is not None:
                item['afterRowId'] = c.ident(e['afterRowId'], path + '.afterRowId')
            elif 'afterRowId' in e:
                item['afterRowId'] = None
            item['label'] = c.text(e['label'], path + '.label')
            if 'note' in e:
                item['note'] = c.note(e['note'], path + '.note')
            if 'day' in e:
                item['day'] = c.enum(e['day'], SHABBAT_DAYS, path + '.day')
            # the section kind is not known here (it is the schedule's): accept either set of day sources
            item['time'] = _time(c, e['time'], path + '.time', SHABBAT_DAYS + WEEKDAY_DAYS, item['id'], warnings)
            out['extra'].append(item)
    return out


def week_start(value):
    """A Friday as YYYY-MM-DD, else None."""
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return None
    try:
        d = date.fromisoformat(value)
    except ValueError:
        return None
    return d if d.weekday() == 4 else None


def week_expiry(friday):
    """Epoch seconds (UTC midnight) a week after the week ends: Thursday = friday + 6, plus 7 days."""
    end = friday + timedelta(days=14)
    return int((end - date(1970, 1, 1)).total_seconds())


def _location(c, v, path):
    c.obj(v, path, ('latitude', 'longitude', 'elevation', 'candleMinutes'), ('elevationMeters',))
    out = {'latitude': c.number(v['latitude'], -90, 90, path + '.latitude'),
           'longitude': c.number(v['longitude'], -180, 180, path + '.longitude'),
           'elevation': c.enum(v['elevation'], ('sea', 'ground'), path + '.elevation'),
           'candleMinutes': c.integer(v['candleMinutes'], 0, 90, path + '.candleMinutes')}
    if out['elevation'] == 'ground':
        if 'elevationMeters' not in v:
            c.fail(path + '.elevationMeters')
        out['elevationMeters'] = c.integer(v['elevationMeters'], 0, 3000, path + '.elevationMeters')
    elif 'elevationMeters' in v:
        c.fail(path + '.elevationMeters')
    return out


def validate_location(value):
    return _location(Checker('invalid_location'), value, 'location')


def validate_sheet(value):
    c = Checker('invalid_sheet')
    c.obj(value, 'sheet', ('candleCities',))
    cities = value['candleCities']
    if not isinstance(cities, list) or len(cities) > CITY_COUNT_MAX:
        c.fail('sheet.candleCities')
    out = []
    for i, city in enumerate(cities):
        path = f'sheet.candleCities[{i}]'
        c.obj(city, path, ('name', 'latitude', 'longitude', 'candleMinutes'))
        out.append({'name': c.text(city['name'], path + '.name'),
                    'latitude': c.number(city['latitude'], -90, 90, path + '.latitude'),
                    'longitude': c.number(city['longitude'], -180, 180, path + '.longitude'),
                    'candleMinutes': c.integer(city['candleMinutes'], 0, 90, path + '.candleMinutes')})
    return {'candleCities': out}


def plain(value):
    """DynamoDB numbers back to JSON numbers."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [plain(v) for v in value]
    return value


def stored(value):
    """JSON numbers to DynamoDB numbers (floats become Decimal)."""
    if isinstance(value, float):
        return Decimal(repr(value))
    if isinstance(value, dict):
        return {k: stored(v) for k, v in value.items()}
    if isinstance(value, list):
        return [stored(v) for v in value]
    return value


def location_of(settings):
    """The effective location; a missing or malformed stored value reads as the default."""
    raw = plain(settings.get('kehilaLocation')) if isinstance(settings, dict) else None
    try:
        return validate_location(raw)
    except ApiError:
        return dict(DEFAULT_LOCATION)


def sheet_of(settings):
    raw = plain(settings.get('sheet')) if isinstance(settings, dict) else None
    try:
        return validate_sheet(raw)
    except ApiError:
        return {'candleCities': []}
