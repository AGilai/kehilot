import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import push, push_worker, visibility
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
        self.assertTrue(visibility.reply_visible('t', message, reply, frozenset({'t'})))
        self.assertFalse(visibility.reply_visible('t', message, reply))  # the stored member alone grants nothing
        self.assertFalse(visibility.reply_visible('g', message, reply, frozenset({'t'})))
        self.assertFalse(visibility.reply_visible('g', {}, reply))
        self.assertFalse(visibility.reply_visible(None, {}, {}))

    # --- families (Task 5) ---
    def link(self, a, b):
        self.repo.link(self.k, a, b)
        return self.repo.family_of(self.k, a)['familyId']

    def test_partner_sees_replies_and_gabbai_still_not(self):
        self.link(self.quiet, self.other)
        self.reply('member-sub', 'hello')
        self.assertEqual(self.replies('quiet-sub'), ['hello'])
        self.assertEqual(self.replies('other-sub'), ['hello'])
        self.assertEqual(self.replies('gabbai-sub'), [])
        self.assertEqual(self.replies('member-sub', mid=self.post('simchas', type='celebration',
                         targetMemberId=self.quiet)[1]['messageId']), [])

    def set_group(self, channel, members):
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'C#{self.channels[channel]}'},
                                    UpdateExpression='SET #g = :g',
                                    ExpressionAttributeNames={'#g': 'groups'}, ExpressionAttributeValues={':g': {'g1'}})
        for uid in members:
            self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{uid}'}, UpdateExpression='SET #g = :g',
                                        ExpressionAttributeNames={'#g': 'groups'}, ExpressionAttributeValues={':g': {'g1'}})

    def test_partner_who_cannot_read_channel_sees_nothing(self):
        self.link(self.quiet, self.other)
        self.set_group('simchas', [self.member, self.quiet])
        self.assertEqual(self.reply('member-sub', 'hi')[0], 201)
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{self.mid}', sub='other-sub')[0], 404)
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{self.mid}/replies', sub='other-sub')[0], 404)
        self.assertEqual(push_worker.recipients(self.repo, 'reply', self.k, self.mid), [self.quiet])

    def test_ex_partner_loses_replies_after_unlink(self):
        self.link(self.quiet, self.other)
        self.reply('member-sub', 'hi')
        self.assertEqual(self.call('POST', f'{self.base()}/family/unlink', sub='other-sub')[0], 200)
        self.assertEqual(self.replies('other-sub'), [])
        self.assertEqual(self.replies('quiet-sub'), ['hi'])

    def test_target_family_id_survives_target_member_unlink(self):
        fid = self.link(self.quiet, self.other)
        mid = self.post('simchas', type='celebration', targetMemberId=self.other, targetFamilyId=fid)[1]['messageId']
        self.reply('member-sub', 'hi', mid=mid)
        self.call('POST', f'{self.base()}/family/unlink', sub='other-sub')
        self.assertEqual(self.replies('quiet-sub', mid=mid), ['hi'])
        self.assertEqual(self.replies('other-sub', mid=mid), [])
        self.assertEqual(self.reply('other-sub', mid=mid)[0], 201)  # no longer the target: may reply

    def test_old_message_falls_back_to_member_family(self):
        self.reply('member-sub', 'hi')  # self.mid has only targetMemberId
        self.assertEqual(self.replies('other-sub'), [])
        self.link(self.quiet, self.other)
        self.assertEqual(self.replies('other-sub'), ['hi'])

    def test_partner_cannot_reply_to_own_family(self):
        self.link(self.quiet, self.other)
        self.assertEqual(self.reply('other-sub'), (409, {'error': 'cannot_reply_to_own'}))

    def test_reply_allowed_while_one_adult_remains(self):
        fid = self.link(self.quiet, self.other)
        mid = self.post('simchas', type='celebration', targetMemberId=self.quiet, targetFamilyId=fid)[1]['messageId']
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='quiet-sub')[0], 204)
        with mock.patch.object(push, 'enqueue') as enqueue:
            self.assertEqual(self.reply('member-sub', mid=mid)[0], 201)
        enqueue.assert_called_once_with('reply', self.k, mid)
        self.assertEqual(push_worker.recipients(self.repo, 'reply', self.k, mid), [self.other])
        self.assertEqual(self.replies('other-sub', mid=mid), ['Mazal tov'])
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='other-sub')[0], 204)
        self.assertEqual(self.reply('member-sub', mid=mid), (409, {'error': 'target_left'}))

    def test_invalid_target_family(self):
        fid = self.link(self.quiet, self.other)
        mia_family = self.repo.ensure_family(self.k, self.member)
        for extra in ({'targetMemberId': self.member, 'targetFamilyId': fid},
                      {'targetMemberId': self.quiet, 'targetFamilyId': mia_family},
                      {'targetMemberId': self.quiet, 'targetFamilyId': 'nope'},
                      {'targetMemberId': self.quiet, 'targetFamilyId': '0' * 26},
                      {'targetFamilyId': fid}):
            self.assertEqual(self.post('simchas', type='celebration', **extra),
                             (400, {'error': 'invalid_target_family_id'}), extra)
        status, body = self.post('simchas', type='celebration', targetMemberId=self.other, targetFamilyId=fid)
        self.assertEqual((status, body['targetFamilyId']), (201, fid))
        self.assertNotIn('targetFamilyId', self.post('simchas', type='celebration',
                                                     targetMemberId=self.other)[1])

    def test_stale_adult_with_other_family_loses_access(self):
        fid = self.link(self.quiet, self.other)
        mid = self.post('simchas', type='celebration', targetMemberId=self.quiet, targetFamilyId=fid)[1]['messageId']
        self.reply('member-sub', 'hi', mid=mid)
        # Omri left and rejoined with a new family, but the clean-up of F never ran: F.adults still lists him
        new_fid = self.repo.ensure_family(self.k, self.member)
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.other}'},
                                    UpdateExpression='SET familyId = :f', ExpressionAttributeValues={':f': new_fid})
        self.assertIn(self.other, self.repo.get_family(self.k, fid)['adults'])
        self.assertEqual(self.replies('other-sub', mid=mid), [])
        self.assertEqual(push_worker.recipients(self.repo, 'reply', self.k, mid), [self.quiet])
        self.assertEqual(self.post('simchas', type='celebration', targetMemberId=self.other,
                                   targetFamilyId=fid), (400, {'error': 'invalid_target_family_id'}))
        rows = self.families()[1]
        self.assertEqual([r['targetMemberId'] for r in rows if r['familyId'] == fid], [self.quiet])

    def test_target_family_refused_on_chat_message(self):
        fid = self.repo.ensure_family(self.k, self.quiet)
        chat = self.call('POST', f'{self.base()}/admin/channels', body={'name': 'Chat', 'conversation': True, 'listenersCanRead': False,
                                                                      'postPolicy': 'management', 'groups': []})
        self.assertEqual(chat[0], 201, chat)
        status, body = self.call('POST', f'{self.base()}/messages', body={
            'channelId': chat[1]['channelId'], 'body': 'x', 'targetFamilyId': fid})
        self.assertEqual((status, body), (400, {'error': 'invalid_target_family_id'}))

    def set_names(self, **subs):
        for sub, (first, last) in subs.items():
            self.call('PUT', '/v1/me/profile', sub=sub, body={'firstName': first, 'lastName': last, 'lang': 'en'})

    def families(self, sub='member-sub', channel='simchas'):
        return self.call('GET', f'{self.base()}/families', sub=sub, query={'channelId': self.channels[channel]})

    def test_family_picker_lists_families_once_and_hides_unreachable(self):
        self.set_names(**{'quiet-sub': ('Quinn', 'Quiet'), 'other-sub': ('Omri', 'Other'),
                          'member-sub': ('Mia', 'Member'), 'gabbai-sub': ('Gabi', 'Gabbai')})
        for uid in (self.member, self.gabbai):
            self.repo.ensure_family(self.k, uid)
        self.link(self.quiet, self.other)
        status, rows = self.families()
        self.assertEqual(status, 200)
        self.assertEqual([r['name'] for r in rows], ['Gabbai', 'Member', 'Quiet · Other'])
        couple = rows[2]
        self.assertEqual((couple['firstNames'], couple['targetMemberId']), (['Quinn', 'Omri'], self.quiet))
        self.assertEqual(set(couple), {'familyId', 'name', 'firstNames', 'targetMemberId'})
        self.set_group('simchas', [self.member])  # the couple cannot read it; the gabbai reads every channel
        self.assertEqual([r['name'] for r in self.families()[1]], ['Gabbai', 'Member'])
        self.assertEqual(self.families('listener-sub')[0], 403)
        self.assertEqual(self.call('GET', f'{self.base()}/families', sub='member-sub')[1], {'error': 'invalid_channel_id'})
        self.assertEqual(self.call('GET', f'{self.base()}/families', sub='member-sub',
                                   query={'channelId': '0' * 26})[1], {'error': 'channel_not_found'})


for _name in [n for n in dir(test_messages.MessagesTest) if n.startswith('test_') and n not in RepliesTest.__dict__]:
    setattr(RepliesTest, _name, None)  # do not rerun the messages tests here

if __name__ == '__main__':
    unittest.main()
