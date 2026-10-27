import unittest

from server.cloud import type_rules, visibility

DEFAULT = {'celebration': {'post': 'broadcasters', 'listeners': False},
           'condolence': {'post': 'broadcasters', 'listeners': False}}


def m(role, can_broadcast=False):
    return {'role': role, 'canBroadcast': can_broadcast}


def ch(policy='broadcasters', readable=True, **extra):
    return {'listenersCanRead': readable, 'postPolicy': policy, **extra}


class RulesTest(unittest.TestCase):
    def test_defaults_for_missing(self):
        for settings in ({}, {'typeRules': {}}, {'typeRules': None}, None):
            self.assertEqual(type_rules.rules(settings), DEFAULT, settings)

    def test_malformed_is_default_never_allow(self):
        for bad in ('x', 5, [], True, {'celebration': 'open'}, {'celebration': ['management']},
                    {'celebration': {'post': 'everyone', 'listeners': 'yes'}},
                    {'celebration': {'post': 7, 'listeners': 1}},
                    {'celebration': {'post': None, 'listeners': None}}):
            self.assertEqual(type_rules.rules({'typeRules': bad}), DEFAULT, bad)

    def test_part_malformed_keeps_the_good_part(self):
        got = type_rules.rules({'typeRules': {'celebration': {'post': 'management', 'listeners': 'yes'}}})
        self.assertEqual(got['celebration'], {'post': 'management', 'listeners': False})

    def test_configured_and_unknown_keys_ignored(self):
        got = type_rules.rules({'typeRules': {
            'celebration': {'post': 'management', 'listeners': True, 'extra': 1},
            'condolence': {'post': 'broadcasters', 'listeners': True},
            'weekly': {'post': 'broadcasters', 'listeners': False}, 'junk': {}}})
        self.assertEqual(got, {'celebration': {'post': 'management', 'listeners': True},
                               'condolence': {'post': 'broadcasters', 'listeners': True}})

    def test_input_not_mutated_and_result_independent(self):
        got = type_rules.rules({})
        got['celebration']['listeners'] = True
        self.assertEqual(type_rules.rules({}), DEFAULT)


class PostableTypesTest(unittest.TestCase):
    ALL = ['weekly', 'event', 'general', 'celebration', 'condolence']

    def test_gabbai_all_five(self):
        self.assertEqual(type_rules.postable_types(m('gabbai'), ch(), type_rules.rules({})), self.ALL)
        self.assertEqual(type_rules.postable_types(m('gabbai'), ch('management'), type_rules.rules({})), self.ALL)

    def test_member_with_broadcast_on_broadcasters_channel(self):
        rules = type_rules.rules({})
        self.assertEqual(type_rules.postable_types(m('member', True), ch(), rules),
                         ['general', 'celebration', 'condolence'])
        rules = type_rules.rules({'typeRules': {'celebration': {'post': 'management', 'listeners': False}}})
        self.assertEqual(type_rules.postable_types(m('member', True), ch(), rules), ['general', 'condolence'])
        rules = type_rules.rules({'typeRules': {'celebration': {'post': 'management', 'listeners': False},
                                                'condolence': {'post': 'management', 'listeners': False}}})
        self.assertEqual(type_rules.postable_types(m('member', True), ch(), rules), ['general'])

    def test_nobody_else(self):
        rules = type_rules.rules({})
        self.assertEqual(type_rules.postable_types(m('member', False), ch(), rules), [])
        self.assertEqual(type_rules.postable_types(m('listener', True), ch(), rules), [])
        self.assertEqual(type_rules.postable_types(m('member', True), ch('management'), rules), [])

    def test_conversation_channel_has_no_types(self):
        rules = type_rules.rules({})
        for role in ('gabbai', 'member'):
            self.assertEqual(type_rules.postable_types(m(role, True), ch(conversation=True), rules), [], role)

    def test_unreadable_channel_or_missing_membership(self):
        rules = type_rules.rules({})
        self.assertEqual(type_rules.postable_types(m('member', True), ch(groups={'g1'}), rules), [])
        self.assertEqual(type_rules.postable_types(None, ch(), rules), [])
        self.assertEqual(type_rules.postable_types(m('gabbai'), None, rules), [])


class CanPostTypeTest(unittest.TestCase):
    def test_type_none_is_the_channel_level_meaning(self):
        self.assertTrue(visibility.can_post(m('member', True), ch()))
        self.assertFalse(visibility.can_post(m('member', False), ch()))

    def test_member_rule_management_blocks_celebration_not_general(self):
        rules = type_rules.rules({'typeRules': {'celebration': {'post': 'management', 'listeners': False}}})
        self.assertFalse(visibility.can_post(m('member', True), ch(), 'celebration', rules))
        self.assertTrue(visibility.can_post(m('member', True), ch(), 'general', rules))
        self.assertTrue(visibility.can_post(m('member', True), ch(), 'condolence', rules))
        self.assertTrue(visibility.can_post(m('gabbai'), ch(), 'celebration', rules))

    def test_members_never_post_weekly_or_event(self):
        for t in ('weekly', 'event'):
            self.assertFalse(visibility.can_post(m('member', True), ch(), t), t)
            self.assertTrue(visibility.can_post(m('gabbai'), ch(), t), t)

    def test_unknown_type_refused_and_none_rules_mean_defaults(self):
        self.assertFalse(visibility.can_post(m('gabbai'), ch(), 'nope'))
        self.assertTrue(visibility.can_post(m('member', True), ch(), 'celebration', None))

    def test_chat_ignores_types(self):
        chat = ch('management', conversation=True)
        self.assertTrue(visibility.can_post(m('member'), chat, None, None))


class MessageVisibleTypesTest(unittest.TestCase):
    def msg(self, t):
        return {'type': t, 'removed': False}

    def test_listener_default_hides_the_two(self):
        rules = type_rules.rules({})
        for t, expected in (('celebration', False), ('condolence', False), ('weekly', True), ('event', True),
                            ('general', True), ('chat', True)):
            self.assertEqual(visibility.message_visible(m('listener'), ch(), self.msg(t), rules), expected, t)
            self.assertEqual(visibility.message_visible(m('listener'), ch(), self.msg(t)), expected, t)  # None = defaults

    def test_listeners_true_shows_per_type(self):
        rules = type_rules.rules({'typeRules': {'celebration': {'post': 'broadcasters', 'listeners': True}}})
        self.assertTrue(visibility.message_visible(m('listener'), ch(), self.msg('celebration'), rules))
        self.assertFalse(visibility.message_visible(m('listener'), ch(), self.msg('condolence'), rules))

    def test_members_and_gabbaim_always(self):
        rules = type_rules.rules({})
        for role in ('member', 'gabbai'):
            for t in ('celebration', 'condolence'):
                self.assertTrue(visibility.message_visible(m(role), ch(), self.msg(t), rules), (role, t))

    def test_removed_stays_hidden_and_listener_in_group_is_still_a_listener(self):
        rules = type_rules.rules({'typeRules': {'celebration': {'post': 'broadcasters', 'listeners': True}}})
        self.assertFalse(visibility.message_visible(m('gabbai'), ch(), {'type': 'celebration', 'removed': True}, rules))
        grouped = {**m('listener'), 'groups': {'g1'}}
        self.assertFalse(visibility.message_visible(grouped, ch(groups={'g1'}), self.msg('condolence'), rules))
