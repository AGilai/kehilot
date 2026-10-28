"""The one tenant guard every Kehila route calls before touching data, and the named role sets.

Every authorization decision on the server picks one named set from here (docs/UX-DESIGN.md §20). No other module
spells a role or compares one by hand (server/tests/cloud/test_authz_sets.py). Modules use the sets as `authz.<NAME>`
attributes, read at call time, so a test can patch a set.
"""
from .errors import ApiError
from .ids import ID_RE

LISTENER, MEMBER, GABBAI, TECH = 'listener', 'member', 'gabbai', 'tech'

# Owner decision 2026-10-28: a tech has every right of a gabbai (and can grant the gabbai role). The only
# differences are the label and attribution: a tech is shown as "טכני", never as "גבאי" (docs/UX-DESIGN.md §20).
ALL = (LISTENER, MEMBER, GABBAI, TECH)
NON_LISTENERS = (MEMBER, GABBAI, TECH)
ADULTS = NON_LISTENERS                 # an adult with a family (a gabbai and a tech are members too)
MANAGEMENT = (GABBAI, TECH)            # "צוות הניהול": everything a gabbai may do
LISTENER_ONLY = (LISTENER,)
MEMBER_ONLY = (MEMBER,)

ROLE_SETS = {'ALL': ALL, 'NON_LISTENERS': NON_LISTENERS, 'ADULTS': ADULTS, 'MANAGEMENT': MANAGEMENT,
             'LISTENER_ONLY': LISTENER_ONLY, 'MEMBER_ONLY': MEMBER_ONLY}


def _named(roles):
    # The module attribute is read at call time too, so a test may patch a set (`mock.patch.object(authz, ...)`).
    return any(roles is s or roles is globals()[n] for n, s in ROLE_SETS.items())


def require(repo, user_id, k, roles):
    assert _named(roles), 'require needs a named role set from authz.ROLE_SETS'
    if not ID_RE.fullmatch(k):
        raise ApiError(400, 'invalid_kehila_id')
    membership = repo.get_membership(k, user_id)
    if not membership or not repo.get_kehila(k):
        raise ApiError(404, 'kehila_not_found')
    if membership['role'] not in roles:
        raise ApiError(403, 'forbidden')
    return membership


def in_set(role, roles):
    return role is not None and role in roles


def role_in(membership, roles):
    return bool(membership) and in_set(membership.get('role'), roles)


def role_condition(roles, attr='#r'):
    """A DynamoDB condition `<attr> IN (:r0, …)` and its values, for a role set."""
    values = {f':r{i}': r for i, r in enumerate(roles)}
    return f'{attr} IN ({", ".join(values)})', values
