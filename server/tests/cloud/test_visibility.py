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


def grouped(role, groups=(), readable=False, member_groups=()):
    membership = {'role': role, 'canBroadcast': False}
    if member_groups:
        membership['groups'] = set(member_groups)
    channel = {'listenersCanRead': readable, 'postPolicy': 'management'}
    if groups:
        channel['groups'] = set(groups)
    return membership, channel


class GroupTruthTable(unittest.TestCase):
    def test_group_truth_table(self):
        for role, in_group, has_groups, readable in itertools.product(
                ('listener', 'member', 'gabbai'), (True, False), (True, False), (True, False)):
            membership, channel = grouped(role, ('g1', 'g2') if has_groups else (), readable,
                                          ('g2', 'g9') if in_group else ('g9',))
            if role == 'gabbai':
                can_read = True
            elif has_groups:
                can_read = in_group  # group membership decides, whatever the role
            elif role == 'listener':
                can_read = readable
            else:
                can_read = True
            audience = can_read and (not has_groups or in_group)
            label = (role, in_group, has_groups, readable)
            self.assertEqual(visibility.can_read_channel(membership, channel), can_read, label)
            self.assertEqual(visibility.in_audience(membership, channel), audience, label)
            self.assertEqual(visibility.reply_target_ok(membership, channel),
                             role in ('member', 'gabbai') and can_read, label)
            self.assertEqual(visibility.can_post(membership, channel), role == 'gabbai', label)  # management policy

    def test_membership_without_groups_and_missing_inputs(self):
        membership, channel = grouped('member', ('g1',))
        self.assertFalse(visibility.can_read_channel(membership, channel))
        self.assertFalse(visibility.in_audience(None, channel))
        self.assertFalse(visibility.reply_target_ok(None, channel))
        self.assertFalse(visibility.reply_target_ok(membership, None))


class GroupAdminRules(unittest.TestCase):
    def test_is_group_admin(self):
        self.assertTrue(visibility.is_group_admin({'role': 'gabbai'}, 'g1'))
        self.assertTrue(visibility.is_group_admin({'role': 'member', 'adminGroups': {'g1'}, 'groups': {'g1'}}, 'g1'))
        self.assertFalse(visibility.is_group_admin({'role': 'member', 'adminGroups': {'g1'}}, 'g1'))  # stale ID
        self.assertFalse(visibility.is_group_admin({'role': 'member', 'adminGroups': {'g1'}, 'groups': {'g1'}}, 'g2'))
        self.assertFalse(visibility.is_group_admin({'role': 'member'}, 'g1'))
        self.assertFalse(visibility.is_group_admin({'role': 'listener', 'adminGroups': {'g1'}}, 'g1'))
        self.assertFalse(visibility.is_group_admin(None, 'g1'))

    def test_is_channel_admin(self):
        admin = {'role': 'member', 'adminGroups': {'g2'}, 'groups': {'g2'}}
        self.assertTrue(visibility.is_channel_admin({'role': 'gabbai'}, {'groups': {'g1'}}))
        self.assertTrue(visibility.is_channel_admin({'role': 'gabbai'}, {}))
        self.assertTrue(visibility.is_channel_admin(admin, {'groups': {'g1', 'g2'}}))
        self.assertFalse(visibility.is_channel_admin(admin, {'groups': {'g1'}}))
        self.assertFalse(visibility.is_channel_admin(admin, {}))
        self.assertFalse(visibility.is_channel_admin({'role': 'listener', 'adminGroups': {'g2'}}, {'groups': {'g2'}}))
