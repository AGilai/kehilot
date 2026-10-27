"""Routes: in-app bug reports. Write-only: no route returns a report (the owner's tooling reads the table).
Nothing here logs text, context or ids."""
import hashlib
import ipaddress
import os
import time
from datetime import datetime, timezone

from . import inputs, media
from .errors import ApiError
from .ids import ID_RE, new_id

MAX_TEXT = 2000
MAX_FIELD = 64
CONTEXT_KEYS = ('appVersion', 'build', 'platform', 'os', 'screen', 'lang')
OPTIONAL_CONTEXT_KEYS = ('kehilaId',)
USER_DAILY_LIMIT = 10
UPLOAD_HOURLY_LIMIT = 10
ANON_HOURLY_LIMIT = 3  # per source IP
ANON_DAILY_LIMIT = 50  # all anonymous reports together


def _text(d):
    value = d.get('text')
    if not isinstance(value, str):
        raise ApiError(400, 'invalid_text')
    value = value.strip()
    if not 1 <= len(value) <= MAX_TEXT:  # code points
        raise ApiError(400, 'invalid_text')
    return value


def _context(d):
    value = d.get('context')
    if not isinstance(value, dict) or not set(CONTEXT_KEYS) <= set(value) <= set(CONTEXT_KEYS + OPTIONAL_CONTEXT_KEYS):
        raise ApiError(400, 'invalid_context')
    if any(not isinstance(v, str) or len(v) > MAX_FIELD or not v for v in value.values()):
        raise ApiError(400, 'invalid_context')  # required keys non-empty; kehilaId may be absent, never null or empty
    return dict(value)


def _now():
    return datetime.now(timezone.utc)


def _ip_hash(ctx):
    """Salted SHA-256 of the source IP: only ever a counter key, never stored or logged raw."""
    salt = os.environ.get('REPORT_IP_SALT')
    if not salt:
        raise RuntimeError('REPORT_IP_SALT is not set')
    return hashlib.sha256(f'{salt}:{_ip_key(ctx.source_ip)}'.encode('utf-8')).hexdigest()


def _ip_key(source_ip):
    """IPv4: the address; IPv6: its /64 prefix (one subscriber holds the whole /64); unparsable: one shared bucket."""
    try:
        address = ipaddress.ip_address(source_ip)
    except ValueError:
        return 'unknown'
    if address.version == 6:
        return str(ipaddress.ip_network(f'{address}/64', strict=False))
    return str(address)


def create_upload(ctx, params):
    d = inputs.body_object(ctx)
    content_type = d.get('contentType')
    if not isinstance(content_type, str) or content_type not in media.IMAGE_TYPES:
        raise ApiError(400, 'invalid_content_type')
    size = inputs.integer(d, 'bytes', 1, media.MAX_IMAGE_BYTES)
    ctx.repo.count_report(f'UPL#{ctx.user_id}#{_now():%Y%m%d%H}', UPLOAD_HOURLY_LIMIT)
    upload_id = new_id()
    url = media.presign_put(media.report_upload_key(ctx.user_id, upload_id), content_type, size)
    return 201, {'uploadId': upload_id, 'url': url, 'method': 'PUT', 'headers': {'Content-Type': content_type},
                 'expiresAt': int(time.time()) + media.URL_SECONDS}


def create(ctx, params):
    d = inputs.body_object(ctx)
    text, context = _text(d), _context(d)
    upload_id = d.get('imageUploadId')
    if 'imageUploadId' in d and (not isinstance(upload_id, str) or not ID_RE.fullmatch(upload_id)):
        raise ApiError(400, 'invalid_upload')
    report_id, image = new_id(), None
    if 'imageUploadId' in d:
        try:
            image = media.claim_report_upload(ctx.user_id, upload_id, report_id)
        except ApiError as error:
            if error.status == 400:  # missing, someone else's, wrong type or size: one answer
                raise ApiError(400, 'invalid_upload')
            raise
    try:  # after the upload checks: a bad upload costs no quota
        ctx.repo.count_report(f'USR#{ctx.user_id}#{_now():%Y%m%d}', USER_DAILY_LIMIT)
    except ApiError:
        if image:
            try:
                media.delete_key(image['key'])  # over the limit: do not leave the claimed picture behind
            except ApiError:
                pass
        raise
    ctx.repo.put_report(report_id, text, context, ctx.user_id, image)
    return 201, {'reportId': report_id}


def create_anonymous(ctx, params):
    """Public route: ignores any token or claims. Text only; per-IP hourly and global daily caps."""
    d = inputs.body_object(ctx)
    text, context = _text(d), _context(d)
    now = _now()
    ctx.repo.count_report(f'IP#{_ip_hash(ctx)}#{now:%Y%m%d%H}', ANON_HOURLY_LIMIT)
    ctx.repo.count_report(f'ANON#{now:%Y%m%d}', ANON_DAILY_LIMIT)
    report_id = new_id()
    ctx.repo.put_report(report_id, text, context)
    return 201, {'reportId': report_id}
