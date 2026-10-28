"""Routes: the Kehila's prayer schedule (stored as given, validated strictly, never computed here)."""
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from . import inputs, schedule_rules as rules
from . import authz
from .errors import ApiError


def _today():
    return datetime.fromtimestamp(time.time(), ZoneInfo('Asia/Jerusalem')).date()


def _friday_of(day):
    return day - timedelta(days=(day.weekday() - 4) % 7)


def get_schedule(ctx, params):
    """Any member or listener. Overrides of the current schedule week (Friday to Thursday) and the next."""
    authz.require(ctx.repo, ctx.user_id, params['k'], authz.ALL)
    k = params['k']
    settings = (ctx.repo.get_kehila(k) or {}).get('settings') or {}
    saved = ctx.repo.get_schedule(k)
    friday = _friday_of(_today())
    weeks = ctx.repo.get_week_overrides(k, [friday.isoformat(), (friday + timedelta(days=7)).isoformat()],
                                        int(time.time()))
    return 200, {'version': 1, 'sections': saved['sections'] if saved else [], 'weekOverrides': weeks,
                 'sheet': rules.sheet_of(settings), 'location': rules.location_of(settings),
                 'updatedAt': saved['updatedAt'] if saved else None}


def put_schedule(ctx, params):
    """`{version?: 1, sections, ifUpdatedAt?: int|null}`: full replace. Crossing bounds are allowed (notLaterThan wins)
    and reported in `warnings`."""
    authz.require(ctx.repo, ctx.user_id, params['k'], authz.MANAGEMENT)
    d = inputs.body_object(ctx, rules.SCHEDULE_BODY_MAX)
    check = rules.Checker('invalid_schedule')
    check.obj(d, '', ('sections',), ('version', 'ifUpdatedAt'))
    if 'version' in d and (d['version'] != 1 or isinstance(d['version'], bool)):
        check.fail('version')
    guard = d.get('ifUpdatedAt')
    if 'ifUpdatedAt' in d and guard is not None and (isinstance(guard, bool) or not isinstance(guard, int)):
        check.fail('ifUpdatedAt')
    sections, warnings = rules.validate_sections(d['sections'])
    updated = ctx.repo.put_schedule(params['k'], sections, guard, 'ifUpdatedAt' in d)
    return 200, {'updatedAt': updated, 'warnings': warnings}


def _week(params):
    friday = rules.week_start(params['week'])
    if not friday:
        raise ApiError(400, 'invalid_week_start')
    return friday


def put_week(ctx, params):
    """One week's overrides (rows: time/hide, extra rows), replaced as a whole. Expire a week after the week ends."""
    authz.require(ctx.repo, ctx.user_id, params['k'], authz.MANAGEMENT)
    friday = _week(params)
    expires = rules.week_expiry(friday)
    now = int(time.time())
    if expires <= now or friday > _today() + timedelta(days=380):
        raise ApiError(400, 'invalid_week_start')
    overrides = rules.validate_week_overrides(inputs.body_object(ctx, rules.WEEK_BODY_MAX))
    ctx.repo.put_week_overrides(params['k'], friday.isoformat(), overrides, expires)
    return 200, {}


def delete_week(ctx, params):
    authz.require(ctx.repo, ctx.user_id, params['k'], authz.MANAGEMENT)
    ctx.repo.delete_week_overrides(params['k'], _week(params).isoformat())
    return 204, None
