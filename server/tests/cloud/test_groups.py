import json
import os
import unittest
from unittest import mock

import boto3
from moto import mock_aws

from server.cloud import accounts, push, push_worker
from server.cloud import handler as handler_module
from server.tests.cloud import test_import, test_messages
from server.tests.cloud.test_handler import Context, event


def own_tests_only(cls):
    """The fixtures come from another test class; do not rerun its tests here."""
    for base in cls.__mro__[1:]:
        for name in dir(base):
            if name.startswith('test_') and name not in cls.__dict__:
                setattr(cls, name, None)
    return cls


@own_tests_only
@mock_aws
class GroupsTest(test_messages.MessagesTest):
    """Reuses the messages fixtures (members, channels, helpers) but none of its tests."""

    def setUp(self):
        super().setUp()
        self.women = self.make_group('Women')
        self.men = self.make_group('Men')
        self.other = self.add('other-sub', 'member', 'Omri Other')
        self.set_groups(self.member, [self.women])
        self.set_groups(self.quiet, [self.women])
        self.set_groups(self.other, [self.men])
        self.wchan = self.make_channel('women-only', [self.women])
        self.channels['women-only'] = self.wchan

    def make_group(self, name):
        status, body = self.call('POST', f'{self.base()}/admin/groups', body={'name': name})
        self.assertEqual(status, 201, body)
        return body['groupId']

    def set_groups(self, user_id, groups, expect=200):
        status, body = self.call('PUT', f'{self.base()}/admin/members/{user_id}', body={'groups': groups})
        self.assertEqual(status, expect, body)
        return body

    def make_channel(self, name, groups, **extra):
        body = {'name': name, 'listenersCanRead': False, 'postPolicy': 'management', 'groups': groups, **extra}
        status, out = self.call('POST', f'{self.base()}/admin/channels', body=body)
        self.assertEqual(status, 201, out)
        return out['channelId']

    def listed(self, sub):
        status, body = self.call('GET', f'{self.base()}/messages', sub=sub)
        self.assertEqual(status, 200)
        return [m['messageId'] for m in body]

    def channel_names(self, sub):
        status, body = self.call('GET', f'{self.base()}/channels', sub=sub)
        self.assertEqual(status, 200)
        return {c['name']: c for c in body}

    def test_member_reads_group_channel_only_when_in_a_group(self):
        mid = self.post('women-only')[1]['messageId']
        self.assertIn('women-only', self.channel_names('member-sub'))
        self.assertNotIn('women-only', self.channel_names('other-sub'))
        self.assertTrue(self.channel_names('member-sub')['women-only']['inAudience'])
        self.assertEqual(self.listed('member-sub'), [mid])
        self.assertEqual(self.listed('other-sub'), [])
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub='member-sub')[0], 200)
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub='other-sub'),
                         (404, {'error': 'message_not_found'}))
        self.assertEqual(self.post('women-only', sub='other-sub')[0], 404)

    def test_listener_never_reads_group_channel(self):
        self.repo.table.put_item(Item={'pk': f'K#{self.k}', 'sk': 'C#01ARZ3NDEKTSV4RRFFQ69G5FAV', 'name': 'sneaky',
                                       'listenersCanRead': True, 'postPolicy': 'management',
                                       'groups': {self.women}})
        mid = self.post('women-only')[1]['messageId']
        self.assertEqual(self.channel_names('listener-sub').keys(), {'announcements'})
        self.assertEqual(self.listed('listener-sub'), [])
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub='listener-sub')[0], 404)

    def test_gabbai_reads_group_channel_but_not_private_replies(self):
        status, msg = self.post('women-only', type='celebration', targetMemberId=self.quiet)
        self.assertEqual(status, 201, msg)
        mid = msg['messageId']
        self.assertEqual(self.call('POST', f'{self.base()}/messages/{mid}/replies', sub='member-sub',
                                   body={'body': 'Mazal tov'})[0], 201)
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub='gabbai-sub')[0], 200)
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}/replies', sub='gabbai-sub'), (200, []))
        mine = self.channel_names('gabbai-sub')['women-only']
        self.assertFalse(mine['inAudience'])
        self.assertEqual(mine['groups'], [self.women])
        self.assertNotIn('groups', self.channel_names('member-sub')['women-only'])

    def test_channel_with_groups_refuses_listeners_can_read(self):
        body = {'name': 'x', 'listenersCanRead': True, 'postPolicy': 'management', 'groups': [self.women]}
        self.assertEqual(self.call('POST', f'{self.base()}/admin/channels', body=body), (400, {'error': 'invalid_groups'}))
        status, out = self.call('PUT', f'{self.base()}/admin/channels/{self.wchan}', body=body)
        self.assertEqual((status, out), (400, {'error': 'invalid_groups'}))
        # omitting groups on update must not slip past the rule either
        body.pop('groups')
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/channels/{self.wchan}', body=body),
                         (400, {'error': 'invalid_groups'}))
        for bad in ('x', [1], ['NOPE'], [self.women, 'NOPE'], [self.women] * 2 + [str(i) for i in range(21)]):
            status, out = self.call('POST', f'{self.base()}/admin/channels',
                                    body={'name': 'y', 'listenersCanRead': False, 'postPolicy': 'management',
                                          'groups': bad})
            self.assertEqual((status, out), (400, {'error': 'invalid_groups'}), bad)

    def test_put_channel_without_groups_keeps_them(self):
        status, out = self.call('PUT', f'{self.base()}/admin/channels/{self.wchan}',
                                body={'name': 'renamed', 'listenersCanRead': False, 'postPolicy': 'management'})
        self.assertEqual((status, out['name'], out['groups']), (200, 'renamed', [self.women]))
        status, out = self.call('PUT', f'{self.base()}/admin/channels/{self.wchan}',
                                body={'name': 'renamed', 'listenersCanRead': False, 'postPolicy': 'management',
                                      'groups': []})
        self.assertEqual((status, out['groups']), (200, []))
        self.assertNotIn('groups', self.repo.get_channel(self.k, self.wchan))
        status, out = self.call('POST', f'{self.base()}/admin/channels',
                                body={'name': 'plain', 'listenersCanRead': True, 'postPolicy': 'management'})
        self.assertEqual((status, out['groups']), (201, []))

    def test_feed_hides_group_channel_changes_from_non_members(self):
        import time
        from server.cloud import routes_changes
        offset = [0]
        patcher = mock.patch.object(routes_changes, '_now_ms', side_effect=lambda: int((time.time() + offset[0]) * 1000))
        patcher.start()
        self.addCleanup(patcher.stop)
        start = self.call('GET', f'{self.base()}/changes', sub='member-sub')[1]['cursor']
        offset[0] = 10
        mid = self.post('women-only', type='celebration', targetMemberId=self.quiet)[1]['messageId']
        self.call('POST', f'{self.base()}/messages/{mid}/join', sub='member-sub')
        self.call('POST', f'{self.base()}/messages/{mid}/replies', sub='member-sub', body={'body': 'hi'})

        def kinds(sub):
            status, body = self.call('GET', f'{self.base()}/changes', sub=sub, query={'since': start})
            self.assertEqual(status, 200)
            return {c['kind'] for c in body['changes']}
        self.assertEqual(kinds('member-sub'), {'message', 'join', 'reply_count', 'reply'})  # their own reply
        self.assertEqual(kinds('other-sub'), set())
        self.assertEqual(kinds('listener-sub'), set())
        self.assertEqual(kinds('gabbai-sub'), {'message', 'join', 'reply_count'})

    def message_item(self, channel_key, author='nobody', target=None):
        return self.repo.put_message(self.k, self.channels[channel_key], 'weekly', 't', 'b', author, 'N',
                                     'management', target)

    def test_push_recipients_follow_audience(self):
        gab_in = self.add('gab-in-sub', 'gabbai', 'Gil In')
        self.set_groups(gab_in, [self.women])
        item = self.message_item('women-only')
        mid = item['sk'][len('MSG#'):]
        got = push_worker.recipients(self.repo, 'message', self.k, mid)
        self.assertIn(self.member, got)
        self.assertNotIn(self.other, got)
        self.assertNotIn(self.gabbai, got)
        self.assertNotIn(self.listener, got)
        self.assertIn(gab_in, got)

    def test_target_must_read_group_channel(self):
        status, body = self.post('women-only', type='celebration', targetMemberId=self.other)
        self.assertEqual((status, body), (400, {'error': 'invalid_target_member_id'}))
        self.assertEqual(self.post('women-only', type='celebration', targetMemberId=self.quiet)[0], 201)
        self.assertEqual(self.post('women-only', type='celebration', targetMemberId=self.gabbai)[0], 201)

    def test_reply_after_target_left_group_is_409_and_not_pushed(self):
        mid = self.post('women-only', type='celebration', targetMemberId=self.quiet)[1]['messageId']
        self.set_groups(self.quiet, [self.men])
        with mock.patch.object(push, 'enqueue') as enqueue:
            status, body = self.call('POST', f'{self.base()}/messages/{mid}/replies', sub='member-sub',
                                     body={'body': 'hi'})
        self.assertEqual((status, body), (409, {'error': 'target_left'}))
        enqueue.assert_not_called()
        self.assertEqual(push_worker.recipients(self.repo, 'reply', self.k, mid), [])

    def test_directory_filtered_by_channel(self):
        def names(sub, channel=None):
            status, body = self.call('GET', f'{self.base()}/members', sub=sub,
                                     query={'channelId': channel} if channel else None)
            return status, body
        status, body = names('member-sub', self.wchan)
        self.assertEqual(status, 200)
        self.assertEqual({r['userId'] for r in body}, {self.member, self.quiet, self.gabbai})
        self.assertIn(self.other, {r['userId'] for r in names('member-sub')[1]})
        self.assertEqual(names('other-sub', self.wchan), (404, {'error': 'channel_not_found'}))
        self.assertEqual(names('member-sub', 'bad'), (400, {'error': 'invalid_channel_id'}))
        self.assertEqual(names('member-sub', '0' * 26)[0], 404)

    def test_removed_member_from_group_loses_channel_at_once(self):
        mid = self.post('women-only')[1]['messageId']
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub='member-sub')[0], 200)
        self.set_groups(self.member, [])
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub='member-sub'),
                         (404, {'error': 'message_not_found'}))
        self.assertNotIn('groups', self.repo.get_membership(self.k, self.member))

    def test_members_list_shows_groups_and_validates_input(self):
        status, rows = self.call('GET', f'{self.base()}/admin/members')
        by = {r['userId']: r for r in rows}
        self.assertEqual(by[self.member]['groups'], [self.women])
        self.assertEqual(by[self.listener]['groups'], [])
        for bad in ('x', [1], ['NOPE'], [self.women] + ['0' * 26]):
            self.set_groups(self.member, bad, expect=400)
        self.assertEqual(self.set_groups(self.member, [self.women, self.women, self.men]), {})
        self.assertEqual(self.repo.get_membership(self.k, self.member)['groups'], {self.women, self.men})

    def test_groups_listing_counts_and_sorting(self):
        status, rows = self.call('GET', f'{self.base()}/admin/groups')
        self.assertEqual(status, 200)
        self.assertEqual(rows, [{'groupId': self.men, 'name': 'Men', 'memberCount': 1, 'channelCount': 0},
                                {'groupId': self.women, 'name': 'Women', 'memberCount': 2, 'channelCount': 1}])

    def test_rename_group(self):
        status, body = self.call('PUT', f'{self.base()}/admin/groups/{self.women}', body={'name': ' Ladies '})
        self.assertEqual((status, body), (200, {'groupId': self.women, 'name': 'Ladies'}))
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/groups/{self.women}', body={'name': 'men'}),
                         (409, {'error': 'group_name_taken'}))
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/groups/{self.women}', body={'name': 'WOMEN'})[0], 200)
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/groups/{self.women}', body={'name': ' '}),
                         (400, {'error': 'invalid_name'}))
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/groups/{"0" * 26}', body={'name': 'Z'}),
                         (404, {'error': 'group_not_found'}))
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/groups/bad', body={'name': 'Z'})[0], 404)

    def test_delete_group_in_use_is_409(self):
        self.assertEqual(self.call('DELETE', f'{self.base()}/admin/groups/{self.women}'),
                         (409, {'error': 'group_in_use'}))
        self.assertEqual(self.call('DELETE', f'{self.base()}/admin/groups/{self.men}'), (204, None))
        self.assertEqual(self.call('DELETE', f'{self.base()}/admin/groups/{self.men}'),
                         (404, {'error': 'group_not_found'}))
        # the stale ID stays on the member but is not listed
        status, rows = self.call('GET', f'{self.base()}/admin/members')
        self.assertEqual({r['userId']: r['groups'] for r in rows}[self.other], [])

    def test_group_name_unique_ignoring_case(self):
        self.assertEqual(self.call('POST', f'{self.base()}/admin/groups', body={'name': '  wOmen '}),
                         (409, {'error': 'group_name_taken'}))
        self.assertEqual(self.call('POST', f'{self.base()}/admin/groups', body={'name': ''}),
                         (400, {'error': 'invalid_name'}))
        self.assertEqual(self.call('POST', f'{self.base()}/admin/groups', body={'name': 'x' * 61}),
                         (400, {'error': 'invalid_name'}))
        self.assertEqual(self.call('POST', f'{self.base()}/admin/groups', body={'name': 'ש' * 60})[0], 201)

    def test_twenty_groups_max(self):
        for i in range(18):
            self.make_group(f'G{i}')
        self.assertEqual(self.call('POST', f'{self.base()}/admin/groups', body={'name': 'over'}),
                         (409, {'error': 'too_many_groups'}))

    def test_member_cannot_manage_groups(self):
        base = f'{self.base()}/admin/groups'
        for method, path, body in (('GET', base, None), ('POST', base, {'name': 'Z'}),
                                   ('PUT', f'{base}/{self.women}', {'name': 'Z'}), ('DELETE', f'{base}/{self.women}', None)):
            self.assertEqual(self.call(method, path, sub='member-sub', body=body)[0], 403, method)


