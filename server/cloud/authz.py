"""The one tenant guard every Kehila route calls before touching data."""
from .errors import ApiError
from .ids import ID_RE

ROLES = ('listener', 'member', 'gabbai')


def require(repo, user_id, k, roles=ROLES):
    if not ID_RE.fullmatch(k):
        raise ApiError(400, 'invalid_kehila_id')
    membership = repo.get_membership(k, user_id)
    if not membership or not repo.get_kehila(k):
        raise ApiError(404, 'kehila_not_found')
    if membership['role'] not in roles:
        raise ApiError(403, 'forbidden')
    return membership
