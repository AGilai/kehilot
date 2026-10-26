import json
import time
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import push, push_worker, routes_changes
from server.tests.cloud import test_groups
from server.tests.cloud.test_groups import own_tests_only


@own_tests_only
@mock_aws
class GroupAdminsTest(test_groups.GroupsTest):
    """Group admins, join requests and listeners admitted to groups (spec 3c). Reuses the groups fixtures:
    gabbai, member (women), quiet (women), other (men), listener (no group)."""

    def g(self, group=None):
        return f'{self.base()}/groups/{group or self.women}'

    def appoint(self, user_id, group=None, expect=204):
        status, body = self.call('PUT', f'{self.base()}/admin/groups/{group or self.women}/admins/{user_id}')
        self.assertEqual(status, expect, body)
        return body

    def request(self, sub, group=None):
        return self.call('POST', f'{self.g(group)}/requests', sub=sub)

    def requests_of(self, sub='gabbai-sub', group=None):
        status, body = self.call('GET', f'{self.g(group)}/requests', sub=sub)
        self.assertEqual(status, 200, body)
        return body

    def approve(self, user_id, sub='gabbai-sub', group=None):
        return self.call('POST', f'{self.g(group)}/requests/{user_id}/approve', sub=sub)

    def test_listener_requests_and_admin_approves_then_reads_group_channel(self):
        mid = self.post('women-only')[1]['messageId']
        start_offset = [0]
        patcher = mock.patch.object(routes_changes, '_now_ms',
                                    side_effect=lambda: int((time.time() + start_offset[0]) * 1000))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.assertEqual(self.request('listener-sub'), (202, {}))
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub='listener-sub')[0], 404)
        self.assertEqual(self.approve(self.listener), (200, {}))
        self.assertEqual(self.requests_of(), [])
        self.assertEqual(self.repo.get_membership(self.k, self.listener)['groups'], {self.women})
        self.assertEqual(self.repo.get_membership(self.k, self.listener)['role'], 'listener')
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub='listener-sub')[0], 200)
        self.assertEqual(self.listed('listener-sub'), [mid])
        cursor = self.call('GET', f'{self.base()}/changes', sub='listener-sub')[1]['cursor']
        start_offset[0] = 10
        mid2 = self.post('women-only')[1]['messageId']
        status, feed = self.call('GET', f'{self.base()}/changes', sub='listener-sub', query={'since': cursor})
        self.assertEqual(status, 200)
        self.assertIn(mid2, json.dumps(feed))
        with mock.patch.object(push, 'enqueue'):
            recipients = push_worker.recipients(self.repo, 'message', self.k, mid2)
        self.assertIn(self.listener, recipients)

    def test_listener_in_group_cannot_post_announcement_or_be_target(self):
        self.request('listener-sub')
        self.approve(self.listener)
        self.assertEqual(self.post('women-only', sub='listener-sub')[0], 403)
        self.assertEqual(self.post('announcements', sub='listener-sub')[0], 403)
        channels = self.channel_names('listener-sub')
        self.assertFalse(channels['women-only']['canPost'])
        status, body = self.post('women-only', type='celebration', targetMemberId=self.listener)
        self.assertEqual((status, body), (400, {'error': 'invalid_target_member_id'}))
        mid = self.post('women-only')[1]['messageId']
        self.assertEqual(self.call('POST', f'{self.base()}/messages/{mid}/replies', sub='listener-sub',
                                   body={'body': 'hi'})[0], 403)

    def test_listener_in_group_still_403_on_directory(self):
        self.request('listener-sub')
        self.approve(self.listener)
        self.assertEqual(self.call('GET', f'{self.base()}/members', sub='listener-sub')[0], 403)
        status, body = self.call('GET', f'{self.base()}/members', sub='listener-sub',
                                 query={'channelId': self.wchan})
        self.assertEqual(status, 403)
        status, rows = self.call('GET', f'{self.base()}/members', sub='member-sub', query={'channelId': self.wchan})
        self.assertNotIn(self.listener, {r['userId'] for r in rows})

    def test_gabbai_is_implicit_admin(self):
        self.request('listener-sub')
        self.assertEqual([r['userId'] for r in self.requests_of()], [self.listener])
        self.assertEqual(self.call('GET', f'{self.g()}/members')[0], 200)
        status, groups = self.call('GET', f'{self.base()}/groups')
        self.assertTrue(all(row['isAdmin'] for row in groups))

    def test_appointed_admin_approves_only_own_group(self):
        self.appoint(self.member)
        self.request('listener-sub')
        self.request('listener-sub', self.men)
        self.assertEqual([r['userId'] for r in self.requests_of('member-sub')], [self.listener])
        self.assertEqual(self.call('GET', f'{self.g(self.men)}/requests', sub='member-sub'),
                         (403, {'error': 'forbidden'}))
        self.assertEqual(self.approve(self.listener, 'member-sub', self.men), (403, {'error': 'forbidden'}))
        self.assertEqual(self.call('DELETE', f'{self.g(self.men)}/requests/{self.listener}', sub='member-sub')[0], 403)
        self.assertEqual(self.call('GET', f'{self.g(self.men)}/members', sub='member-sub')[0], 403)
        self.assertEqual(self.approve(self.listener, 'member-sub'), (200, {}))
        status, rows = self.call('GET', f'{self.base()}/groups', sub='member-sub')
        by = {r['groupId']: r for r in rows}
        self.assertTrue(by[self.women]['isAdmin'])
        self.assertFalse(by[self.men]['isAdmin'])

    def test_member_cannot_approve(self):
        self.request('listener-sub')
        self.assertEqual(self.approve(self.listener, 'member-sub'), (403, {'error': 'forbidden'}))
        self.assertEqual(self.call('GET', f'{self.g()}/requests', sub='member-sub'), (403, {'error': 'forbidden'}))
        self.assertEqual(self.call('GET', f'{self.g()}/members', sub='member-sub'), (403, {'error': 'forbidden'}))
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/groups/{self.women}/admins/{self.quiet}',
                                   sub='member-sub')[0], 403)
        self.assertNotIn('groups', self.repo.get_membership(self.k, self.listener))

    def test_listener_cannot_be_appointed_admin(self):
        self.appoint(self.listener, expect=400)
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/groups/{self.women}/admins/{self.listener}'),
                         (400, {'error': 'invalid_role'}))
        self.assertNotIn('adminGroups', self.repo.get_membership(self.k, self.listener))
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/groups/{"0" * 26}/admins/{self.member}'),
                         (404, {'error': 'group_not_found'}))
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/groups/{self.women}/admins/{"0" * 26}'),
                         (404, {'error': 'member_not_found'}))
        self.appoint(self.gabbai)  # a gabbai is already an admin everywhere: no-op
        self.assertNotIn('adminGroups', self.repo.get_membership(self.k, self.gabbai))

    def test_appoint_adds_to_group(self):
        self.assertNotIn(self.women, self.repo.get_membership(self.k, self.other).get('groups', ()))
        self.appoint(self.other)
        item = self.repo.get_membership(self.k, self.other)
        self.assertEqual((item['adminGroups'], item['groups']), ({self.women}, {self.men, self.women}))

    def test_unappoint_keeps_membership(self):
        self.appoint(self.member)
        status, body = self.call('DELETE', f'{self.base()}/admin/groups/{self.women}/admins/{self.member}')
        self.assertEqual(status, 204, body)
        item = self.repo.get_membership(self.k, self.member)
        self.assertNotIn('adminGroups', item)
        self.assertEqual(item['groups'], {self.women})
        self.assertEqual(self.call('GET', f'{self.g()}/requests', sub='member-sub')[0], 403)

    def test_admin_removes_member_loses_channel_at_once(self):
        self.appoint(self.member)
        mid = self.post('women-only')[1]['messageId']
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub='quiet-sub')[0], 200)
        self.assertEqual(self.call('DELETE', f'{self.g()}/members/{self.quiet}', sub='member-sub')[0], 204)
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub='quiet-sub'),
                         (404, {'error': 'message_not_found'}))
        self.assertEqual(self.repo.get_membership(self.k, self.quiet)['role'], 'member')
        self.assertEqual(self.call('DELETE', f'{self.g()}/members/{self.quiet}', sub='member-sub'),
                         (404, {'error': 'member_not_found'}))

    def test_admin_cannot_remove_other_admin_gabbai_can(self):
        self.appoint(self.member)
        self.appoint(self.quiet)
        self.assertEqual(self.call('DELETE', f'{self.g()}/members/{self.quiet}', sub='member-sub'),
                         (403, {'error': 'forbidden'}))
        self.assertIn(self.women, self.repo.get_membership(self.k, self.quiet)['groups'])
        self.assertEqual(self.call('DELETE', f'{self.g()}/members/{self.quiet}')[0], 204)
        item = self.repo.get_membership(self.k, self.quiet)
        self.assertNotIn('adminGroups', item)
        self.assertNotIn(self.women, item.get('groups', ()))

    def test_group_members_listing(self):
        self.request('listener-sub')
        self.approve(self.listener)
        self.appoint(self.quiet)
        status, rows = self.call('GET', f'{self.g()}/members')
        self.assertEqual(status, 200)
        self.assertEqual([r['displayName'] for r in rows], ['Lior Listener', 'Mia Member', 'Quinn Quiet'])
        self.assertEqual({r['userId']: (r['role'], r['isAdmin']) for r in rows},
                         {self.listener: ('listener', False), self.member: ('member', False),
                          self.quiet: ('member', True)})

    def test_leave_group(self):
        self.appoint(self.member)
        self.assertEqual(self.call('DELETE', f'{self.g()}/members/me', sub='member-sub')[0], 204)
        item = self.repo.get_membership(self.k, self.member)
        self.assertNotIn('adminGroups', item)
        self.assertNotIn('groups', item)
        self.assertEqual(self.call('DELETE', f'{self.g()}/members/me', sub='member-sub')[0], 204)  # idempotent
        self.assertEqual(self.call('GET', f'{self.g()}/requests', sub='member-sub')[0], 403)

    def test_withdraw_request(self):
        self.request('listener-sub')
        self.assertEqual(self.call('DELETE', f'{self.g()}/requests/me', sub='listener-sub')[0], 204)
        self.assertEqual(self.requests_of(), [])
        self.assertEqual(self.call('DELETE', f'{self.g()}/requests/me', sub='listener-sub')[0], 204)
        self.assertEqual(self.approve(self.listener), (404, {'error': 'request_not_found'}))

    def test_reject_leaves_no_record(self):
        self.request('listener-sub')
        self.assertEqual(self.call('DELETE', f'{self.g()}/requests/{self.listener}')[0], 204)
        self.assertEqual(self.repo.get_group_request(self.k, self.women, self.listener), None)
        self.assertEqual(self.call('DELETE', f'{self.g()}/requests/{self.listener}')[0], 204)

    def test_repeat_request_no_second_push(self):
        with mock.patch.object(push, 'enqueue') as enqueue:
            self.assertEqual(self.request('listener-sub')[0], 202)
            self.assertEqual(self.request('listener-sub')[0], 202)
        enqueue.assert_called_once_with('group_request', self.k, self.women)
        item = self.repo.get_group_request(self.k, self.women, self.listener)
        self.assertEqual(set(item), {'pk', 'sk', 'userId', 'groupId', 'createdAt', 'expiresAt'})
        self.assertAlmostEqual(int(item['expiresAt']), time.time() + 30 * 86400, delta=60)
        self.assertEqual(len(self.requests_of()), 1)

    def test_request_when_already_in_group_is_409(self):
        with mock.patch.object(push, 'enqueue') as enqueue:
            self.assertEqual(self.request('member-sub'), (409, {'error': 'already_in_group'}))
        enqueue.assert_not_called()

    def test_cross_kehila_group_is_404(self):
        other_k = self.repo.create_kehila('Beit Other', {})
        foreign = self.repo.put_group(other_k, 'Foreign')['sk'][2:]
        self.assertEqual(self.request('member-sub', foreign), (404, {'error': 'group_not_found'}))
        self.assertEqual(self.request('member-sub', 'bad'), (404, {'error': 'group_not_found'}))
        self.assertEqual(self.call('GET', f'{self.g(foreign)}/requests'), (404, {'error': 'group_not_found'}))
        self.assertEqual(self.call('GET', f'{self.g(foreign)}/members'), (404, {'error': 'group_not_found'}))
        self.assertEqual(self.call('DELETE', f'{self.g(foreign)}/requests/me', sub='member-sub')[0], 204)

    def test_requests_list_skips_departed_members(self):
        self.request('listener-sub')
        self.request('other-sub')
        self.call('DELETE', f'{self.base()}/admin/members/{self.other}')
        status, rows = self.call('GET', f'{self.g()}/requests')
        self.assertEqual([(r['userId'], r['displayName'], r['role']) for r in rows],
                         [(self.listener, 'Lior Listener', 'listener')])
        self.assertIn('createdAt', rows[0])

    def test_approve_for_departed_member_is_404_and_drops_the_request(self):
        self.request('other-sub')
        self.call('DELETE', f'{self.base()}/admin/members/{self.other}')
        self.assertEqual(self.approve(self.other), (404, {'error': 'member_not_found'}))
        self.assertIsNone(self.repo.get_group_request(self.k, self.women, self.other))
        self.assertEqual(self.approve(self.other), (404, {'error': 'request_not_found'}))

    def test_requests_oldest_first(self):
        now = time.time()
        with mock.patch('time.time', return_value=now + 100):
            self.request('listener-sub')
        with mock.patch('time.time', return_value=now):
            self.request('other-sub')
        self.assertEqual([r['userId'] for r in self.requests_of()], [self.other, self.listener])

    def test_expired_requests_are_not_listed(self):
        self.request('listener-sub')
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'GR#{self.women}#{self.listener}'},
                                    UpdateExpression='SET expiresAt = :e', ExpressionAttributeValues={':e': 1})
        self.assertEqual(self.requests_of(), [])

    def test_group_request_push_goes_to_admins_else_gabbaim(self):
        for uid, token in ((self.gabbai, 'ExponentPushToken[g]'), (self.member, 'ExponentPushToken[m]'),
                           (self.quiet, 'ExponentPushToken[q]')):
            self.repo.put_device(uid, token, 'ios')
        self.assertEqual(push_worker.recipients(self.repo, 'group_request', self.k, self.women), [self.gabbai])
        self.appoint(self.member)
        self.assertEqual(push_worker.recipients(self.repo, 'group_request', self.k, self.women), [self.member])
        self.assertEqual(push_worker.recipients(self.repo, 'group_request', self.k, self.men), [self.gabbai])
        messages, owners = push_worker._build(self.repo, 'group_request', self.k, self.women)
        self.assertEqual([m['to'] for m in messages], ['ExponentPushToken[m]'])
        self.assertEqual(messages[0]['data'], {'kehila': self.k, 'screen': 'group_requests'})
        self.assertEqual(messages[0]['body'], 'בקשת הצטרפות לקבוצה')
        blob = json.dumps(messages, ensure_ascii=False)
        self.assertNotIn(self.women, blob)
        self.assertNotIn('Women', blob)

    def test_groups_list_for_listener_has_no_counts_or_names(self):
        self.request('listener-sub')
        status, rows = self.call('GET', f'{self.base()}/groups', sub='listener-sub')
        self.assertEqual(status, 200)
        self.assertEqual([r['name'] for r in rows], ['Men', 'Women'])
        for row in rows:
            self.assertEqual(set(row), {'groupId', 'name', 'isMember', 'isAdmin', 'requested'})
        by = {r['name']: r for r in rows}
        self.assertEqual((by['Women']['requested'], by['Men']['requested']), (True, False))
        self.assertFalse(by['Women']['isMember'])
        self.assertNotIn('Mia', json.dumps(rows))

    def test_kehila_route_lists_own_groups(self):
        self.appoint(self.member)
        status, body = self.call('GET', self.base(), sub='member-sub')
        self.assertEqual((body['groups'], body['adminGroups']), ([self.women], [self.women]))
        status, body = self.call('GET', self.base(), sub='listener-sub')
        self.assertEqual((body['groups'], body['adminGroups']), ([], []))

    def test_admin_groups_rows_count_admins_and_pending(self):
        self.appoint(self.member)
        self.request('listener-sub')
        status, rows = self.call('GET', f'{self.base()}/admin/groups')
        by = {r['name']: r for r in rows}
        self.assertEqual((by['Women']['adminCount'], by['Women']['pendingCount']), (1, 1))
        self.assertEqual((by['Men']['adminCount'], by['Men']['pendingCount']), (0, 0))


if __name__ == '__main__':
    unittest.main()
