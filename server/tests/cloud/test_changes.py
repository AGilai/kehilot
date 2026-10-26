import time
import unittest

from moto import mock_aws

from server.cloud import ids, push
from server.tests.cloud import test_messages


@mock_aws
class ChangesTest(test_messages.MessagesTest):
    """Reuses the messages fixtures (members, channels, helpers) but none of its tests."""

    def setUp(self):
        super().setUp()
        self.other = self.add('other-sub', 'member', 'Omri Other')
        self.start = self.feed('gabbai-sub')[1]['cursor']

    def feed(self, sub, since=None):
        return self.call('GET', f'{self.base()}/changes', sub=sub, query={'since': since} if since else None)

    def since_start(self, sub):
        status, body = self.feed(sub, self.start)
        self.assertEqual(status, 200)
        return body

    def kinds(self, sub):
        return [(c['kind'], c['id']) for c in self.since_start(sub)['changes']]

    def test_no_since_returns_latest_cursor_and_no_changes(self):
        self.post('announcements')
        status, body = self.feed('member-sub')
        self.assertEqual((status, body['changes'], body['more']), (200, [], False))
        self.assertEqual(self.feed('member-sub', body['cursor'])[1]['changes'], [])

    def test_new_message_appears_after_cursor(self):
        mid = self.post('announcements')[1]['messageId']
        body = self.since_start('member-sub')
        (change,) = body['changes']
        self.assertEqual((change['kind'], change['id'], change['item']['title']), ('message', mid, 'Shabbat times'))
        self.assertEqual(change['item']['messageId'], mid)
        self.assertEqual(self.feed('member-sub', body['cursor'])[1]['changes'], [])

    def test_changes_hide_members_channel_from_listener(self):
        self.post('simchas')
        self.post('announcements')
        body = self.since_start('listener-sub')
        self.assertEqual(len(body['changes']), 1)
        self.assertEqual(body['changes'][0]['item']['channelId'], self.channels['announcements'])
        self.assertEqual(len(self.since_start('member-sub')['changes']), 2)
        # filtered changes still advance the cursor and are not rescanned
        self.assertEqual(self.feed('listener-sub', body['cursor'])[1]['changes'], [])

    def test_listener_gets_nothing_for_members_only_removal_or_join(self):
        mid = self.post('simchas')[1]['messageId']
        self.call('POST', f'{self.base()}/messages/{mid}/join', sub='member-sub')
        self.call('DELETE', f'{self.base()}/messages/{mid}')
        self.assertEqual(self.since_start('listener-sub')['changes'], [])

    def test_changes_hide_private_reply_from_others(self):
        mid = self.post('simchas', type='celebration', targetMemberId=self.quiet)[1]['messageId']
        rid = self.call('POST', f'{self.base()}/messages/{mid}/replies', sub='member-sub',
                        body={'body': 'Mazal tov'})[1]['replyId']
        for sub in ('member-sub', 'quiet-sub'):
            replies = [c for c in self.since_start(sub)['changes'] if c['kind'] == 'reply']
            self.assertEqual([(c['id'], c['item']['body']) for c in replies], [(rid, 'Mazal tov')], sub)
        for sub in ('other-sub', 'gabbai-sub', 'listener-sub'):
            self.assertEqual([c for c in self.since_start(sub)['changes'] if c['kind'] == 'reply'], [], sub)

    def test_read_mark_only_to_reader(self):
        mid = self.post('announcements')[1]['messageId']
        self.call('POST', f'{self.base()}/messages/{mid}/read', sub='member-sub')
        self.assertIn(('read', mid), self.kinds('member-sub'))
        for sub in ('other-sub', 'gabbai-sub', 'listener-sub'):
            self.assertNotIn(('read', mid), self.kinds(sub), sub)

    def test_removed_message_reported_without_content(self):
        mid = self.post('announcements')[1]['messageId']
        self.call('DELETE', f'{self.base()}/messages/{mid}')
        changes = self.since_start('member-sub')['changes']
        # the stale `message` change is skipped; only the removal is reported, id only
        self.assertEqual(changes, [{'kind': 'message_removed', 'id': mid, 'item': {'id': mid}}])

    def test_join_reports_current_count(self):
        mid = self.post('announcements')[1]['messageId']
        self.call('POST', f'{self.base()}/messages/{mid}/join', sub='member-sub')
        joins = [c for c in self.since_start('other-sub')['changes'] if c['kind'] == 'join']
        self.assertEqual([(c['id'], c['item']['joinCount']) for c in joins], [(mid, 1)])

    def test_demoted_or_removed_member_loses_channel(self):
        self.post('simchas')
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.other}'},
                                    UpdateExpression='SET #r = :r', ExpressionAttributeNames={'#r': 'role'},
                                    ExpressionAttributeValues={':r': 'listener'})
        self.assertEqual(self.since_start('other-sub')['changes'], [])

    def test_old_cursor_requests_resync(self):
        old = ids.floor_id(int((time.time() - 31 * 86400) * 1000))
        self.assertEqual(self.feed('member-sub', old), (200, {'resync': True}))
        recent = ids.floor_id(int((time.time() - 29 * 86400) * 1000))
        self.assertEqual(self.feed('member-sub', recent)[0], 200)
        self.assertNotIn('resync', self.feed('member-sub', recent)[1])

    def test_invalid_since_400(self):
        self.assertEqual(self.feed('member-sub', 'nope'), (400, {'error': 'invalid_since'}))

    def test_non_member_404(self):
        self.call('GET', '/v1/me', sub='stranger-sub')
        self.assertEqual(self.feed('stranger-sub')[0], 404)

    def test_more_flag_and_paging(self):
        for i in range(205):
            self.repo.put_change(self.k, 'message_removed', ids.new_id(), self.channels['announcements'])
        first = self.since_start('member-sub')
        self.assertEqual((len(first['changes']), first['more']), (200, True))
        second = self.feed('member-sub', first['cursor'])[1]
        self.assertEqual((len(second['changes']), second['more']), (5, False))
        seen = {c['id'] for c in first['changes'] + second['changes']}
        self.assertEqual(len(seen), 205)

    def test_exactly_200_has_no_more(self):
        for i in range(200):
            self.repo.put_change(self.k, 'message_removed', ids.new_id(), self.channels['announcements'])
        body = self.since_start('member-sub')
        self.assertEqual((len(body['changes']), body['more']), (200, False))

    def test_paging_counts_scanned_not_returned(self):
        for i in range(250):  # all hidden from the listener
            self.repo.put_change(self.k, 'message_removed', ids.new_id(), self.channels['simchas'])
        body = self.since_start('listener-sub')
        self.assertEqual((body['changes'], body['more']), ([], True))
        rest = self.feed('listener-sub', body['cursor'])[1]
        self.assertEqual(rest['more'], False)

    def test_visible_to_overrides_channel(self):
        self.repo.put_change(self.k, 'read', ids.new_id(), self.channels['announcements'], [self.other])
        self.assertEqual(len(self.since_start('member-sub')['changes']), 0)

    def test_kehila_exposes_poll_seconds_only(self):
        status, body = self.call('GET', self.base(), sub='listener-sub')
        self.assertEqual(status, 200)
        self.assertEqual(body['settings'], {'pollSeconds': 30})

    # notify prefs
    def notify(self, sub='member-sub', **body):
        return self.call('PUT', f'{self.base()}/me/notify', sub=sub, body=body)

    def stored(self, user_id):
        return self.repo.get_membership(self.k, user_id).get('notify')

    def test_notify_prefs_validate_ids(self):
        ch = self.channels['simchas']
        ok = {'mutedChannels': [ch], 'mutedTypes': ['weekly'], 'membersBroadcasts': 'management_only',
              'mutedMembers': [self.quiet]}
        self.assertEqual(self.notify(**ok), (200, {}))
        self.assertEqual(self.stored(self.member), ok)
        bad = [('mutedChannels', [ids.new_id()], 'invalid_muted_channels'),
               ('mutedChannels', 'x', 'invalid_muted_channels'),
               ('mutedChannels', [5], 'invalid_muted_channels'),
               ('mutedTypes', ['nonsense'], 'invalid_muted_types'),
               ('membersBroadcasts', 'some', 'invalid_members_broadcasts'),
               ('mutedMembers', [ids.new_id()], 'invalid_muted_members'),
               ('mutedMembers', ['not-an-id'], 'invalid_muted_members'),
               ('mutedMembers', [self.listener], 'invalid_muted_members')]
        for field, value, code in bad:
            self.assertEqual(self.notify(**{field: value}), (400, {'error': code}), (field, value))
        self.assertEqual(self.notify(), (400, {'error': 'invalid_body'}))
        self.assertEqual(self.stored(self.member), ok)  # rejected writes changed nothing

    def test_notify_member_of_other_kehila_rejected(self):
        k2 = self.repo.create_kehila('Beit Two', {})
        other_user = self.call('GET', '/v1/me', sub='x-sub')[1]['userId']
        self.repo.put_membership(k2, other_user, 'member')
        self.assertEqual(self.notify(mutedMembers=[other_user]), (400, {'error': 'invalid_muted_members'}))
        channel2 = self.repo.list_channels(k2)[0]['sk'][2:]
        self.assertEqual(self.notify(mutedChannels=[channel2]), (400, {'error': 'invalid_muted_channels'}))

    def test_notify_partial_update_merges_and_dedupes(self):
        self.notify(mutedTypes=['weekly', 'weekly'])
        self.notify(membersBroadcasts='all')
        self.assertEqual(self.stored(self.member), {'mutedTypes': ['weekly'], 'membersBroadcasts': 'all'})

    def test_listener_notify_limited_to_readable_channels(self):
        self.assertEqual(self.notify('listener-sub', mutedChannels=[self.channels['announcements']],
                                     mutedTypes=['event'])[0], 200)
        self.assertEqual(self.notify('listener-sub', mutedChannels=[self.channels['simchas']]),
                         (400, {'error': 'invalid_muted_channels'}))
        # the member list is hidden from listeners, so validating ids would reveal who is a member
        self.assertEqual(self.notify('listener-sub', mutedMembers=[self.member]),
                         (400, {'error': 'invalid_muted_members'}))
        self.assertEqual(self.notify('listener-sub', mutedMembers=[]), (200, {}))

    def test_notify_non_member_404(self):
        self.call('GET', '/v1/me', sub='stranger-sub')
        self.assertEqual(self.notify('stranger-sub', mutedTypes=[])[0], 404)


for _name in [n for n in dir(test_messages.MessagesTest) if n.startswith('test_') and n not in ChangesTest.__dict__]:
    setattr(ChangesTest, _name, None)  # do not rerun the messages tests here

if __name__ == '__main__':
    unittest.main()
