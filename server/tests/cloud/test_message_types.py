import time
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import push, push_worker, routes_changes, routes_messages
from server.tests.cloud import test_messages
from server.tests.cloud.helpers import set_type_rules

CEL = {'post': 'broadcasters', 'listeners': True}


@mock_aws
class MessageTypesTest(test_messages.MessagesTest):
    """Per-type post and read rules on every path. Posts go to `announcements` (listeners read it, members with broadcast post)."""

    def rules(self, **rules):
        set_type_rules(self.repo, self.k, rules)

    def set_posting(self, celebration=None, condolence=None):
        self.rules(**{n: {'post': v, 'listeners': False} for n, v in
                      (('celebration', celebration), ('condolence', condolence)) if v})

    def setUp(self):
        super().setUp()
        self.repo.put_channel(self.k, 'main', True, 'broadcasters')  # what Task 2 seeds: listeners read, members post
        self.channels = {c['name']: c['sk'][2:] for c in self.repo.list_channels(self.k)}
        self.clock_offset = 0
        patcher = mock.patch.object(routes_changes, '_now_ms',
                                    side_effect=lambda: int((time.time() + self.clock_offset) * 1000))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.start = self.call('GET', f'{self.base()}/changes', sub='gabbai-sub')[1]['cursor']
        self.clock_offset = 10  # past the hold-back, so fresh changes are served

    def feed(self, sub, since=None):
        return self.call('GET', f'{self.base()}/changes', sub=sub, query={'since': since or self.start})[1]

    def ids(self, sub):
        return [x['messageId'] for x in self.call('GET', f'{self.base()}/messages', sub=sub)[1]]

    # ---- posting
    def test_general_is_a_valid_type_for_member_with_broadcast(self):
        status, body = self.post('main', sub='member-sub', type='general')
        self.assertEqual((status, body['type']), (201, 'general'))
        self.assertEqual(self.post('main', sub='quiet-sub', type='general'), (403, {'error': 'forbidden'}))

    def test_default_member_may_post_the_two_types(self):
        for t in ('celebration', 'condolence'):
            self.assertEqual(self.post('main', sub='member-sub', type=t)[0], 201, t)

    def test_member_cannot_post_gabbai_only_types(self):
        for t in ('weekly', 'event'):
            self.assertEqual(self.post('main', sub='member-sub', type=t), (403, {'error': 'forbidden'}), t)

    def test_rule_management_blocks_member_celebration_but_not_general(self):
        self.set_posting(celebration='management')
        self.assertEqual(self.post('main', sub='member-sub', type='celebration'),
                         (403, {'error': 'forbidden'}))
        self.assertEqual(self.post('main', sub='member-sub', type='general')[0], 201)
        self.assertEqual(self.post('main', sub='member-sub', type='condolence')[0], 201)
        self.assertEqual(self.post('main', type='celebration')[0], 201)  # gabbai

    def test_daily_limit_still_applies_to_general(self):
        self.set_posting(celebration='management')
        for _ in range(3):
            self.assertEqual(self.post('main', sub='member-sub', type='general')[0], 201)
        self.assertEqual(self.post('main', sub='member-sub', type='general'),
                         (429, {'error': 'broadcast_limit'}))

    def test_forbidden_type_does_not_use_the_daily_limit(self):
        self.set_posting(celebration='management')
        for _ in range(5):
            self.assertEqual(self.post('main', sub='member-sub', type='celebration')[0], 403)
        self.assertEqual(self.post('main', sub='member-sub', type='general')[0], 201)

    def test_garbage_rule_is_default_for_posting_and_seeing(self):
        self.rules(celebration='open', condolence={'post': 5, 'listeners': 'yes'})
        self.assertEqual(self.post('main', sub='member-sub', type='celebration')[0], 201)
        mid = self.post('main', type='condolence')[1]['messageId']
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub='listener-sub')[0], 404)

    def test_channel_list_can_post_unchanged(self):
        chans = {c['name']: c for c in self.call('GET', f'{self.base()}/channels', sub='member-sub')[1]}
        self.assertTrue(chans['simchas']['canPost'])
        self.assertTrue(chans['main']['canPost'])
        self.assertFalse(chans['announcements']['canPost'])  # management channel

    # ---- seeing
    def test_listener_get_message_404_for_hidden_types(self):
        hidden = self.post('main', type='celebration')[1]['messageId']
        shown = self.post('main', type='weekly')[1]['messageId']
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{hidden}', sub='listener-sub'),
                         (404, {'error': 'message_not_found'}))
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{shown}', sub='listener-sub')[0], 200)
        for sub in ('member-sub', 'gabbai-sub'):
            self.assertEqual(self.call('GET', f'{self.base()}/messages/{hidden}', sub=sub)[0], 200, sub)

    def test_listener_list_omits_hidden_types(self):
        hidden = self.post('main', type='condolence')[1]['messageId']
        shown = self.post('main', type='general')[1]['messageId']
        self.assertEqual(self.ids('listener-sub'), [shown])
        self.assertEqual(set(self.ids('member-sub')), {hidden, shown})

    def test_flip_listeners_on_then_off_applies_to_past_messages(self):
        mid = self.post('main', type='celebration')[1]['messageId']
        url = f'{self.base()}/messages/{mid}'
        self.assertEqual(self.call('GET', url, sub='listener-sub')[0], 404)
        self.rules(celebration=CEL)
        self.assertEqual(self.call('GET', url, sub='listener-sub')[0], 200)
        self.assertEqual(self.ids('listener-sub'), [mid])
        self.rules(celebration={**CEL, 'listeners': False})
        self.assertEqual(self.call('GET', url, sub='listener-sub')[0], 404)
        self.assertEqual(self.ids('listener-sub'), [])

    def test_listener_cannot_read_or_list_replies_of_hidden_message(self):
        mid = self.post('main', type='celebration')[1]['messageId']
        for verb, path in (('POST', 'read'), ('GET', 'replies')):
            self.assertEqual(self.call(verb, f'{self.base()}/messages/{mid}/{path}', sub='listener-sub')[0],
                             404, path)

    def test_feed_omits_hidden_type_for_listener_on_every_kind(self):
        mid = self.post('main', type='celebration', targetMemberId=self.quiet)[1]['messageId']
        self.call('POST', f'{self.base()}/messages/{mid}/join', sub='member-sub')
        self.call('POST', f'{self.base()}/messages/{mid}/read', sub='member-sub')
        self.call('POST', f'{self.base()}/messages/{mid}/replies', sub='member-sub', body={'body': 'Mazal tov'})
        shown = self.post('main', type='weekly')[1]['messageId']
        kinds = lambda sub: {(c['kind'], c['id']) for c in self.feed(sub)['changes']}
        self.assertEqual(kinds('listener-sub'), {('message', shown)})
        self.assertIn(('message', mid), kinds('member-sub'))
        self.assertIn(('join', mid), kinds('member-sub'))
        self.assertIn(('reply_count', mid), kinds('member-sub'))
        self.assertIn(('message', mid), kinds('gabbai-sub'))

    def test_feed_follows_the_current_setting(self):
        mid = self.post('main', type='condolence')[1]['messageId']
        self.assertEqual(self.feed('listener-sub')['changes'], [])
        self.rules(condolence={'post': 'broadcasters', 'listeners': True})
        self.assertEqual([c['id'] for c in self.feed('listener-sub')['changes']], [mid])

    def test_feed_loads_the_kehila_once_per_request(self):
        for _ in range(3):
            self.post('main', type='celebration')
        with mock.patch.object(self.repo, 'get_kehila', wraps=self.repo.get_kehila) as get:
            self.assertEqual(self.feed('listener-sub')['changes'], [])
        self.assertEqual(get.call_count, 2)  # authz.require, then the rules: not one per item

    # ---- push
    def recipients(self, mid):
        return push_worker.recipients(self.repo, 'message', self.k, mid)

    def test_push_skips_listener_for_hidden_type(self):
        mid = self.post('main', type='celebration')[1]['messageId']
        got = set(self.recipients(mid))
        self.assertNotIn(self.listener, got)
        self.assertIn(self.member, got)
        weekly = self.post('main', type='weekly')[1]['messageId']
        self.assertIn(self.listener, self.recipients(weekly))

    def test_push_follows_listeners_setting(self):
        self.rules(condolence={'post': 'broadcasters', 'listeners': True})
        mid = self.post('main', type='condolence')[1]['messageId']
        self.assertIn(self.listener, self.recipients(mid))

    def test_push_loads_the_kehila_once_per_message(self):
        mid = self.post('main', type='celebration')[1]['messageId']
        with mock.patch.object(self.repo, 'get_kehila', wraps=self.repo.get_kehila) as get:
            self.recipients(mid)
        self.assertEqual(get.call_count, 1)

    def test_push_text_for_general_is_the_generic_text(self):
        self.assertEqual(routes_messages.TYPES, ('weekly', 'event', 'general', 'celebration', 'condolence'))
        self.assertNotIn('general', push.PUSH_TEXT)  # falls back to PUSH_TEXT['message']
        mid = self.post('main', type='general')[1]['messageId']
        self.repo.put_device(self.quiet, 'ExponentPushToken[quiet]', 'ios')
        messages, _ = push_worker._build(self.repo, 'message', self.k, mid)
        self.assertEqual({m['body'] for m in messages}, {push.PUSH_TEXT['message']['he']})
        self.assertEqual(messages[0]['data'], {'kehila': self.k, 'messageId': mid})


def load_tests(loader, tests, pattern):
    """Only this class's own tests: the inherited MessagesTest tests already run in test_messages."""
    suite = unittest.TestSuite()
    for name in MessageTypesTest.__dict__:
        if name.startswith('test_'):
            suite.addTest(MessageTypesTest(name))
    return suite
