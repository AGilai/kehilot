import json
import sys
import unittest
from pathlib import Path
from unittest import mock

from moto import mock_aws

from server.cloud import handler as handler_module
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table
from server.tests.cloud.test_handler import Context, event

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'tools'))
import kehila_admin  # noqa: E402

PROFILE = {'firstName': 'Dana', 'lastName': 'Test', 'lang': 'en'}


@mock_aws
class InviteLimitsTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.k = self.repo.create_kehila('Beit Test', {})
        self.gabbai = self.user('gab-sub')
        self.repo.put_membership(self.k, self.gabbai, 'gabbai')
        self.member = self.user('member-sub')
        self.repo.put_membership(self.k, self.member, 'member')
        self.base = f'/v1/kehilot/{self.k}'

    def call(self, method, path, sub='gab-sub', body=None):
        evt = event(method, path, sub=sub, body=json.dumps(body) if body is not None else None)
        response = handler_module.handler(evt, Context())
        return response['statusCode'], json.loads(response['body']) if response['body'] else None

    def user(self, sub):
        user_id = self.call('GET', '/v1/me', sub=sub)[1]['userId']
        self.call('PUT', '/v1/me/profile', sub=sub, body=PROFILE)
        return user_id

    def invite(self, sub='member-sub', **body):
        status, data = self.call('POST', f'{self.base}/invites', sub=sub, body=body)
        self.assertEqual(status, 201, data)
        return data['code']

    def expire(self, code):
        self.repo.table.update_item(Key={'pk': f'INV#{code}', 'sk': 'META'}, UpdateExpression='SET expiresAt = :e',
                                    ExpressionAttributeValues={':e': 1})
        for item in self.repo.table.scan()['Items']:
            if item['sk'].endswith(f'#{code}') and item['sk'].startswith('INVBY#'):
                self.repo.table.update_item(Key={'pk': item['pk'], 'sk': item['sk']},
                                            UpdateExpression='SET expiresAt = :e',
                                            ExpressionAttributeValues={':e': 1})

    def set_max(self, value, sub='gab-sub'):
        return self.call('PUT', f'{self.base}/admin/settings', sub=sub, body={'maxListeners': value})

    # 1. listener cap
    def test_cap_blocks_listener_invite_but_not_member_invite(self):
        self.assertEqual(self.set_max(1), (200, {}))
        first = self.invite()
        second = self.invite()
        self.user('l1')
        self.user('l2')
        self.assertEqual(self.call('POST', f'/v1/invites/{first}/accept', sub='l1')[0], 200)
        self.assertEqual(self.call('POST', f'/v1/invites/{second}/accept', sub='l2'), (409, {'error': 'kehila_full'}))
        member_code = self.invite(sub='gab-sub', role='member')
        self.assertEqual(self.call('POST', f'/v1/invites/{member_code}/accept', sub='l2')[0], 200)
        self.assertEqual(self.repo.get_membership(self.k, self.repo.get_user_id('l2'))['role'], 'member')

    def test_cap_zero_means_no_new_listeners(self):
        self.set_max(0)
        code = self.invite()
        self.user('l1')
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='l1'), (409, {'error': 'kehila_full'}))

    def test_cap_counts_across_pages_and_ignores_members(self):
        for n in range(3):
            self.repo.put_membership(self.k, f'0000000000000000000000000{n}', 'listener')
        real = self.repo.table.query
        calls = []

        def one_at_a_time(**kwargs):
            calls.append(kwargs)
            return real(Limit=1, **kwargs)

        with mock.patch.object(self.repo.table, 'query', side_effect=one_at_a_time):
            self.assertEqual(self.repo.count_listeners(self.k), 3)
        self.assertGreater(len(calls), 3)  # the gabbai, the member and 3 listeners took several pages
        self.assertEqual(calls[0]['Select'], 'COUNT')

    def test_default_cap_is_500(self):
        status, body = self.call('GET', self.base)
        self.assertEqual(body['settings']['maxListeners'], 500)
        self.assertEqual(body['listenerCount'], 0)

    def test_settings_gabbai_only_validated_and_keeps_other_settings(self):
        self.assertEqual(self.set_max(7), (200, {}))
        self.assertEqual(self.call('GET', self.base)[1]['settings']['maxListeners'], 7)
        self.assertEqual(self.repo.get_kehila(self.k)['settings']['pollSeconds'], 30)
        self.assertEqual(self.set_max(7, sub='member-sub')[0], 403)
        for bad in (-1, 5001, '5', True, 1.5, None):
            self.assertEqual(self.set_max(bad), (400, {'error': 'invalid_max_listeners'}), bad)
        self.assertEqual(self.set_max(0)[0], 200)
        self.assertEqual(self.set_max(5000)[0], 200)

    def test_kehila_hides_cap_and_count_from_non_gabbai(self):
        body = self.call('GET', self.base, sub='member-sub')[1]
        self.assertEqual(body['settings'], {'pollSeconds': 30})
        self.assertNotIn('listenerCount', body)
        self.user('l1')
        self.repo.put_membership(self.k, self.repo.get_user_id('l1'), 'listener')
        self.assertEqual(self.call('GET', self.base)[1]['listenerCount'], 1)

    # 2. member limit
    def test_members_fourth_active_listener_link_is_409(self):
        for _ in range(3):
            self.invite()
        self.assertEqual(self.call('POST', f'{self.base}/invites', sub='member-sub', body={}),
                         (409, {'error': 'too_many_invites'}))
        self.assertEqual(self.call('POST', f'{self.base}/invites', sub='member-sub', body={'days': 1})[0], 409)

    def test_expired_link_does_not_count(self):
        codes = [self.invite() for _ in range(3)]
        self.expire(codes[0])
        self.invite()

    def test_gabbai_has_no_limit(self):
        for _ in range(5):
            self.invite(sub='gab-sub')

    def test_marker_item_shape(self):
        code = self.invite()
        marker = self.repo._get(f'K#{self.k}', f'INVBY#{self.member}#{code}')
        self.assertEqual(marker['role'], 'listener')
        self.assertEqual(marker['expiresAt'], self.repo.get_invite(code)['expiresAt'])
        self.assertIn('createdAt', marker)

    # 3. list and revoke
    def test_list_gabbai_sees_all_member_sees_own(self):
        mine = self.invite()
        theirs = self.invite(sub='gab-sub', role='member')
        status, rows = self.call('GET', f'{self.base}/invites')
        self.assertEqual(status, 200)
        self.assertEqual({r['code']: r['mine'] for r in rows}, {mine: False, theirs: True})
        self.assertEqual(set(rows[0]), {'code', 'role', 'usesLeft', 'expiresAt', 'mine'})
        by_code = {r['code']: r for r in rows}
        self.assertEqual((by_code[mine]['role'], by_code[mine]['usesLeft']), ('listener', 10))
        status, rows = self.call('GET', f'{self.base}/invites', sub='member-sub')
        self.assertEqual([(r['code'], r['mine']) for r in rows], [(mine, True)])

    def test_list_skips_expired_and_listener_is_403(self):
        code = self.invite()
        self.expire(code)
        self.assertEqual(self.call('GET', f'{self.base}/invites')[1], [])
        self.user('l1')
        self.repo.put_membership(self.k, self.repo.get_user_id('l1'), 'listener')
        self.assertEqual(self.call('GET', f'{self.base}/invites', sub='l1')[0], 403)

    def test_revoke_by_inviter(self):
        code = self.invite()
        self.assertEqual(self.call('DELETE', f'{self.base}/invites/{code}', sub='member-sub'), (204, None))
        self.assertIsNone(self.repo.get_invite(code))
        self.assertIsNone(self.repo._get(f'K#{self.k}', f'INVBY#{self.member}#{code}'))
        self.assertEqual(self.call('GET', f'/v1/invites/{code}', sub='member-sub')[0], 404)

    def test_revoke_by_gabbai_and_lowercase_code(self):
        code = self.invite()
        self.assertEqual(self.call('DELETE', f'{self.base}/invites/{code.lower()}')[0], 204)
        self.assertIsNone(self.repo.get_invite(code))

    def test_revoke_by_other_member_is_403(self):
        code = self.invite()
        self.user('m2')
        self.repo.put_membership(self.k, self.repo.get_user_id('m2'), 'member')
        self.assertEqual(self.call('DELETE', f'{self.base}/invites/{code}', sub='m2')[0], 403)
        self.assertIsNotNone(self.repo.get_invite(code))

    def test_revoke_cross_kehila_code_looks_missing(self):
        other = self.repo.create_kehila('Beit Other', {})
        code = self.repo.create_invite(other, 'someone', 'listener', 1, 7)
        self.assertEqual(self.call('DELETE', f'{self.base}/invites/{code}'), (404, {'error': 'invite_not_found'}))
        self.assertEqual(self.call('DELETE', f'{self.base}/invites/ZZZZZZZZZZ'), (404, {'error': 'invite_not_found'}))
        self.assertIsNotNone(self.repo.get_invite(code))

    def test_purge_removes_markers_and_invites(self):
        code = self.invite()
        expired = self.invite()
        self.expire(expired)
        other_code = self.invite(sub='gab-sub')
        self.repo.purge_user(self.member, 'member-sub')
        for gone in (code, expired):
            self.assertIsNone(self.repo.get_invite(gone))
            self.assertIsNone(self.repo._get(f'K#{self.k}', f'INVBY#{self.member}#{gone}'))
        self.assertIsNotNone(self.repo.get_invite(other_code))
        self.assertIsNotNone(self.repo._get(f'K#{self.k}', f'INVBY#{self.gabbai}#{other_code}'))

    # leaving or removal revokes the person's links
    def other_member(self):
        self.user('m2')
        uid = self.repo.get_user_id('m2')
        self.repo.put_membership(self.k, uid, 'member')
        return uid

    def check_links_revoked(self, act):
        mine = [self.invite(), self.invite()]
        m2 = self.other_member()
        kept = self.invite(sub='m2')
        act()
        self.user('l9')
        for code in mine:
            status = self.call('POST', f'/v1/invites/{code}/accept', sub='l9')[0]
            self.assertIn(status, (404, 410))
            self.assertIsNone(self.repo._get(f'K#{self.k}', f'INVBY#{self.member}#{code}'))
        self.assertEqual([r['code'] for r in self.call('GET', f'{self.base}/invites')[1]], [kept])
        self.assertIsNotNone(self.repo._get(f'K#{self.k}', f'INVBY#{m2}#{kept}'))
        self.assertEqual(self.call('POST', f'/v1/invites/{kept}/accept', sub='l9')[0], 200)

    def test_leave_revokes_links(self):
        self.check_links_revoked(lambda: self.assertEqual(
            self.call('DELETE', f'{self.base}/membership', sub='member-sub')[0], 204))

    def test_removal_revokes_links(self):
        self.check_links_revoked(lambda: self.assertEqual(
            self.call('DELETE', f'{self.base}/admin/members/{self.member}')[0], 204))

    # 4. CLI
    def test_cli_gabbai_invite(self):
        import io
        from contextlib import redirect_stdout
        out = io.StringIO()
        with mock.patch.object(kehila_admin, 'open_repo', return_value=self.repo), redirect_stdout(out):
            kehila_admin.main(['gabbai-invite', '--env', 'dev', '--kehila', self.k])
        code = out.getvalue().strip().split()[-1]
        invite = self.repo.get_invite(code)
        self.assertEqual((invite['role'], invite['usesLeft'], invite['kehilaId']), ('gabbai', 1, self.k))
        self.assertAlmostEqual(int(invite['expiresAt']), __import__('time').time() + 7 * 86400, delta=60)
        self.user('new-gab')
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='new-gab')[1]['role'], 'gabbai')

    def test_cli_gabbai_invite_missing_kehila_exits(self):
        with mock.patch.object(kehila_admin, 'open_repo', return_value=self.repo):
            with self.assertRaises(SystemExit) as raised:
                kehila_admin.main(['gabbai-invite', '--env', 'dev', '--kehila', '0' * 26])
        self.assertIn('does not exist', str(raised.exception))

    def test_cli_region_from_terraform_when_unset(self):
        with mock.patch.dict('os.environ', {}, clear=False) as env:
            env.pop('AWS_DEFAULT_REGION', None)
            env.pop('AWS_REGION', None)
            with mock.patch.object(kehila_admin, 'terraform_output', return_value='il-central-1') as tf, \
                    mock.patch('boto3.resource') as resource:
                kehila_admin.open_repo('dev')
        tf.assert_any_call('dev', 'region')
        self.assertEqual(resource.call_args.kwargs['region_name'], 'il-central-1')


if __name__ == '__main__':
    unittest.main()
