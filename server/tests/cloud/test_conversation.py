import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import push
from server.tests.cloud import test_groups
from server.tests.cloud.test_groups import own_tests_only


@own_tests_only
@mock_aws
class ConversationTest(test_groups.GroupsTest):
    """Conversation channels (spec 3c). Reuses the groups fixtures: gabbai, member (women, broadcaster),
    quiet (women, no broadcast right), other (men), listener (no group)."""

    def setUp(self):
        super().setUp()
        self.chat = self.make_chat('chat-all', [])
        self.wchat = self.make_chat('chat-women', [self.women])

    def make_chat(self, name, groups, **extra):
        body = {'name': name, 'listenersCanRead': False, 'postPolicy': 'management', 'groups': groups,
                'conversation': True, **extra}
        status, out = self.call('POST', f'{self.base()}/admin/channels', body=body)
        self.assertEqual(status, 201, out)
        self.channels[name] = out['channelId']
        return out['channelId']

    def chat_post(self, channel='chat-all', sub='quiet-sub', body='shalom', **extra):
        return self.call('POST', f'{self.base()}/messages', sub=sub,
                         body={'channelId': self.channels[channel], 'body': body, **extra})

    def settings(self, channel, sub='gabbai-sub', **body):
        return self.call('PUT', f'{self.base()}/channels/{self.channels[channel]}/chat-settings', sub=sub, body=body)

    def test_member_without_broadcast_posts_chat_in_conversation_channel(self):
        with mock.patch.object(push, 'enqueue') as enqueue:
            status, body = self.chat_post()
        self.assertEqual((status, body['type'], body['title'], body['body']), (201, 'chat', '', 'shalom'))
        enqueue.assert_called_once_with('message', self.k, body['messageId'])
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{body["messageId"]}')[0], 200)

    def test_listener_cannot_read_or_post_whole_kehila_conversation_channel(self):
        self.assertNotIn('chat-all', self.channel_names('listener-sub'))
        self.assertEqual(self.chat_post(sub='listener-sub'), (404, {'error': 'channel_not_found'}))
        self.assertIn('chat-all', self.channel_names('quiet-sub'))

    def test_listener_in_group_posts_in_group_conversation_channel(self):
        self.set_groups(self.listener, [self.women])
        info = self.channel_names('listener-sub')['chat-women']
        self.assertTrue(info['canPost'])
        status, body = self.chat_post('chat-women', sub='listener-sub')
        self.assertEqual((status, body['type']), (201, 'chat'))
        self.assertEqual(self.chat_post('chat-all', sub='listener-sub')[0], 404)
        self.assertEqual(self.call('DELETE', f'{self.base()}/messages/{body["messageId"]}', sub='listener-sub')[0], 204)

    def test_channel_admin_sets_chat_limit(self):
        self.call('PUT', f'{self.base()}/admin/groups/{self.women}/admins/{self.member}')
        self.assertEqual(self.settings('chat-women', 'member-sub', chatHourlyLimit=5), (200, {}))
        self.assertEqual(self.channel_names('member-sub')['chat-women']['chatHourlyLimit'], 5)
        self.assertTrue(self.channel_names('member-sub')['chat-women']['isAdmin'])
        self.assertFalse(self.channel_names('quiet-sub')['chat-women']['isAdmin'])
        self.assertEqual(self.settings('chat-women', 'quiet-sub', chatHourlyLimit=5), (403, {'error': 'forbidden'}))
        self.assertEqual(self.settings('chat-women', 'other-sub', chatHourlyLimit=5),
                         (404, {'error': 'channel_not_found'}))
        for bad in (-1, 201, '5', True, None):
            self.assertEqual(self.settings('chat-women', chatHourlyLimit=bad),
                             (400, {'error': 'invalid_chat_hourly_limit'}), bad)
        self.assertEqual(self.settings('announcements', chatHourlyLimit=5), (409, {'error': 'not_conversation'}))
        self.assertEqual(self.settings('chat-all', chatHourlyLimit=0), (200, {}))  # gabbai

    def test_chat_limit_zero_only_admins_post(self):
        self.call('PUT', f'{self.base()}/admin/groups/{self.women}/admins/{self.member}')
        self.settings('chat-women', chatHourlyLimit=0)
        self.assertEqual(self.chat_post('chat-women', sub='quiet-sub'), (403, {'error': 'forbidden'}))
        self.assertFalse(self.channel_names('quiet-sub')['chat-women']['canPost'])
        self.assertEqual(self.chat_post('chat-women', sub='member-sub')[0], 201)
        self.assertEqual(self.chat_post('chat-women', sub='gabbai-sub')[0], 201)

    def test_admins_not_rate_limited(self):
        self.settings('chat-all', chatHourlyLimit=1)
        for _ in range(3):
            self.assertEqual(self.chat_post(sub='gabbai-sub')[0], 201)
        self.assertEqual(self.repo._query_prefix(self.k, 'CC#'), [])

    def test_chat_limit_is_per_channel(self):
        self.settings('chat-all', chatHourlyLimit=1)
        self.assertEqual(self.chat_post('chat-all')[0], 201)
        self.assertEqual(self.chat_post('chat-all'), (429, {'error': 'rate_limited'}))
        self.assertEqual(self.chat_post('chat-women')[0], 201)

    def test_conversation_channel_refuses_listeners_can_read(self):
        body = {'name': 'x', 'listenersCanRead': True, 'postPolicy': 'management', 'conversation': True}
        self.assertEqual(self.call('POST', f'{self.base()}/admin/channels', body=body),
                         (400, {'error': 'invalid_listeners_can_read'}))
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/channels/{self.channels["announcements"]}',
                                   body=body), (400, {'error': 'invalid_listeners_can_read'}))
        self.assertEqual(self.call('POST', f'{self.base()}/admin/channels', body={**body, 'conversation': 'yes'}),
                         (400, {'error': 'invalid_conversation'}))
        # stored conversation + listenersCanRead on update without `conversation`
        plain = {'name': 'chat-all', 'listenersCanRead': True, 'postPolicy': 'management'}
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/channels/{self.chat}', body=plain),
                         (400, {'error': 'invalid_listeners_can_read'}))

    def test_chat_has_no_title_type_or_target(self):
        for extra, code in (({'type': 'weekly'}, 'invalid_type'), ({'title': 'T'}, 'invalid_title'),
                            ({'targetMemberId': self.member}, 'invalid_target_member_id')):
            self.assertEqual(self.chat_post(**extra), (400, {'error': code}), extra)
        self.assertEqual(self.chat_post(type='chat', title='')[0], 201)

    def test_chat_body_limit_counts_code_points(self):
        self.assertEqual(self.chat_post(body='🙂' * 1000, sub='gabbai-sub')[0], 201)
        self.assertEqual(self.chat_post(body='🙂' * 1001, sub='gabbai-sub'), (400, {'error': 'invalid_body'}))
        self.assertEqual(self.chat_post(body='  ', sub='gabbai-sub'), (400, {'error': 'invalid_body'}))

    def test_chat_type_refused_outside_conversation_channel(self):
        self.assertEqual(self.post('announcements', type='chat'), (400, {'error': 'invalid_type'}))

    def test_chat_rate_limit_31st_in_hour_is_429(self):
        for _ in range(30):
            self.assertEqual(self.chat_post()[0], 201)
        self.assertEqual(self.chat_post(), (429, {'error': 'rate_limited'}))
        self.assertEqual(self.chat_post(sub='member-sub')[0], 201)  # per user

    def test_chat_counter_is_per_hour_bucket(self):
        from server.cloud.errors import ApiError
        self.repo.count_chat(self.k, self.chat, self.member, '2026102710', 1)
        with self.assertRaises(ApiError) as caught:
            self.repo.count_chat(self.k, self.chat, self.member, '2026102710', 1)
        self.assertEqual((caught.exception.status, caught.exception.code), (429, 'rate_limited'))
        self.repo.count_chat(self.k, self.chat, self.member, '2026102711', 1)
        items = self.repo._query_prefix(self.k, 'CC#')
        self.assertEqual(sorted(i['sk'] for i in items),
                         [f'CC#{self.chat}#{self.member}#2026102710', f'CC#{self.chat}#{self.member}#2026102711'])

    def test_custom_chat_limit_applies(self):
        self.settings('chat-all', chatHourlyLimit=2)
        self.assertEqual([self.chat_post()[0] for _ in range(3)], [201, 201, 429])

    def test_chat_does_not_use_broadcast_limit(self):
        self.chat_post()
        self.assertEqual(self.repo._query_prefix(self.k, 'BC#'), [])
        self.assertEqual(len(self.repo._query_prefix(self.k, 'CC#')), 1)

    def test_author_and_gabbai_delete_chat(self):
        mine = self.chat_post()[1]['messageId']
        theirs = self.chat_post(sub='member-sub')[1]['messageId']
        url = lambda m: f'{self.base()}/messages/{m}'
        self.assertEqual(self.call('DELETE', url(theirs), sub='quiet-sub'), (403, {'error': 'forbidden'}))
        self.assertEqual(self.call('DELETE', url(mine), sub='quiet-sub'), (204, None))
        self.assertEqual(self.call('DELETE', url(theirs)), (204, None))

    def test_put_channel_without_conversation_keeps_it(self):
        body = {'name': 'renamed', 'listenersCanRead': False, 'postPolicy': 'management'}
        status, out = self.call('PUT', f'{self.base()}/admin/channels/{self.chat}', body=body)
        self.assertEqual((status, out['conversation'], out['name']), (200, True, 'renamed'))
        status, out = self.call('PUT', f'{self.base()}/admin/channels/{self.chat}', body={**body, 'conversation': False})
        self.assertEqual((status, out['conversation']), (200, False))
        self.assertFalse(self.repo.get_channel(self.k, self.chat)['conversation'])

    def test_notify_chat_channels_only_readable_conversation_channels(self):
        notify = lambda sub, v: self.call('PUT', f'{self.base()}/me/notify', sub=sub, body={'chatChannels': v})
        self.assertEqual(notify('quiet-sub', [self.chat, self.wchat]), (200, {}))
        self.assertEqual(self.repo.get_membership(self.k, self.quiet)['notify']['chatChannels'], [self.chat, self.wchat])
        for bad in ([self.channels['announcements']], [self.channels['simchas']], 'x', ['0' * 26], [1]):
            self.assertEqual(notify('quiet-sub', bad), (400, {'error': 'invalid_chat_channels'}), bad)
        self.assertEqual(notify('other-sub', [self.wchat]), (400, {'error': 'invalid_chat_channels'}))
        self.assertEqual(notify('listener-sub', [self.chat]), (400, {'error': 'invalid_chat_channels'}))
        self.set_groups(self.listener, [self.women])
        self.assertEqual(notify('listener-sub', [self.wchat]), (200, {}))
        self.assertEqual(notify('quiet-sub', []), (200, {}))

    def test_kehila_notify_default_chat_channels_empty(self):
        status, body = self.call('GET', self.base(), sub='quiet-sub')
        self.assertEqual((status, body['notify']['chatChannels']), (200, []))


if __name__ == '__main__':
    unittest.main()
