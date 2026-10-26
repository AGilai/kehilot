import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import push, visibility
from server.tests.cloud import test_messages


@mock_aws
class RepliesTest(test_messages.MessagesTest):
    """Reuses the messages fixtures (members, channels, helpers) but none of its tests."""

    def setUp(self):
        super().setUp()
        self.other = self.add('other-sub', 'member', 'Omri Other')
        self.mid = self.post('simchas', type='celebration', targetMemberId=self.quiet)[1]['messageId']

    def reply(self, sub, body='Mazal tov', mid=None):
        return self.call('POST', f'{self.base()}/messages/{mid or self.mid}/replies', sub=sub, body={'body': body})

    def replies(self, sub, mid=None):
        status, body = self.call('GET', f'{self.base()}/messages/{mid or self.mid}/replies', sub=sub)
        self.assertEqual(status, 200)
        return [r['body'] for r in body]

    def test_target_sees_all_replies(self):
        self.reply('member-sub', 'from member')
        self.reply('other-sub', 'from other')
        self.assertCountEqual(self.replies('quiet-sub'), ['from member', 'from other'])

    def test_author_sees_only_own_reply(self):
        self.reply('member-sub', 'from member')
        self.reply('other-sub', 'from other')
        self.assertEqual(self.replies('member-sub'), ['from member'])
        self.assertEqual(self.replies('other-sub'), ['from other'])

    def test_other_member_sees_none(self):
        self.reply('member-sub')
        self.assertEqual(self.replies('other-sub'), [])

    def test_gabbai_cannot_see_private_reply(self):
        self.reply('member-sub')
        self.assertEqual(self.replies('gabbai-sub'), [])

    def test_reply_on_untargeted_message_409(self):
        mid = self.post('announcements')[1]['messageId']
        self.assertEqual(self.reply('member-sub', mid=mid), (409, {'error': 'replies_not_allowed'}))

    def test_listener_cannot_reply(self):
        mid = self.post('announcements', type='celebration', targetMemberId=self.quiet)[1]['messageId']
        self.assertEqual(self.reply('listener-sub', mid=mid)[0], 403)
        self.assertEqual(self.replies('listener-sub', mid=mid), [])

    def test_target_cannot_reply_to_own(self):
        self.assertEqual(self.reply('quiet-sub'), (409, {'error': 'cannot_reply_to_own'}))

    def test_reply_shape_change_and_push(self):
        with mock.patch.object(push, 'enqueue') as enqueue:
            status, body = self.reply('member-sub')
        self.assertEqual(status, 201)
        self.assertEqual((body['authorId'], body['authorName'], body['body']),
                         (self.member, 'Mia Member', 'Mazal tov'))
        self.assertIn('replyId', body)
        enqueue.assert_called_once_with('reply', self.k, self.mid)
        change = [c for c in self.changes() if c['kind'] == 'reply'][0]
        self.assertEqual((change['refId'], change['messageId'], change['channelId']),
                         (body['replyId'], self.mid, self.channels['simchas']))
        self.assertEqual(change['visibleTo'], [self.member, self.quiet])

    def test_validation(self):
        self.assertEqual(self.reply('member-sub', ''), (400, {'error': 'invalid_body'}))
        self.assertEqual(self.reply('member-sub', 'x' * 1001), (400, {'error': 'invalid_body'}))
        self.assertEqual(self.reply('member-sub', 'x' * 1000)[0], 201)

    def test_removed_or_hidden_message_404(self):
        self.call('DELETE', f'{self.base()}/messages/{self.mid}')
        self.assertEqual(self.reply('member-sub'), (404, {'error': 'message_not_found'}))
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{self.mid}/replies', sub='member-sub')[0], 404)

    def test_reply_visible(self):
        message, reply = {'targetMemberId': 't'}, {'authorId': 'a'}
        self.assertTrue(visibility.reply_visible('a', message, reply))
        self.assertTrue(visibility.reply_visible('t', message, reply))
        self.assertFalse(visibility.reply_visible('g', message, reply))
        self.assertFalse(visibility.reply_visible('g', {}, reply))
        self.assertFalse(visibility.reply_visible(None, {}, {}))


for _name in [n for n in dir(test_messages.MessagesTest) if n.startswith('test_') and n not in RepliesTest.__dict__]:
    setattr(RepliesTest, _name, None)  # do not rerun the messages tests here

if __name__ == '__main__':
    unittest.main()
