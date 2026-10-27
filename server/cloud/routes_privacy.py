"""Routes: my phone number, the per-Kehila phone-list switch and the phone list (spec 4).

Nothing here logs a phone number, a name or the list."""
import time

from . import consents, inputs, tags
from .authz import ROLES, require
from .errors import ApiError
from .families import family_name
from .phones import normalize_phone

MEMBERS = ('member', 'gabbai')


def put_phone(ctx, params):
    d = inputs.body_object(ctx)
    if 'phone' not in d:  # only an explicit null or '' removes the number
        raise ApiError(400, 'invalid_phone')
    raw = d['phone']
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
    # the record first: a switch that took effect always has one
    ctx.repo.add_consent(ctx.user_id, 'phoneList', 'on' if show else 'off', version, k)
    ctx.repo.set_phone_switch(k, ctx.user_id, show, version)
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
    names = tags.tag_map(repo, k) if any(m.get('tagIds') for _, live in families for m in live) else {}
    rows = []
    for family, live in families:
        people = []
        for m in live:
            profile = profiles.get((f'U#{m["userId"]}', 'PROFILE')) or {}
            if m['userId'] in on and profile.get('phone'):
                people.append({'userId': m['userId'], 'name': m.get('displayName', ''), 'phone': profile['phone'],
                               'tags': tags.tags_of(m, names)})
        if people:
            name = family_name([profiles.get((f'U#{m["userId"]}', 'PROFILE')) for m in live])
            rows.append({'familyId': family['familyId'], 'name': name, 'people': people})
    rows.sort(key=lambda r: (r['name'], r['familyId']))
    return 200, rows


def age13(ctx, params):
    ctx.repo.add_consent(ctx.user_id, 'age13', 'accepted', consents.VERSIONS['age13'])
    return 204, None


def age13_required(repo, user_id):
    found = consents.latest(repo.list_consents(user_id), 'age13')
    return not found or found.get('version') != consents.VERSIONS['age13']


def dismiss_card(ctx, params):
    """One route for the one-time cards. `imported` is for any role; `gabbai_link`, `seat_link` and `phone` for M/G."""
    k, card = params['k'], params['card']
    require(ctx.repo, ctx.user_id, k, ROLES)
    if card not in ('gabbai_link', 'imported', 'phone', 'seat_link'):
        raise ApiError(400, 'invalid_card')
    if card == 'imported':
        ctx.repo.dismiss_import_notice(k, ctx.user_id)
        return 204, None
    require(ctx.repo, ctx.user_id, k, MEMBERS)
    if card == 'gabbai_link':
        ctx.repo.clear_family_notice(k, ctx.user_id)
    elif card == 'seat_link':
        ctx.repo.clear_seat_link_notice(k, ctx.user_id)
    else:  # "not now": no consent record
        ctx.repo.set_phone_asked(k, ctx.user_id, consents.VERSIONS['phoneList'])
    return 204, None
