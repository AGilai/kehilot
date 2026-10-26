"""Who is calling: JWT claims from the API Gateway authorizer, mapped to our own stable userId."""
from dataclasses import dataclass

from .errors import ApiError
from .ids import new_id


@dataclass(frozen=True)
class Caller:
    sub: str
    email: str
    groups: tuple = ()


def caller_from_event(event):
    claims = event['requestContext']['authorizer']['jwt']['claims']
    groups = claims.get('cognito:groups') or ()
    if isinstance(groups, str):
        groups = groups.strip('[]').split()
    return Caller(sub=claims['sub'], email=claims.get('email', ''), groups=tuple(groups))


def resolve_user_id(repo, caller):
    item = repo.get_sub(caller.sub)
    if item and item.get('deleted'):  # tombstone left by DELETE /v1/me: never recreate the account
        raise ApiError(401, 'account_deleted')
    return item['userId'] if item else repo.create_user_id(caller.sub, new_id())
