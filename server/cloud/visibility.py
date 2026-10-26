"""The only place that decides who may see or post what. Routes and the change feed call these."""


def can_read_channel(membership, channel):
    if not membership or not channel:
        return False
    return membership['role'] != 'listener' or bool(channel.get('listenersCanRead'))


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
