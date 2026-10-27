"""Routes: health, my profile, one Kehila and its logo."""
import base64

from .authz import ROLES, require
from .errors import ApiError
from .routes_families import MEMBERS, notice_of, request_card
from .routes_invites import DEFAULT_MAX_LISTENERS


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
                 'profile': ctx.repo.get_profile(ctx.user_id), 'kehilot': kehilot}


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
        extra['listenerCount'] = ctx.repo.count_listeners(params['k'])
    cards = {'gabbaiLink': None, 'request': None}
    if membership['role'] in MEMBERS:
        cards = {'gabbaiLink': notice_of(ctx.repo, params['k'], membership),
                 'request': request_card(ctx.repo, params['k'], ctx.user_id, membership)}
    return 200, {'kehilaId': item['kehilaId'], 'name': item['name'], 'role': membership['role'],
                 'classification': membership.get('classification', ''),
                 'logoVersion': item.get('logoVersion'),
                 'canBroadcast': bool(membership.get('canBroadcast')), 'pendingRequest': pending, 'notify': notify,
                 'settings': shown, 'groups': sorted(membership.get('groups') or ()),
                 'adminGroups': sorted(set(membership.get('adminGroups') or ()) & set(membership.get('groups') or ())) if membership['role'] == 'member' else [],
                 'cards': cards, **extra}


def logo(ctx, params):
    require(ctx.repo, ctx.user_id, params['k'], ROLES)
    found = ctx.repo.get_logo(params['k'])
    if not found:
        raise ApiError(404, 'not_found')
    version, data = found
    return 200, {'logoVersion': version, 'contentType': 'image/png', 'data': base64.b64encode(data).decode('ascii')}
