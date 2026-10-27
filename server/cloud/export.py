"""Download my data (spec §7): one ZIP with the person's own data. Nothing of other people except the partner's
name, the children, and the target name of the person's own blessings. Logs carry counts only."""
import json
import logging
import os
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone

from . import media, tags
from .posts import _split
from .repo_families import MEMBER_ROLES

log = logging.getLogger(__name__)
MIN_PHOTO_MS = 4000
CHUNK = 64 * 1024


def _family(repo, k, membership):
    if membership.get('role') not in MEMBER_ROLES:
        return None
    family = repo.family_of(k, membership['userId'])
    if not family:
        return None
    partner = next((m for m in repo.live_adults(k, family) if m['userId'] != membership['userId']), None)
    children = [{key: c[key] for key in ('firstName', 'gender', 'birthDate') if c.get(key)}
                for c in family.get('children', [])]
    return {'partnerName': (partner or {}).get('displayName') or None, 'children': children}


def _own_notify(notify):
    """The person's notification settings without other people's IDs: mutedMembers becomes a count."""
    notify = dict(notify or {})
    notify['mutedMembersCount'] = len(notify.pop('mutedMembers', None) or ())
    return notify


def _kehilot(repo, user_id):
    out = []
    for m in sorted(repo.list_memberships(user_id), key=lambda m: m['kehilaId']):
        k = m['kehilaId']
        kehila = repo.get_kehila(k) or {}
        names = tags.tag_map(repo, k) if m.get('tagIds') else {}
        out.append({'kehilaId': k, 'name': kehila.get('name', ''), 'role': m['role'],
                    'classification': m.get('classification', ''), 'groups': sorted(m.get('groups') or ()),
                    'tags': [t['name'] for t in tags.tags_of(m, names)],
                    'showPhone': bool(m.get('showPhone')), 'notify': _own_notify(m.get('notify')),
                    'family': _family(repo, k, {**m, 'userId': user_id})})
    return out


def _add_photo(client, bucket, archive, k, message_id, content_type):
    """Stream one image into the ZIP. Returns its name, or None when the object is gone."""
    from botocore.exceptions import ClientError
    name = f'photos/{k}/{message_id}.{media.EXTENSIONS.get(content_type, "jpg")}'
    try:
        body = client.get_object(Bucket=bucket, Key=media.image_key(k, message_id))['Body']
    except ClientError as error:
        if media._codes(error) & set(media.MISSING):
            return None
        raise media._try_again(error)
    with archive.open(name, 'w') as out:
        shutil.copyfileobj(body, out, CHUNK)
    return name


def build(repo, user_id, email, remaining_ms=None):
    """The ZIP as a temp file under /tmp (the caller deletes it). Photos are streamed; once less than
    MIN_PHOTO_MS is left, the remaining photos are skipped and counted in `photosOmitted`."""
    items = [(item, _split(item)) for item in repo.authored_items(user_id)]
    items = sorted(((i, s) for i, s in items if s), key=lambda p: (p[1][1], p[1][2], p[0]['sk']))
    client, bucket = media.s3_client(), media.bucket()
    fd, path = tempfile.mkstemp(prefix='kehilot-export-', suffix='.zip', dir='/tmp')
    try:
        messages, replies, photos, omitted = [], [], 0, 0
        with os.fdopen(fd, 'wb') as raw, zipfile.ZipFile(raw, 'w', zipfile.ZIP_DEFLATED) as archive:
            for item, (what, k, message_id) in items:
                if what == 'reply':
                    replies.append({'kehilaId': k, 'messageId': message_id, 'replyId': item['sk'][len('R#'):],
                                    'body': item.get('body', ''), 'createdAt': int(item.get('createdAt', 0))})
                    continue
                photo = None
                if item.get('image') and not item.get('removed'):
                    if remaining_ms and remaining_ms() < MIN_PHOTO_MS:
                        omitted += 1
                    else:
                        photo = _add_photo(client, bucket, archive, k, message_id, item['image'].get('contentType'))
                        photos += photo is not None
                entry = {'kehilaId': k, 'messageId': message_id, 'channelId': item.get('channelId'),
                         'type': item.get('type'), 'title': item.get('title', ''), 'body': item.get('body', ''),
                         'removed': bool(item.get('removed')), 'photo': photo}
                if item.get('targetName'):
                    entry['targetName'] = item['targetName']
                messages.append(entry)
            profile = repo.get_profile(user_id) or {}
            data = {'exportedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'userId': user_id,
                    'email': email,
                    'profile': {key: profile.get(key) for key in ('firstName', 'lastName', 'lang', 'phone')},
                    'kehilot': _kehilot(repo, user_id),
                    'consents': [{'kind': c['kind'], **({'kehilaId': c['kehilaId']} if c.get('kehilaId') else {}),
                                  'value': c['value'], 'version': c['version'], 'at': int(c['at'])}
                                 for c in sorted(repo.list_consents(user_id), key=lambda c: c['sk'])],
                    'reports': [{'reportId': r['sk'][len('RPT#'):], 'text': r.get('text', ''),
                                 'context': r.get('context') or {}, 'status': r.get('status', 'new'),
                                 'createdAt': int(r.get('createdAt', 0))}
                                for r in sorted(repo.list_user_reports(user_id), key=lambda r: r['sk'])],
                    'messages': messages, 'replies': replies, 'photosOmitted': omitted}
            archive.writestr('data.json', json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8'))
        log.info('export built user=%s messages=%d photos=%d omitted=%d bytes=%d', user_id, len(messages), photos,
                 omitted, os.path.getsize(path))
        return path
    except BaseException:
        if os.path.exists(path):
            os.remove(path)
        raise
