"""Request body parsing and field validation. Every failure is a 400 with an `invalid_<field>` code."""
import json
import re

from .errors import ApiError

MAX_BODY_BYTES = 16 * 1024


def _code(field):
    return 'invalid_' + re.sub(r'(?<!^)(?=[A-Z])', '_', field).lower()


def body_object(ctx):
    raw = ctx.body
    if raw is None or raw == '':
        raise ApiError(400, 'invalid_body')
    if len(raw.encode('utf-8')) > MAX_BODY_BYTES:
        raise ApiError(400, 'invalid_body')
    try:
        value = json.loads(raw)
    except ValueError:
        raise ApiError(400, 'invalid_json')
    if not isinstance(value, dict):
        raise ApiError(400, 'invalid_body')
    return value


def text(d, field, maximum, required=False):
    value = d.get(field, '')
    if not isinstance(value, str):
        raise ApiError(400, _code(field))
    value = value.strip()
    if len(value) > maximum or (required and not value):
        raise ApiError(400, _code(field))
    return value


def choice(d, field, options):
    value = d.get(field)
    if not isinstance(value, str) or value not in options:
        raise ApiError(400, _code(field))
    return value


def boolean(d, field):
    value = d.get(field)
    if not isinstance(value, bool):
        raise ApiError(400, _code(field))
    return value


def integer(d, field, lo, hi):
    value = d.get(field)
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise ApiError(400, _code(field))
    return value
