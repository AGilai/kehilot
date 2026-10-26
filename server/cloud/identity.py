"""Who is calling: JWT claims from the API Gateway authorizer, mapped to our own stable userId."""
from dataclasses import dataclass

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
    return repo.get_user_id(caller.sub) or repo.create_user_id(caller.sub, new_id())