@own_tests_only
@mock_aws
class GroupsImportTest(test_import.ImportTest):
    def setUp(self):
        super().setUp()
        self.women = self.repo.put_group(self.k, 'Women')['sk'][2:]
        self.youth = self.repo.put_group(self.k, 'Youth')['sk'][2:]

    def groups_of(self, email):
        return self.repo.get_membership(self.k, self.user_id_of(email)).get('groups', set())

    def test_import_adds_groups_by_name_never_removes(self):
        r = test_import.row()
        self.assertEqual(self.do_import([{**r, 'groups': [' women ']}])[1]['results'][0]['status'], 'created')
        self.assertEqual(self.groups_of(r['email']), {self.women})
        status, body = self.do_import([{**r, 'groups': ['YOUTH']}])
        self.assertEqual(body['results'][0]['status'], 'exists')
        self.assertEqual(self.groups_of(r['email']), {self.women, self.youth})
        self.do_import([r])
        self.do_import([{**r, 'groups': []}])
        self.assertEqual(self.groups_of(r['email']), {self.women, self.youth})

    def test_import_unknown_group_row_invalid(self):
        good = test_import.row(email='a@example.test', first='Ann')
        bad = test_import.row(email='b@example.test', first='Bob')
        status, body = self.do_import([{**good, 'groups': ['Women']}, {**bad, 'groups': ['Women', 'Nope']}])
        self.assertEqual(body['results'], [{'index': 0, 'status': 'created'},
                                           {'index': 1, 'status': 'invalid', 'error': 'unknown_group'}])
        self.assertEqual(self.groups_of('a@example.test'), {self.women})
        self.assertEqual(len(self.cognito_users()), 1)  # no account for the invalid row

    def test_import_invalid_groups_value(self):
        for bad in ('Women', [1], ['Women'] * 21, {'a': 1}):
            status, body = self.do_import([{**test_import.row(), 'groups': bad}])
            self.assertEqual(body['results'], [{'index': 0, 'status': 'invalid', 'error': 'invalid_groups'}], bad)


if __name__ == '__main__':
    unittest.main()
