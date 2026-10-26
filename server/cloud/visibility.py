"""The only place that decides who may see or post what. Routes and the change feed call these."""


def _shares_group(membership, channel):
    return bool(set(membership.get('groups') or ()) & set(channel.get('groups') or ()))


def can_read_channel(membership, channel):
    """Gabbaim read every channel (to moderate). A channel with groups is read by whoever shares one of its
    groups, whatever their role (listeners included). Otherwise a listener needs `listenersCanRead`."""
    if not membership or not channel:
        return False
    role = membership['role']
    if role == 'gabbai':
        return True
    if channel.get('groups'):
        return _shares_group(membership, channel)
    return role != 'listener' or bool(channel.get('listenersCanRead'))


def in_audience(membership, channel):
    """Readable and addressed to this person: a gabbai outside a channel's groups reads it but is not in its
    audience (no push, not in "mine")."""
    return can_read_channel(membership, channel) and (not channel.get('groups') or _shares_group(membership, channel))


def is_gabbai(membership):
    return bool(membership) and membership['role'] == 'gabbai'


def is_group_admin(membership, group_id):
    """A gabbai is an implicit admin of every group; otherwise an appointed admin, who must be a member
    of the group (a stale adminGroups ID grants nothing)."""
    if not membership:
        return False
    return membership['role'] == 'gabbai' or (
        membership['role'] == 'member' and group_id in (membership.get('adminGroups') or ())
        and group_id in (membership.get('groups') or ()))


def is_channel_admin(membership, channel):
    """May this person administer the channel: a gabbai, or an admin of at least one of its groups."""
    if is_gabbai(membership):
        return True
    return bool(membership) and any(is_group_admin(membership, g) for g in channel.get('groups') or ())


def reply_target_ok(target_membership, channel):
    """May this person be the target of a blessing or reply in this channel? Family or gabbai who can read it."""
    return (bool(target_membership) and target_membership['role'] in ('member', 'gabbai')
            and can_read_channel(target_membership, channel))


def can_post(membership, channel):
    if not can_read_channel(membership, channel):
        return False
    role = membership['role']
    if role == 'gabbai':
        return True
    return (role == 'member' and channel.get('postPolicy') == 'broadcasters'
            and bool(membership.get('canBroadcast')))


def message_visible(membership, channel, message):
    return can_read_channel(membership, channel) and not message.get('removed')


def reply_visible(user_id, message, reply):
    """Private replies: only the reply's author and the message's target. Gabbaim get no exception."""
    if not user_id:
        return False
    return user_id == reply.get('authorId') or user_id == message.get('targetMemberId')


def change_visible(user_id, membership, channels_by_id, change):
    """May this user learn of this change item at all? The feed also applies the per-item checks."""
    visible_to = change.get('visibleTo')
    if visible_to is not None:
        return user_id in visible_to and can_read_channel(membership, channels_by_id.get(change.get('channelId')))
    return can_read_channel(membership, channels_by_id.get(change.get('channelId')))
