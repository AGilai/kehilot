"""Pure family rules: no I/O."""
import re
from datetime import date

from . import inputs
from .errors import ApiError

SEPARATOR = ' · '


def family_name(profiles):
    """Display name from the adults' profiles (adult order): each contributes the last name, or the first name
    when the last is empty; parts are de-duplicated in order. A missing profile counts as empty names."""
    parts = []
    for profile in profiles:
        profile = profile or {}
        part = (profile.get('lastName') or '').strip() or (profile.get('firstName') or '').strip()
        if part and part not in parts:
            parts.append(part)
    return SEPARATOR.join(parts)


BIRTH_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
MIN_BIRTH_DATE = '1900-01-01'


def clean_child(d, today):
    """Validated {firstName, gender, birthDate?} from a request body; `today` is yyyy-mm-dd (Israel)."""
    child = {'firstName': inputs.text(d, 'firstName', 60, required=True),
             'gender': inputs.choice(d, 'gender', ('m', 'f'))}
    birth = d.get('birthDate')
    if birth is None or birth == '':
        return child
    if not isinstance(birth, str) or not BIRTH_DATE_RE.fullmatch(birth):
        raise ApiError(400, 'invalid_birth_date')
    try:
        date.fromisoformat(birth)
    except ValueError:
        raise ApiError(400, 'invalid_birth_date')
    if not MIN_BIRTH_DATE <= birth <= today:
        raise ApiError(400, 'invalid_birth_date')
    child['birthDate'] = birth
    return child
