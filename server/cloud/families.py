"""Family rules: pure helpers, plus target_adults and reachable_adults, which read through the repo."""
import re
from datetime import date

from . import inputs, visibility
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
    child = {'firstName': inputs.text(d, 'firstName', 40, required=True),
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


def target_adults(repo, k, message):
    """Who the message's replies are for: the live adults of `targetFamilyId` when that family exists; else of
    the target member's current family (older messages, or a family merged away); else the target member
    alone. Empty for an untargeted message."""
    target = message.get('targetMemberId')
    if not target:
        return frozenset()
    family = repo.get_family(k, message['targetFamilyId']) if message.get('targetFamilyId') else None
    if not family:
        family = repo.family_of(k, target)
    if not family:
        return frozenset({target})
    return frozenset(m['userId'] for m in repo.live_adults(k, family))


def reachable_adults(repo, k, adults, channel):
    """Memberships of `adults` who may be the target of a reply in `channel`, sorted by userId."""
    found = repo.batch_get([(f'K#{k}', f'M#{u}') for u in adults])
    return sorted((m for m in found.values() if visibility.reply_target_ok(m, channel)),
                  key=lambda m: m['userId'])


class TargetMemo:
    """target_adults, remembered per (targetFamilyId, targetMemberId) for the length of one request."""

    def __init__(self, repo, k):
        self.repo, self.k, self._seen = repo, k, {}

    def adults(self, message):
        key = (message.get('targetFamilyId'), message.get('targetMemberId'))
        if key not in self._seen:
            self._seen[key] = target_adults(self.repo, self.k, message)
        return self._seen[key]


def ordered_reachable_adults(repo, k, message, channel):
    """Memberships of the target family's live adults who may receive a reply in `channel`, in the family's
    stored adult order. Resolved like target_adults (family, else the target member's family, else the member)."""
    target = message.get('targetMemberId')
    if not target:
        return []
    family = repo.get_family(k, message['targetFamilyId']) if message.get('targetFamilyId') else None
    if not family:
        family = repo.family_of(k, target)
    live = repo.live_adults(k, family) if family else [m for m in [repo.get_membership(k, target)] if m]
    return [m for m in live if visibility.reply_target_ok(m, channel)]
