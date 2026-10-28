"""Template fields of a message (event, mazal tov, condolence): the schema and strict validation.
The keys and limits are the contract with src/client/templates.ts. Errors are 400 invalid_fields with a key path,
never the caller's value or unknown key."""
import re
from datetime import date

from .schedule_rules import Checker

TEMPLATE_OF_TYPE = {'event': 'event', 'celebration': 'mazal', 'condolence': 'condolence'}
TEMPLATE_IDS = ('event', 'mazal', 'condolence')

_DATE = re.compile(r'\d{4}-\d{2}-\d{2}')
_checker = Checker('invalid_fields')

# key -> (kind, argument); kinds: text(max), date, clock, enum(options), bool
_SCHEMAS = {
    'event': {
        'name': ('text', 120), 'date': ('date', None), 'time': ('clock', None), 'place': ('text', 120),
        'for': ('enum', ('all', 'men', 'women', 'youth', 'kids')), 'organisers': ('text', 200),
        'more': ('text', 1000), 'cancelled': ('bool', None)},
    'mazal': {
        'occasion': ('enum', ('birthSon', 'birthDaughter', 'barMitzvah', 'batMitzvah', 'engagement', 'wedding', 'other')),
        'occasionOther': ('text', 60), 'whose': ('enum', ('parents', 'grandparents', 'other')),
        'whoseOther': ('text', 60), 'surname': ('text', 60), 'firstNames': ('text', 120), 'name': ('text', 60),
        'parents': ('text', 120), 'blessing': ('text', 200)},
    'condolence': {
        'variant': ('enum', ('only', 'later', 'full')), 'surname': ('text', 60), 'deceased': ('text', 80),
        'relation': ('text', 80), 'address': ('text', 200), 'hours': ('text', 120), 'until': ('date', None),
        'prayers': ('text', 200)},
}
_REQUIRED = {
    'event': ('name', 'date', 'time', 'place', 'for'),
    'mazal': ('occasion', 'whose', 'surname'),
    'condolence': ('variant', 'surname', 'deceased', 'relation'),
}


def _conditional(template_id, out):
    """Keys that become required given the other values."""
    if template_id == 'mazal':
        return [key for key, flag in (('occasionOther', 'occasion'), ('whoseOther', 'whose')) if out.get(flag) == 'other']
    if template_id == 'condolence' and out.get('variant') == 'full':
        return ['address', 'hours', 'until']
    return []


def _value(kind, arg, value, path):
    if kind == 'text':
        return _checker.string(value, arg, path, required=False)
    if kind == 'enum':
        return _checker.enum(value, arg, path)
    if kind == 'bool':
        if not isinstance(value, bool):
            _checker.fail(path)
        return value
    if kind == 'clock':
        return _checker.clock(value, path)
    if not isinstance(value, str) or not _DATE.fullmatch(value):  # date: a real calendar day
        _checker.fail(path)
    try:
        date.fromisoformat(value)
    except ValueError:
        _checker.fail(path)
    return value


def validate_fields(template_id, value):
    """The cleaned fields dict (texts stripped, empty optional texts dropped); raises ApiError(400, 'invalid_fields', path)."""
    schema = _SCHEMAS.get(template_id)
    if schema is None:
        _checker.fail('<template>')
    _checker.obj(value, '', optional=tuple(schema))
    out = {}
    for key, raw in value.items():
        kind, arg = schema[key]
        cleaned = _value(kind, arg, raw, key)
        if kind == 'text' and not cleaned:
            continue
        out[key] = cleaned
    for key in (*_REQUIRED[template_id], *_conditional(template_id, out)):
        if key not in out:
            _checker.fail(key)
    return out
