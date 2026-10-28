"""Who is reminded to fill the seat form: the men of each family that holds seats and has not answered; when the
family has no man (a widow, no tree, no recorded gender), its adults. A responses-file upload is not an answer."""
import logging
import re
from datetime import date

from . import push, seat_times, seating_rules, seating_week as wk

log = logging.getLogger(__name__)

KIND = 'seat_reminder'
_REF = re.compile(r'\d{4}-\d{2}-\d{2}#[12]', re.ASCII)
MARKER_TTL = 30 * 86400
_DAY = {'he': 'יום ו׳', 'en': 'Fri'}
_TITLE = {'1': {'he': '{kehila} · טופס מקומות לשבת', 'en': '{kehila} · Shabbat seats form'},
          '2': {'he': '{kehila}', 'en': '{kehila}'}}
_BODY = {
    '1': {'he': 'עוד לא עניתם על טופס המקומות לשבת. אפשר לענות עד {day} {time}.',
          'en': "You haven't answered the Shabbat seats form yet. You can answer until {day} {time}."},
    '2': {'he': 'תזכורת עדינה: טופס המקומות פתוח עד {time} היום. מקום שתפנו יכול לשמח מישהו אחר בשבת.',
          'en': "A gentle reminder: the seats form is open until {time} today. A seat you free could make someone else's Shabbat."},
}
_BODY_OTHER_DAY = {
    'he': 'תזכורת עדינה: טופס המקומות פתוח עד {day} {time}. מקום שתפנו יכול לשמח מישהו אחר בשבת.',
    'en': "A gentle reminder: the seats form is open until {day} {time}. A seat you free could make someone else's Shabbat.",
}


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


def parse_ref(ref):
    """(friday, n) of a job ref '<friday>#<n>', else None."""
    if not isinstance(ref, str) or not _REF.fullmatch(ref):
        return None
    friday, n = ref.split('#')
    try:
        date.fromisoformat(friday)
    except ValueError:
        return None
    return friday, n


def texts(n, lang, kehila_name, deadline_at, reminder_day):
    """(title, body) of reminder `n` in `lang`. Only the Kehila name and the deadline appear: no names, no counts.
    Reminder 2 says "until HH:MM today" when it goes out on the deadline's day (Friday), else names the day."""
    lang = lang if lang in _DAY else 'he'
    time_ = f'{deadline_at:%H:%M}'
    if n == '2' and reminder_day != 'fri':
        body = _BODY_OTHER_DAY[lang]
    else:
        body = _BODY[n][lang]
    when = f'{_DAY[lang]}\u00a0{time_}'  # day and time never break apart
    return _TITLE[n][lang].format(kehila=kehila_name), body.replace('{day} {time}', when).replace('{time}', time_)


def skip_reason(repo, kehila, ref, now):
    """Why the worker should drop this job, else None: 'bad_ref', 'no_kehila', 'no_layout', 'off', 'closed'."""
    parsed = parse_ref(ref)
    if not parsed:
        return 'bad_ref'
    friday, n = parsed
    meta = repo.get_kehila(kehila)
    if not meta:
        return 'no_kehila'
    if not repo.layout_for(kehila, friday):
        return 'no_layout'
    settings = meta.get('settings', {})
    if not seat_times.reminders_of(settings)[n]['on']:
        return 'off'
    if now >= wk.deadline_of(friday, seat_times.deadline_hm(settings)):
        return 'closed'
    return None


def run(repo, now, dry_run=False):
    """Queue the reminders that are due. Per Kehila, Friday and reminder number the conditional marker is claimed
    first and released if the queue refuses the job: a reminder goes out once, a queue failure retries next tick.
    `now` is an aware Asia/Jerusalem datetime."""
    friday = seating_rules.current_shabbat(now.date()).isoformat()
    out = {'kehilot': 0, 'due': [], 'sent': []}
    for k in repo.seat_kehila_ids():
        meta = repo.get_kehila(k)
        if not meta or not repo.layout_for(k, friday):
            continue
        out['kehilot'] += 1
        settings = meta.get('settings', {})
        due = seat_times.due(now, friday, seat_times.reminders_of(settings), seat_times.deadline_hm(settings))
        already = repo.seat_reminders_sent(k, friday) if due and not dry_run else set()
        for n in due:
            if dry_run:
                out['due'].append({'kehila': k, 'n': n, 'recipients': len(recipients(repo, k, friday))})
                continue
            if n in already or not repo.claim_seat_reminder(k, friday, n, int(now.timestamp()) + MARKER_TTL):
                continue
            try:
                push.send(KIND, k, f'{friday}#{n}')
            except Exception:
                repo.release_seat_reminder(k, friday, n)
                log.exception('seat_reminders send failed kehila=%s friday=%s n=%s', k, friday, n)
                continue
            out['sent'].append({'kehila': k, 'n': n})
    log.info('seat_reminders dry_run=%s kehilot=%d due=%d sent=%d', dry_run, out['kehilot'], len(out['due']),
             len(out['sent']))
    return out
