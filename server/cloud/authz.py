"""The one tenant guard every Kehila route calls before touching data."""
from ..validation import APIError
from .ids import ID_RE

ROLES = ('listener', 'member', 'gabbai')


def require(repo, user_id, k, roles=ROLES):
    if not ID_RE.fullmatch(k):
        raise APIError(400, 'מזהה קהילה לא תקין.')
    membership = repo.get_membership(k, user_id)
    if not membership or not repo.get_kehila(k):
        raise APIError(404, 'הקהילה לא נמצאה.')
    if membership['role'] not in roles:
        raise APIError(403, 'אין הרשאה לפעולה זו.')
    return membership
