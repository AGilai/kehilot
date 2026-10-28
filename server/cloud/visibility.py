"""The only place that decides who may see or post what. Routes and the change feed call these."""
from . import authz, type_rules


def _shares_group(membership, channel):
    return bool(set(membership.get('groups') or ()) & set(channel.get('groups') or ()))


def can_read_channel(membership, channel):
    """Gabbaim read every channel (to moderate). A channel with groups is read by whoever shares one of its
    groups, whatever their role (listeners included). Otherwise a listener needs `listenersCanRead`."""
    if not membership or not channel:
        return False
    role = membership['role']
    if authz.in_set(role, authz.MANAGEMENT):
        return True
    if channel.get('groups'):
        return _shares_group(membership, channel)
    return not authz.in_set(role, authz.LISTENER_ONLY) or (bool(channel.get('listenersCanRead')) and not channel.get('conversation'))


def in_audience(membership, channel):
    """Readable and addressed to this person: a gabbai outside a channel's groups reads it but is not in its
    audience (no push, not in "mine")."""
    return can_read_channel(membership, channel) and (not channel.get('groups') or _shares_group(membership, channel))


def whole_kehila_channel(channel):
    """A channel for the whole Kehila: no groups and not a chat (legacy simchas / condolences channels count)."""
    return bool(channel) and not channel.get('groups') and not channel.get('conversation')


def is_management(membership):
    return authz.role_in(membership, authz.MANAGEMENT)


def is_group_admin(membership, group_id):
    """A gabbai is an implicit admin of every group; otherwise an appointed admin, who must be a member
    of the group (a stale adminGroups ID grants nothing)."""
    if not membership:
        return False
    return authz.role_in(membership, authz.MANAGEMENT) or (
        authz.role_in(membership, authz.MEMBER_ONLY) and group_id in (membership.get('adminGroups') or ())
        and group_id in (membership.get('groups') or ()))


def is_channel_admin(membership, channel):
    """May this person administer the channel: a gabbai, or an admin of at least one of its groups."""
    if is_management(membership):
        return True
    return bool(membership) and any(is_group_admin(membership, g) for g in channel.get('groups') or ())


def reply_target_ok(target_membership, channel):
    """May this person be the target of a blessing or reply in this channel? Family or gabbai who can read it."""
    return (authz.role_in(target_membership, authz.ADULTS)
            and can_read_channel(target_membership, channel))


def chat_hourly_limit(channel):
    return int(channel.get('chatHourlyLimit', 30))


def can_post(membership, channel, type_=None, rules=None):
    """May this person post in the channel? `type_=None` asks the channel-level question (chat, `canPost`);
    a type applies to non-conversation channels only. `rules` come from type_rules.rules (None = defaults)."""
    if not can_read_channel(membership, channel):
        return False
    role = membership['role']
    if channel.get('conversation'):  # chat: postPolicy, canBroadcast and types do not apply
        if authz.in_set(role, authz.LISTENER_ONLY) and not channel.get('groups'):
            return False  # only a listener admitted to the group posts
        return chat_hourly_limit(channel) > 0 or is_channel_admin(membership, channel)
    if type_ is not None and type_ not in type_rules.TYPES:
        return False
    if authz.in_set(role, authz.MANAGEMENT):
        return True
    if not (authz.in_set(role, authz.MEMBER_ONLY) and channel.get('postPolicy') == 'broadcasters' and bool(membership.get('canBroadcast'))):
        return False
    if type_ in ('weekly', 'event'):
        return False  # gabbaim only
    if type_ in type_rules.CONFIGURABLE:
        return (rules or type_rules.rules({}))[type_]['post'] == 'broadcasters'
    return True


def message_visible(membership, channel, message, rules=None):
    """Readable channel, not removed, and for a listener not a type the Kehila hides from guests. Evaluated at
    read time, so changing the setting applies to past messages. `rules=None` means defaults."""
    if not can_read_channel(membership, channel) or message.get('removed'):
        return False
    type_ = message.get('type')
    if authz.role_in(membership, authz.LISTENER_ONLY) and type_ in type_rules.CONFIGURABLE:
        return bool((rules or type_rules.rules({}))[type_]['listeners'])
    return True


def reply_visible(user_id, message, reply, family_adults=frozenset()):
    """Private replies: the writer always; then by `to`. 'author': the message's author. 'family' (or missing,
    legacy): the target family's current adults (`family_adults`, from families.target_adults). A userId: that
    user only, not the spouse. Gabbaim and tech get no exception."""
    if not user_id:
        return False
    if user_id == reply.get('authorId'):
        return True
    to = reply.get('to') or 'family'
    if to == 'author':
        return user_id == message.get('authorId')
    if to == 'family':
        return user_id in family_adults
    return user_id == to


def change_visible(user_id, membership, channels_by_id, change, family_adults=None):
    """May this user learn of this change item at all? The feed also applies the per-item checks. A `reply`
    change is visible to those in `visibleTo` or in `family_adults` (a partner linked after the reply). Callers
    pass `family_adults` only for a reply whose `to` is family: never for an author or personal reply."""
    readable = can_read_channel(membership, channels_by_id.get(change.get('channelId')))
    visible_to = change.get('visibleTo')
    if visible_to is None:
        return readable
    if change.get('kind') == 'reply' and user_id in (family_adults or ()):
        return readable
    return user_id in visible_to and readable
