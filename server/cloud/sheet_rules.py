"""Pure rules for the weekly sheet: which week an item belongs to, its group, first state and order key."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from . import authz
from .ids import new_id

JERUSALEM = ZoneInfo('Asia/Jerusalem')
GROUP_OF = {'celebration': 'mazal', 'condolence': 'condolence', 'event': 'events', 'notice': 'events'}
SHEET_TYPES = ('celebration', 'condolence', 'event')
SHEET_MEMBERS = ('approve', 'auto')
FRIDAY = 4  # date.weekday()


def week_for_post(now, type_, fields):
    """The Friday (a date) of the sheet week a post belongs to. A templated event goes to the Friday-to-Thursday week
    its fields.date falls in; everything else by posting time: Sunday to Friday 11:59 Israel time is the coming
    Friday, Friday from 12:00 and Saturday the Friday after."""
    if type_ == 'event' and fields and fields.get('date'):
        day = date.fromisoformat(fields['date'])
        return day - timedelta(days=(day.weekday() - FRIDAY) % 7)
    local = now.astimezone(JERUSALEM)
    day = local.date()
    if day.weekday() == FRIDAY:
        return day if local.hour < 12 else day + timedelta(days=7)
    return day + timedelta(days=(FRIDAY - day.weekday()) % 7)


def sheet_members(settings):
    value = (settings or {}).get('sheetMembers')
    return value if value in SHEET_MEMBERS else 'approve'


def initial_state(role, setting):
    """(state, source) of a new item. Gabbaim and members under 'auto' go straight in."""
    if authz.in_set(role, authz.MANAGEMENT) or setting == 'auto':
        return 'in', 'auto'
    return 'pending', 'member'


def default_order(type_, message_id, fields):
    if type_ == 'event' and fields and fields.get('date'):
        return '1' + fields['date'] + fields.get('time', '') + message_id
    return '1' + message_id


def appended_order():
    return '2' + new_id()


def pending_expired(friday, now):
    """True from Sunday 00:00 Israel time after that week's Shabbat."""
    end = datetime.combine(friday + timedelta(days=2), time(0, 0), tzinfo=JERUSALEM)
    return now >= end
