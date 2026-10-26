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

    def test_reply_to_departed_target_409_and_count_unchanged(self):
        self.reply('member-sub', 'before')
        before = self.call('GET', f'{self.base()}/messages/{self.mid}', sub='member-sub')[1]['replierCount']
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='quiet-sub')[0], 204)
        self.assertEqual(self.reply('other-sub'), (409, {'error': 'target_left'}))
        after = self.call('GET', f'{self.base()}/messages/{self.mid}', sub='member-sub')[1]['replierCount']
        self.assertEqual((before, after), (1, 1))

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

    def test_replier_count_counts_distinct_users(self):
        self.reply('member-sub', 'one')
        self.reply('member-sub', 'two')
        self.reply('other-sub', 'three')
        status, msg = self.call('GET', f'{self.base()}/messages/{self.mid}', sub='gabbai-sub')
        self.assertEqual((status, msg['replierCount'], msg['targetName']), (200, 2, 'Quinn Quiet'))
        counts = [c for c in self.changes() if c['kind'] == 'reply_count']
        self.assertEqual(len(counts), 2)
        self.assertNotIn('visibleTo', counts[0])
        self.assertEqual(counts[0]['refId'], self.mid)

    def test_concurrent_first_replies_by_same_user_count_once(self):
        # the marker's attribute_not_exists in the reply's transaction is what makes this hold under races
        results = [self.repo.put_reply(self.k, self.mid, self.member, 'Mia Member', 'x')[1] for _ in range(2)]
        self.assertEqual(results, [True, False])

    def test_count_visible_to_everyone_who_sees_message(self):
        lid = self.post('announcements', type='celebration', targetMemberId=self.quiet)[1]['messageId']
        self.reply('member-sub', 'private', mid=lid)
        for sub in ('gabbai-sub', 'other-sub', 'listener-sub'):
            msg = self.call('GET', f'{self.base()}/messages/{lid}', sub=sub)[1]
            self.assertEqual((msg['replierCount'], msg['targetName']), (1, 'Quinn Quiet'), sub)
            listed = [m for m in self.call('GET', f'{self.base()}/messages', sub=sub)[1] if m['messageId'] == lid]
            self.assertEqual(listed[0]['replierCount'], 1, sub)
            if sub != 'listener-sub':
                self.assertEqual(self.replies(sub, mid=lid), [] if sub != 'member-sub' else ['private'])
        self.assertEqual(self.replies('listener-sub', mid=lid), [])
        self.assertEqual(self.replies('other-sub', mid=lid), [])

    def test_count_hidden_when_message_not_visible(self):
        self.reply('member-sub')
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{self.mid}', sub='listener-sub'),
                         (404, {'error': 'message_not_found'}))
        listed = self.call('GET', f'{self.base()}/messages', sub='listener-sub')[1]
        self.assertNotIn(self.mid, [m['messageId'] for m in listed])

    def test_untargeted_message_has_no_count_fields(self):
        msg = self.post('announcements')[1]
        self.assertNotIn('replierCount', msg)
        self.assertNotIn('targetName', msg)

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
