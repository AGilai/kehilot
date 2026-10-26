import itertools
import unittest

from server.cloud import visibility


def m(role, can_broadcast=False):
    return {'role': role, 'canBroadcast': can_broadcast}


def ch(listeners_can_read, policy):
    return {'listenersCanRead': listeners_can_read, 'postPolicy': policy}


class VisibilityTruthTable(unittest.TestCase):
    def test_truth_table(self):
        for role, readable, policy, broadcast in itertools.product(
                ('listener', 'member', 'gabbai'), (True, False), ('management', 'broadcasters'), (True, False)):
            membership, channel = m(role, broadcast), ch(readable, policy)
            can_read = role != 'listener' or readable
            can_post = role == 'gabbai' or (role == 'member' and policy == 'broadcasters' and broadcast)
            label = (role, readable, policy, broadcast)
            self.assertEqual(visibility.can_read_channel(membership, channel), can_read, label)
            self.assertEqual(visibility.can_post(membership, channel), can_post, label)
            self.assertEqual(visibility.message_visible(membership, channel, {'removed': False}), can_read, label)
            self.assertFalse(visibility.message_visible(membership, channel, {'removed': True}), label)
            self.assertEqual(visibility.message_visible(membership, channel, {}), can_read, label)

    def test_missing_channel_or_membership_is_not_visible(self):
        self.assertFalse(visibility.can_read_channel(m('gabbai'), None))
        self.assertFalse(visibility.can_post(m('gabbai'), None))
        self.assertFalse(visibility.message_visible(m('gabbai'), None, {}))
