"""Seat form times: the opening, two reminders and the deadline of one Shabbat (opening < first < second < deadline).
Pure rules, mirrored by src/seats/times.ts. All times are Asia/Jerusalem wall-clock."""
from datetime import date, datetime, time as dtime, timedelta

from . import seating_week as wk
from .errors import ApiError

DAYS = ('thu', 'fri')
OPENS = {'day': 'thu', 'time': '08:00'}
DEFAULT_REMINDERS = {'1': {'on': True, 'day': 'thu', 'time': '20:00'}, '2': {'on': True, 'day': 'fri', 'time': '11:00'}}
MIN_GAP = 30
STEP = 15
_FIELDS = ('on', 'day', 'time')


def _valid_time(value):
    return isinstance(value, str) and bool(wk._HHMM.fullmatch(value)) and int(value[3:]) % STEP == 0


def deadline_hm(settings):
    value = (settings or {}).get('seatDeadline')
    return value if isinstance(value, str) and wk._HHMM.fullmatch(value) else wk.DEFAULT_DEADLINE


def reminders_of(settings):
    stored = (settings or {}).get('seatReminders')
    stored = stored if isinstance(stored, dict) else {}
    out = {}
    for n, default in DEFAULT_REMINDERS.items():
        got = stored.get(n) if isinstance(stored.get(n), dict) else {}
        out[n] = {
            'on': got['on'] if isinstance(got.get('on'), bool) else default['on'],
            'day': got['day'] if got.get('day') in DAYS else default['day'],
            'time': got['time'] if _valid_time(got.get('time')) else default['time'],
        }
    return out


def week_minute(day, hhmm):
    return (1440 if day == 'fri' else 0) + int(hhmm[:2]) * 60 + int(hhmm[3:])


def instant(friday, day, hhmm):
    d = date.fromisoformat(friday) - timedelta(days=1 if day == 'thu' else 0)
    return datetime.combine(d, dtime(int(hhmm[:2]), int(hhmm[3:])), wk.TZ)


def parse_reminders(value, current):
    if not isinstance(value, dict):
        raise ApiError(400, 'invalid_seat_reminders')
    out = {n: dict(r) for n, r in current.items()}
    for n, patch in value.items():
        if n not in DEFAULT_REMINDERS or not isinstance(patch, dict) or not set(patch) <= set(_FIELDS):
            raise ApiError(400, 'invalid_seat_reminders')
        if 'on' in patch and not isinstance(patch['on'], bool):
            raise ApiError(400, 'invalid_seat_reminders')
        if 'day' in patch and patch['day'] not in DAYS:
            raise ApiError(400, 'invalid_seat_reminders')
        if 'time' in patch and not _valid_time(patch['time']):
            raise ApiError(400, 'invalid_seat_reminders')
        out[n].update(patch)
    return out


def check(reminders, deadline, changed):
    """Walk opening, the reminders that are on, the deadline: each step at least MIN_GAP minutes after the last."""
    prev, prev_n = week_minute(OPENS['day'], OPENS['time']), None
    steps = [(n, week_minute(r['day'], r['time'])) for n, r in sorted(reminders.items()) if r['on']]
    steps.append((None, week_minute('fri', deadline)))
    for n, minute in steps:
        if minute - prev < MIN_GAP:
            if n is None and changed == 'deadline' and prev_n is not None:
                raise ApiError(400, 'seat_reminder_after_deadline', f'reminders.{prev_n}')
            raise ApiError(400, 'seat_times_order', changed)
        prev, prev_n = minute, n


def due(now, friday, reminders, deadline):
    end = instant(friday, 'fri', deadline)
    return [n for n, r in sorted(reminders.items())
            if r['on'] and instant(friday, r['day'], r['time']) <= now < end]
