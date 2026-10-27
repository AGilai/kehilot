"""Routes: my phone number, the per-Kehila phone-list switch and the phone list (spec 4).

Nothing here logs a phone number, a name or the list."""
import time

from . import consents, inputs
from .authz import require
from .errors import ApiError
from .families import family_name
from .phones import normalize_phone

MEMBERS = ('member', 'gabbai')


def put_phone(ctx, params):
    d = inputs.body_object(ctx)
    raw = d.get('phone')
    if raw is None or raw == '':
        phone = None
    else:
        phone = normalize_phone(raw)
        if phone is None:
            raise ApiError(400, 'invalid_phone')
    ctx.repo.set_phone(ctx.user_id, phone)
    return 200, {'phone': phone}


def put_switch(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, MEMBERS)
    show = inputs.boolean(inputs.body_object(ctx), 'show')
    if show:
        profile = ctx.repo.get_profile(ctx.user_id)
        if not (profile or {}).get('phone'):
            raise ApiError(409, 'phone_required')
    version = consents.VERSIONS['phoneList']
    ctx.repo.set_phone_switch(k, ctx.user_id, show, version)
    ctx.repo.add_consent(ctx.user_id, 'phoneList', 'on' if show else 'off', version, k)
    return 200, {'show': show}


def phone_list(ctx, params):
    k = params['k']
    require(ctx.repo, ctx.user_id, k, MEMBERS)
    repo = ctx.repo
    on = {m['userId'] for m in repo.list_members(k) if m.get('role') in MEMBERS and m.get('showPhone')}
    families = []  # (family, live adult memberships) for families with at least one adult switched on
    for family in repo.list_families(k):
        if on.intersection(family['adults']):
            live = repo.live_adults(k, family)
            if any(m['userId'] in on for m in live):
                families.append((family, live))
    keys = [(f'U#{m["userId"]}', 'PROFILE') for _, live in families for m in live]
    profiles = repo.batch_get(keys) if keys else {}
    rows = []
    for family, live in families:
        people = []
        for m in live:
            profile = profiles.get((f'U#{m["userId"]}', 'PROFILE')) or {}
            if m['userId'] in on and profile.get('phone'):
                people.append({'userId': m['userId'], 'name': m.get('displayName', ''), 'phone': profile['phone']})
        if people:
            name = family_name([profiles.get((f'U#{m["userId"]}', 'PROFILE')) for m in live])
            rows.append({'familyId': family['familyId'], 'name': name, 'people': people})
    rows.sort(key=lambda r: (r['name'], r['familyId']))
    return 200, rows
