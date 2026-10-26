"""The gabbai's list import. Results carry only the row index, a status and an error code: no names or emails."""
import re

from . import accounts
from .ids import new_id

EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
MAX_EMAIL = 254
MAX_NAME = 60
MAX_GROUPS = 20
ROLES = ('listener', 'member', 'gabbai')
CLASSIFICATIONS = ('', 'א', 'קבוע')


def _name(row, field, required):
    value = row.get(field, '')
    if not isinstance(value, str):
        return None
    value = value.strip()
    if len(value) > MAX_NAME or (required and not value):
        return None
    return value


def clean_row(row):
    """Return `(fields, None)` or `(None, error_code)`."""
    email = row.get('email')
    email = email.strip().lower() if isinstance(email, str) else ''
    if len(email) > MAX_EMAIL or not EMAIL_RE.fullmatch(email):
        return None, 'invalid_email'
    first, last = _name(row, 'firstName', True), _name(row, 'lastName', False)
    if first is None:
        return None, 'invalid_first_name'
    if last is None:
        return None, 'invalid_last_name'
    role, classification = row.get('role'), row.get('classification', '')
    if not isinstance(role, str) or role not in ROLES:
        return None, 'invalid_role'
    if not isinstance(classification, str) or classification not in CLASSIFICATIONS:
        return None, 'invalid_classification'
    groups = row.get('groups', [])
    if (not isinstance(groups, list) or len(groups) > MAX_GROUPS
            or not all(isinstance(g, str) for g in groups)):
        return None, 'invalid_groups'
    return {'email': email, 'first': first, 'last': last, 'role': role, 'groups': groups,
            'classification': '' if role == 'listener' else classification}, None


MIN_REMAINING_MS = 3000


def import_rows(repo, client, pool_id, k, rows, remaining_ms=None):
    """`remaining_ms()` is the time left (Lambda context); below MIN_REMAINING_MS the rest are `skipped`."""
    settings = repo.get_kehila(k).get('settings', {})
    lang = settings.get('defaultLang', 'he')
    broadcast_default = bool(settings.get('memberBroadcastDefault', False))
    group_by_name = {g['name'].strip().casefold(): g['sk'][len('G#'):] for g in repo.list_groups(k)}
    seen, results = set(), []
    for index, raw in enumerate(rows):
        if remaining_ms and remaining_ms() < MIN_REMAINING_MS:
            results.append({'index': index, 'status': 'skipped'})
            continue
        row, error = clean_row(raw)
        if row and row['email'] in seen:
            row, error = None, 'duplicate_email'
        if error:
            results.append({'index': index, 'status': 'invalid', 'error': error})
            continue
        group_ids = {group_by_name.get(g.strip().casefold()) for g in row['groups']}
        if None in group_ids:
            results.append({'index': index, 'status': 'invalid', 'error': 'unknown_group'})
            continue
        seen.add(row['email'])
        sub, created = accounts.ensure_account(client, pool_id, row['email'])
        user_id = repo.create_user_id(sub, new_id())
        repo.put_profile_if_absent(user_id, row['first'], row['last'], lang)
        status = repo.import_membership(k, user_id, f"{row['first']} {row['last']}".strip(), row['role'],
                                        row['classification'], broadcast_default)
        repo.add_member_groups(k, user_id, group_ids)  # only ever adds; the row's status is unchanged
        results.append({'index': index, 'status': 'created' if created and status == 'added' else status})
    return results
