"""Routes: health, my profile, one Kehila and its logo."""
import base64

from .authz import ROLES, require
from .errors import ApiError
from .routes_families import MEMBERS, notice_of, request_card
from . import consents, schedule_rules, tags, type_rules
from .routes_invites import DEFAULT_MAX_LISTENERS
from .routes_privacy import age13_required


def health(ctx, params):
    return 200, {'ok': True}


def me(ctx, params):
    kehilot = []
    for membership in ctx.repo.list_memberships(ctx.user_id):
        kehila = ctx.repo.get_kehila(membership['kehilaId'])
        if kehila:
            kehilot.append({'kehilaId': kehila['kehilaId'], 'name': kehila['name'], 'role': membership['role'],
                            'logoVersion': kehila.get('logoVersion')})
    return 200, {'userId': ctx.user_id, 'email': ctx.caller.email,
                 'profile': ctx.repo.get_profile(ctx.user_id), 'kehilot': kehilot,
                 'age13Required': age13_required(ctx.repo, ctx.user_id)}


def kehila(ctx, params):
    membership = require(ctx.repo, ctx.user_id, params['k'], ROLES)
    item = ctx.repo.get_kehila(params['k'])
    settings = item.get('settings', {})
    notify = {'mutedChannels': [], 'mutedTypes': [], 'membersBroadcasts': 'all', 'mutedMembers': [], 'chatChannels': [],
              **membership.get('notify', {})}
    pending = bool(ctx.repo.get_request(params['k'], ctx.user_id))
    shown = {'pollSeconds': int(settings.get('pollSeconds', 30))}
    extra = {}
    if membership['role'] == 'gabbai':
        shown['maxListeners'] = int(settings.get('maxListeners', DEFAULT_MAX_LISTENERS))
        extra['typeRules'] = type_rules.rules(settings)  # members get postableTypes per channel instead
        extra['location'] = schedule_rules.location_of(settings)
        extra['sheet'] = schedule_rules.sheet_of(settings)
        extra['listenerCount'] = ctx.repo.count_listeners(params['k'])
    is_member = membership['role'] in MEMBERS
    cards = {'gabbaiLink': None, 'request': None, 'imported': bool(membership.get('importNotice')),
             'phoneAsk': is_member and membership.get('phoneAsked') != consents.VERSIONS['phoneList'],
             'terms': False}
    if is_member:
        cards['gabbaiLink'] = notice_of(ctx.repo, params['k'], membership)
        cards['request'] = request_card(ctx.repo, params['k'], ctx.user_id, membership)
    if membership['role'] == 'gabbai':
        accepted = item.get('termsAccepted')
        current = bool(accepted) and accepted.get('version') == consents.VERSIONS['kehilaTerms']
        cards['terms'] = not current
        who = ctx.repo.get_membership(params['k'], accepted['userId']) if accepted else None
        extra['termsAccepted'] = {'name': (who or {}).get('displayName', ''), 'at': int(accepted['at'])} \
            if accepted else None
    return 200, {'kehilaId': item['kehilaId'], 'name': item['name'], 'role': membership['role'],
                 'classification': membership.get('classification', ''),
                 'logoVersion': item.get('logoVersion'),
                 'canBroadcast': bool(membership.get('canBroadcast')), 'pendingRequest': pending, 'notify': notify,
                 'settings': shown, 'groups': sorted(membership.get('groups') or ()),
                 'adminGroups': sorted(set(membership.get('adminGroups') or ()) & set(membership.get('groups') or ())) if membership['role'] == 'member' else [],
                 'showPhone': bool(membership.get('showPhone')), 'cards': cards,
                 'privacyContact': settings.get('privacyContact', ''),
                 'tags': tags.with_tags(ctx.repo, params['k'], [{}], [membership])[0]['tags'], **extra}


def logo(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], ROLES)
    found = ctx.repo.get_logo(params['k'])
    if not found:
        raise ApiError(404, 'not_found')
    version, data = found
    return 200, {'logoVersion': version, 'contentType': 'image/png', 'data': base64.b64encode(data).decode('ascii')}
