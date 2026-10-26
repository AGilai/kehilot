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
