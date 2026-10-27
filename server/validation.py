from datetime import date, datetime
import re
from zoneinfo import ZoneInfo
from .hebrew_calendar import birth_date


def israel_today():
    return datetime.now(ZoneInfo('Asia/Jerusalem')).date()


class APIError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message
        super().__init__(message)


DEFAULT_PREFERENCES = dict(weekly=True, community=True, replies=True, events=True)
MONTH_DAYS = dict(tishrei=30, cheshvan=30, kislev=30, tevet=29, shevat=30,
                  adar=29, adar_i=30, adar_ii=29, nisan=30, iyar=29,
                  sivan=30, tamuz=29, av=30, elul=29)
RELATIONSHIPS = {'father', 'mother', 'son', 'daughter', 'brother', 'sister', 'father_in_law', 'mother_in_law', 'uncle', 'aunt', 'unknown'}
CATEGORIES = {'weekly', 'celebration', 'condolence', 'event'}
TRIBES = {'kohen', 'levi', 'yisrael'}


def text(value, label, maximum=200, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise APIError(400, f'{label}: ערך לא תקין או ארוך מדי.')
    return value.strip()


def email(value):
    value = text(value, 'אימייל', 254, True).lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
        raise APIError(400, 'כתובת האימייל אינה תקינה.')
    return value


def civil_date(value, label, required=False, allow_future=False):
    value = text(value, label, 10, required)
    if not value:
        return value
    try:
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value or (not allow_future and parsed > israel_today()):
            raise ValueError()
    except ValueError:
        raise APIError(400, f'{label}: תאריך לא תקין או עתידי.')
    return value


def phone(value):
    value = text(value, 'מספר טלפון', 40)
    if value and not re.fullmatch(r'\+?[0-9]{7,15}', re.sub(r'[\s().-]', '', value)):
        raise APIError(400, 'מספר הטלפון אינו תקין.')
    return value


def hebrew_birth_date(value, required=False, existing=None):
    if value is None and not required:
        return None
    # A legacy client may round-trip a previously saved yearless birthday.
    # If a full year is already known, omitting it must never erase it.
    if isinstance(value, dict) and set(value) == {'day', 'month'} and type(value['day']) is int and isinstance(existing, dict):
        if all(value[key] == existing.get(key) for key in value):
            return existing
    try:
        birth_date(value, israel_today())
    except (ValueError, TypeError, KeyError):
        raise APIError(400, 'יש לבחור יום, חודש ושנה תקינים לתאריך הלידה העברי, שאינו בעתיד.')
    return dict(value)


def tribe(value, required=False):
    if not isinstance(value, str) or (value not in TRIBES and (required or value != '')):
        raise APIError(400, 'יש לבחור כהן, לוי או ישראל.')
    return value


def children(value, existing=()):
    if not isinstance(value, list) or len(value) > 30:
        raise APIError(400, 'ניתן לשמור עד 30 ילדים בפרופיל.')
    fields = {'id', 'gender', 'name', 'birthDate', 'torahName', 'barMitzvahParasha', 'barMitzvahDate', 'married', 'spouseName', 'spouseTorahName', 'spousePrayerName'}
    previous = {child['id']: child for child in existing}
    result, identifiers = [], set()
    for item in value:
        if not isinstance(item, dict) or not fields <= set(item) or set(item) - fields - {'hebrewBirthDate', 'spouseTribe'}:
            raise APIError(400, 'מבנה פרטי הילד אינו תקין.')
        identifier = text(item['id'], 'מזהה ילד', 100, True)
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier) or identifier in identifiers:
            raise APIError(400, 'מזהי הילדים צריכים להיות תקינים ושונים זה מזה.')
        identifiers.add(identifier)
        if not isinstance(item['gender'], str) or item['gender'] not in ('son', 'daughter') or type(item['married']) is not bool:
            raise APIError(400, 'פרטי הבן או הבת אינם תקינים.')
        child = {key: text(item[key], key, required=key == 'name') for key in ['name', 'torahName', 'barMitzvahParasha', 'spouseName', 'spouseTorahName', 'spousePrayerName']}
        child.update(id=identifier, gender=item['gender'], married=item['married'],
                     birthDate=civil_date(item['birthDate'], 'תאריך לידת הילד'),
                     barMitzvahDate=civil_date(item['barMitzvahDate'], 'שבת בר המצווה', allow_future=True))
        child['hebrewBirthDate'] = hebrew_birth_date(
            item.get('hebrewBirthDate', previous.get(identifier, {}).get('hebrewBirthDate')),
            required=not child['birthDate'], existing=previous.get(identifier, {}).get('hebrewBirthDate'))
        if child['gender'] == 'daughter' and child['married']:
            old = previous.get(identifier, {})
            saved_tribe = old.get('spouseTribe', '') if old.get('gender') == 'daughter' and old.get('married') else ''
            child['spouseTribe'] = tribe(item.get('spouseTribe', saved_tribe), required='spouseTribe' in item)
        else:
            child['spouseTribe'] = tribe(item.get('spouseTribe', ''))
            if child['spouseTribe']:
                raise APIError(400, 'מעמד החתן נשמר רק עבור בן זוג של בת נשואה.')
        if child['barMitzvahDate'] and (date.fromisoformat(child['barMitzvahDate']).weekday() != 5 or (child['birthDate'] and child['barMitzvahDate'] < child['birthDate'])):
            raise APIError(400, 'תאריך בר המצווה צריך להיות שבת, לאחר הלידה.')
        if child['gender'] == 'daughter' and any(child[key] for key in ['torahName', 'barMitzvahParasha', 'barMitzvahDate']):
            raise APIError(400, 'פרטי עלייה לתורה ובר מצווה נשמרים עבור בנים.')
        if not child['married'] and any(child[key] for key in ['spouseName', 'spouseTorahName', 'spousePrayerName']):
            raise APIError(400, 'יש לסמן נשוי/אה כדי לשמור פרטי בן או בת זוג.')
        if (child['gender'] == 'son' and child['spouseTorahName']) or (child['gender'] == 'daughter' and child['spousePrayerName']):
            raise APIError(400, 'פרטי בן או בת הזוג אינם תואמים לבחירה.')
        result.append(child)
    return result


