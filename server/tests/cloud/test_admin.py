import json
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import handler as handler_module
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table
from server.tests.cloud.test_handler import Context, event

PROFILE = {'firstName': 'Dana', 'lastName': 'Test', 'lang': 'en'}


@mock_aws
class AdminTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.k = self.repo.create_kehila('Beit Test', {})
        self.gabbai = self.user('gabbai-sub')
        self.repo.put_membership(self.k, self.gabbai, 'gabbai')
        self.listener = self.user('listener-sub')
        self.put_listener(self.listener)

    def put_listener(self, user_id):
        self.repo.put_membership(self.k, user_id, 'listener')
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{user_id}'},
                                    UpdateExpression='SET displayName = :n, canBroadcast = :f',
                                    ExpressionAttributeValues={':n': 'Dana Test', ':f': False})

    def call(self, method, path, sub='gabbai-sub', body=None):
        evt = event(method, path, sub=sub, body=json.dumps(body) if body is not None else None)
        response = handler_module.handler(evt, Context())
        return response['statusCode'], json.loads(response['body']) if response['body'] else None

    def user(self, sub):
        user_id = self.call('GET', '/v1/me', sub=sub)[1]['userId']
        self.call('PUT', '/v1/me/profile', sub=sub, body=PROFILE)
        return user_id

    def base(self):
        return f'/v1/kehilot/{self.k}'

    def approve(self, user_id, classification='', sub='gabbai-sub'):
        return self.call('POST', f'{self.base()}/admin/requests/{user_id}/approve', sub=sub,
                         body={'classification': classification})

    def test_listener_requests_and_gabbai_approves_with_classification(self):
        self.assertEqual(self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')[0], 202)
        self.assertEqual(self.call('POST', f'{self.base()}/membership-request', sub='listener-sub'),
                         (409, {'error': 'already_requested'}))
        status, body = self.call('GET', f'{self.base()}/admin/requests')
        self.assertEqual(status, 200)
        self.assertEqual(len(body), 1)
        self.assertEqual((body[0]['userId'], body[0]['displayName'], body[0]['previouslyRejected']),
                         (self.listener, 'Dana Test', False))
        self.assertIn('createdAt', body[0])
        self.assertEqual(self.approve(self.listener, 'קבוע')[0], 200)
        membership = self.repo.get_membership(self.k, self.listener)
        self.assertEqual((membership['role'], membership['classification'], membership['canBroadcast']),
                         ('member', 'קבוע', False))
        self.assertEqual(self.call('GET', f'{self.base()}/admin/requests')[1], [])
        self.assertEqual(self.approve(self.listener)[0], 404)
        self.assertEqual(self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')[0], 403)

    def test_invalid_classification_and_non_listener_request(self):
        self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')
        self.assertEqual(self.approve(self.listener, 'x'), (400, {'error': 'invalid_classification'}))
        self.assertEqual(self.call('POST', f'{self.base()}/membership-request', sub='gabbai-sub')[0], 403)

    def test_member_cannot_see_requests(self):
        member = self.user('member-sub')
        self.repo.put_membership(self.k, member, 'member')
        self.assertEqual(self.call('GET', f'{self.base()}/admin/requests', sub='member-sub'),
                         (403, {'error': 'forbidden'}))
        self.assertEqual(self.call('GET', f'{self.base()}/admin/members', sub='member-sub')[0], 403)

    def test_approve_uses_kehila_broadcast_default(self):
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/broadcast', body={'allow': True})[0], 200)
        self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')
        self.approve(self.listener, 'א')
        self.assertTrue(self.repo.get_membership(self.k, self.listener)['canBroadcast'])

    def test_reject_then_rerequest_flags_previously_rejected(self):
        self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')
        status, _ = self.call('POST', f'{self.base()}/admin/requests/{self.listener}/reject')
        self.assertEqual(status, 200)
        membership = self.repo.get_membership(self.k, self.listener)
        self.assertEqual(membership['role'], 'listener')
        self.assertIn('rejectedAt', membership)
        self.assertEqual(self.call('GET', f'{self.base()}/admin/requests')[1], [])
        self.assertEqual(self.call('POST', f'{self.base()}/admin/requests/{self.listener}/reject')[0], 404)
        self.assertEqual(self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')[0], 202)
        self.assertTrue(self.call('GET', f'{self.base()}/admin/requests')[1][0]['previouslyRejected'])

    def test_bulk_broadcast_block_all_then_allow_one(self):
        members = []
        for sub in ('m1', 'm2'):
            user_id = self.user(sub)
            self.repo.put_membership(self.k, user_id, 'member')
            members.append(user_id)
        self.call('PUT', f'{self.base()}/admin/broadcast', body={'allow': True})
        self.assertTrue(all(self.repo.get_membership(self.k, m)['canBroadcast'] for m in members))
        self.call('PUT', f'{self.base()}/admin/broadcast', body={'allow': False})
        self.assertFalse(any(self.repo.get_membership(self.k, m)['canBroadcast'] for m in members))
        self.assertFalse(self.repo.get_kehila(self.k)['settings']['memberBroadcastDefault'])
        status, _ = self.call('PUT', f'{self.base()}/admin/members/{members[0]}', body={'canBroadcast': True})
        self.assertEqual(status, 200)
        self.assertTrue(self.repo.get_membership(self.k, members[0])['canBroadcast'])
        self.assertFalse(self.repo.get_membership(self.k, members[1])['canBroadcast'])
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/broadcast', body={'allow': 'yes'})[0], 400)
        listed = self.call('GET', f'{self.base()}/admin/members')[1]
        self.assertEqual({m['userId'] for m in listed}, {self.gabbai, self.listener, *members})
        self.assertEqual({'userId', 'displayName', 'role', 'classification', 'canBroadcast', 'phone', 'showPhone', 'groups', 'tags'}, set(listed[0]))

    def test_last_gabbai_cannot_be_demoted_or_leave(self):
        path = f'{self.base()}/admin/members/{self.gabbai}'
        self.assertEqual(self.call('PUT', path, body={'role': 'member'}), (409, {'error': 'last_gabbai'}))
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership'), (409, {'error': 'last_gabbai'}))
        self.assertEqual(self.call('DELETE', path), (409, {'error': 'last_gabbai'}))
        self.assertEqual(self.repo.get_membership(self.k, self.gabbai)['role'], 'gabbai')
        # with a second gabbai the first may step down, then the second is the last
        second = self.user('g2')
        self.repo.put_membership(self.k, second, 'gabbai')
        self.assertEqual(self.call('PUT', path, body={'role': 'member'})[0], 200)
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='g2'),
                         (409, {'error': 'last_gabbai'}))
        self.assertEqual(self.call('PUT', path, sub='gabbai-sub', body={'role': 'gabbai'})[0], 403)

    def test_mutual_demotion_leaves_a_gabbai(self):
        other = self.user('g2')
        self.repo.put_membership(self.k, other, 'gabbai')
        real = self.repo._guarded
        calls = []

        def racing(*args, **kwargs):
            # the other gabbai demotes himself after our witness was chosen, before our transaction
            if not calls:
                calls.append(1)
                self.assertEqual(self.call('PUT', f'{self.base()}/admin/members/{other}', sub='g2',
                                           body={'role': 'member'})[0], 200)
            return real(*args, **kwargs)
        with mock.patch.object(self.repo, '_guarded', side_effect=racing):
            status, body = self.call('PUT', f'{self.base()}/admin/members/{self.gabbai}', body={'role': 'member'})
        self.assertEqual((status, body), (409, {'error': 'last_gabbai'}))
        self.assertEqual(self.repo.get_membership(self.k, self.gabbai)['role'], 'gabbai')

    def test_role_changes_only_between_member_and_gabbai(self):
        path = f'{self.base()}/admin/members/{self.listener}'
        self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')
        for role in ('member', 'gabbai', 'listener'):
            self.assertEqual(self.call('PUT', path, body={'role': role}), (409, {'error': 'role_change_not_allowed'}))
        self.assertEqual(self.repo.get_membership(self.k, self.listener)['role'], 'listener')
        self.assertEqual(len(self.call('GET', f'{self.base()}/admin/requests')[1]), 1)
        self.assertEqual(self.call('PUT', path, body={'role': 'boss'}), (400, {'error': 'invalid_role'}))
        self.assertEqual(self.call('PUT', path, body={'canBroadcast': True})[0], 200)
        member = self.user('m1')
        self.repo.put_membership(self.k, member, 'member')
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/members/{member}', body={'role': 'listener'})[0], 409)
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/members/{member}', body={'role': 'gabbai'})[0], 200)

    def test_role_change_condition_holds_in_the_write(self):
        # the caller saw a member, but he became a listener meanwhile: the write itself refuses
        member = self.user('m1')
        self.repo.put_membership(self.k, member, 'listener')
        with self.assertRaises(handler_module.ApiError) as ctx:
            self.repo.update_member(self.k, member, 'listener', {'role': 'member'})
        self.assertEqual(ctx.exception.code, 'try_again')
        self.assertEqual(self.repo.get_membership(self.k, member)['role'], 'listener')

    def test_bulk_broadcast_skips_member_that_changed_mid_loop(self):
        from botocore.exceptions import ClientError
        members = []
        for sub in ('m1', 'm2', 'm3'):
            user_id = self.user(sub)
            self.repo.put_membership(self.k, user_id, 'member')
            members.append(user_id)
        real = self.repo.table.update_item
        failing = f'M#{members[1]}'

        def update_item(**kwargs):
            if kwargs['Key']['sk'] == failing:
                raise ClientError({'Error': {'Code': 'ConditionalCheckFailedException'}}, 'UpdateItem')
            return real(**kwargs)
        with mock.patch.object(self.repo.table, 'update_item', side_effect=update_item):
            status, _ = self.call('PUT', f'{self.base()}/admin/broadcast', body={'allow': True})
        self.assertEqual(status, 200)
        flags = [bool(self.repo.get_membership(self.k, m).get('canBroadcast')) for m in members]
        self.assertEqual(flags, [True, False, True])

    def test_remove_member_and_leave(self):
        member = self.user('member-sub')
        self.repo.put_membership(self.k, member, 'member')
        self.assertEqual(self.call('DELETE', f'{self.base()}/admin/members/{member}')[0], 204)
        self.assertIsNone(self.repo.get_membership(self.k, member))
        self.assertEqual(self.call('DELETE', f'{self.base()}/admin/members/{member}')[0], 404)
        self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='listener-sub')[0], 204)
        self.assertEqual(self.call('GET', f'{self.base()}/admin/requests')[1], [])

    def import_account(self, sub='import-sub', second_kehila=False):
        user = self.call('GET', '/v1/me', sub=sub)[1]['userId']  # creates the mapping; then mark as imported
        self.repo.table.update_item(Key={'pk': f'U#{sub}', 'sk': 'SUB'}, UpdateExpression='REMOVE neverSignedIn')
        self.repo.mark_imported_account(sub, user)
        self.repo.put_membership(self.k, user, 'member')
        if second_kehila:
            self.repo.put_membership(self.repo.create_kehila('Beit Two', {}), user, 'listener')
        return user

    def test_gabbai_removing_never_signed_in_import_deletes_account(self):
        user = self.import_account()
        self.repo.put_profile(user, 'Dana', 'Test', 'he')
        with mock.patch('server.cloud.routes_me._delete_cognito_user') as delete:
            self.assertEqual(self.call('DELETE', f'{self.base()}/admin/members/{user}')[0], 204)
        delete.assert_called_once_with('import-sub')
        for item in self.repo.table.scan()['Items']:
            if item['pk'] != 'U#import-sub':
                self.assertNotIn(user, json.dumps(item, default=str))
        self.assertTrue(self.repo.get_sub('import-sub')['deleted'])

    def test_removing_signed_in_or_multi_kehila_import_keeps_account(self):
        signed = self.import_account('signed-sub')
        self.repo.mark_imported_account('signed-sub', signed)
        self.call('GET', '/v1/me', sub='signed-sub')  # first API call clears the flag
        multi = self.import_account('multi-sub', second_kehila=True)
        with mock.patch('server.cloud.routes_me._delete_cognito_user') as delete:
            self.assertEqual(self.call('DELETE', f'{self.base()}/admin/members/{signed}')[0], 204)
            self.assertEqual(self.call('DELETE', f'{self.base()}/admin/members/{multi}')[0], 204)
        delete.assert_not_called()
        self.assertEqual(self.repo.get_user_id('signed-sub'), signed)
        self.assertEqual(self.repo.get_user_id('multi-sub'), multi)

    def test_stale_gsi_still_listing_removed_kehila_still_deletes(self):
        user = self.import_account()
        stale = [{'kehilaId': self.k, 'role': 'member'}]
        with mock.patch('server.cloud.routes_me._delete_cognito_user') as delete, \
                mock.patch.object(Repo, 'list_memberships', return_value=stale):
            self.assertEqual(self.call('DELETE', f'{self.base()}/admin/members/{user}')[0], 204)
        delete.assert_called_once_with('import-sub')

    def test_purge_failure_means_cognito_not_called(self):
        user = self.import_account()
        with mock.patch('server.cloud.routes_me._delete_cognito_user') as delete, \
                mock.patch.object(Repo, 'purge_user', side_effect=RuntimeError('x')):
            self.assertEqual(self.call('DELETE', f'{self.base()}/admin/members/{user}')[0], 500)
        delete.assert_not_called()

    def test_cognito_failure_after_purge_still_204(self):
        user = self.import_account()
        with mock.patch('server.cloud.routes_me._delete_cognito_user', side_effect=RuntimeError('x')):
            self.assertEqual(self.call('DELETE', f'{self.base()}/admin/members/{user}')[0], 204)
        self.assertIsNone(self.repo.get_user_id('import-sub'))  # purged first: only the Cognito user is left

    def test_gabbai_of_other_kehila_cannot_approve(self):
        other_k = self.repo.create_kehila('Beit Other', {})
        outsider = self.user('outsider-sub')
        self.repo.put_membership(other_k, outsider, 'gabbai')
        self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')
        self.assertEqual(self.approve(self.listener, sub='outsider-sub'), (404, {'error': 'kehila_not_found'}))
        self.assertEqual(self.repo.get_membership(self.k, self.listener)['role'], 'listener')


if __name__ == '__main__':
    unittest.main()
