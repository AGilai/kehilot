"""Who is reminded to fill the seat form: the men of each family that holds seats and has not answered; when the
family has no man (a widow, no tree, no recorded gender), its adults. A responses-file upload is not an answer."""
from . import seating_week as wk


def audience(family, live):
    gender = {p['userId']: p.get('gender') for p in family.get('people') or () if p.get('userId')}
    men = [m for m in live if gender.get(m['userId']) == 'm']
    return men or list(live)


def unanswered_families(repo, k, friday):
    layout = repo.layout_for(k, friday)
    if not layout:
        return []
    held = {ref[len('family:'):] for ref in repo.held_seats(k, layout).values() if ref.startswith('family:')}
    answered = set()
    for prayer in wk.PRAYERS:
        answered.update(f[len('family:'):] for f in ((repo.get_week(k, friday, prayer) or {}).get('answered') or {}))
    return sorted(held - answered)


def recipients(repo, k, friday):
    out = set()
    for family_id in unanswered_families(repo, k, friday):
        family = repo.get_family(k, family_id)
        if not family:
            continue
        for m in audience(family, repo.live_adults(k, family)):
            if (m.get('notify') or {}).get('seatReminders') is not False:
                out.add(m['userId'])
    return sorted(out)


def remindable(repo, k, family, user_id):
    if not family:
        return False
    return any(m['userId'] == user_id for m in audience(family, repo.live_adults(k, family)))