def profile(value, existing=None):
    fields = {'torahName', 'wifePrayerName', 'barMitzvahParasha', 'birthDate', 'yahrzeits'}
    optional = {'name', 'firstName', 'lastName', 'phone', 'wifePhone', 'children', 'hebrewBirthDate', 'tribe'}
    if not isinstance(value, dict) or not fields <= set(value) or set(value) - fields - optional:
        raise APIError(400, 'מבנה פרטי החבר אינו תקין.')
    existing = existing or {}
    result = {key: text(value[key], key) for key in fields - {'yahrzeits'}}
    name_keys = {'firstName', 'lastName'}
    if name_keys & set(value) and not name_keys <= set(value):
        raise APIError(400, 'יש להזין שם פרטי ושם משפחה בנפרד.')
    for key in name_keys:
        result[key] = text(value.get(key, existing.get(key, '')), key, required=key in value)
    if result['firstName'] and result['lastName']:
        result['name'] = text(result['firstName'] + ' ' + result['lastName'], 'שם מלא', required=True)
    else:
        result['name'] = text(value.get('name', existing.get('name', '')), 'שם מלא', required=True)
    result['birthDate'] = civil_date(result['birthDate'], 'תאריך לידה')
    # Older clients omit the new field: retain known values without guessing
    # an unknown family's status. New clients must submit a valid selection.
    result['tribe'] = tribe(value.get('tribe', existing.get('tribe', '')), required='tribe' in value)
    result['hebrewBirthDate'] = hebrew_birth_date(value.get('hebrewBirthDate', existing.get('hebrewBirthDate')), existing=existing.get('hebrewBirthDate'))
    result['phone'] = phone(value.get('phone', existing.get('phone', '')))
    result['wifePhone'] = phone(value.get('wifePhone', existing.get('wifePhone', '')))
    result['children'] = children(value['children'], existing.get('children', [])) if 'children' in value else existing.get('children', [])
    if not isinstance(value['yahrzeits'], list) or len(value['yahrzeits']) > 30:
        raise APIError(400, 'ניתן לשמור עד 30 ימי זיכרון.')
    result['yahrzeits'] = []
    ids = set()
    for item in value['yahrzeits']:
        if not isinstance(item, dict) or set(item) != {'id', 'name', 'relationship', 'day', 'month', 'year'}:
            raise APIError(400, 'מבנה יום הזיכרון אינו תקין.')
        identifier = text(item['id'], 'מזהה', 100, True)
        if identifier in ids:
            raise APIError(400, 'מזהי ימי הזיכרון חייבים להיות שונים.')
        ids.add(identifier)
        name = text(item['name'], 'שם הנפטר/ת', required=True)
        month = item['month']
        day = item['day']
        if not isinstance(month, str) or month not in MONTH_DAYS or type(day) is not int or not 1 <= day <= MONTH_DAYS[month]:
            raise APIError(400, 'יום הזיכרון אינו תקין לחודש שנבחר.')
        if not isinstance(item['relationship'], str) or item['relationship'] not in RELATIONSHIPS:
            raise APIError(400, 'קרבה משפחתית לא תקינה.')
        year = text(item['year'], 'שנת הפטירה', 4)
        # A broad upper bound without pretending to convert a Hebrew date.
        # Actual anniversary resolution (incl. Adar customs) belongs to the future calendar service.
        if year and (not re.fullmatch(r'[0-9]{4}', year) or not 5000 <= int(year) <= israel_today().year + 3761):
            raise APIError(400, 'שנת הפטירה העברית אינה תקינה.')
        result['yahrzeits'].append(dict(id=identifier, name=name, relationship=item['relationship'], day=day, month=month, year=year))
    return result


def preferences(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULT_PREFERENCES) or any(type(v) is not bool for v in value.values()):
        raise APIError(400, 'העדפות ההתראות אינן תקינות.')
    return value


def message(value):
    if not isinstance(value, dict) or set(value) - {'category', 'title', 'body', 'pinned'} or not {'category', 'title', 'body'} <= set(value):
        raise APIError(400, 'מבנה ההודעה אינו תקין.')
    if not isinstance(value['category'], str) or value['category'] not in CATEGORIES:
        raise APIError(400, 'סוג ההודעה אינו תקין.')
    if type(value.get('pinned', False)) is not bool:
        raise APIError(400, 'ערך נעיצת ההודעה אינו תקין.')
    return dict(category=value['category'], title=text(value['title'], 'כותרת', 200, True),
                body=text(value['body'], 'תוכן ההודעה', 10000, True), pinned=value.get('pinned', False))
