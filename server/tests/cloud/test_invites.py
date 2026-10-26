import json
import time
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import handler as handler_module
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table
from server.tests.cloud.test_handler import Context, event

PROFILE = {'firstName': 'Dana', 'lastName': 'Test', 'lang': 'en'}


@mock_aws
class InvitesTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.k = self.repo.create_kehila('Beit Test', {})
        self.member = self.user('member-sub')
        self.repo.put_membership(self.k, self.member, 'member')

    def call(self, method, path, sub='s1', body=None):
        evt = event(method, path, sub=sub, body=json.dumps(body) if body is not None else None)
        if sub is None:
            del evt['requestContext']['authorizer']
        response = handler_module.handler(evt, Context())
        return response['statusCode'], json.loads(response['body']) if response['body'] else None

    def user(self, sub, profile=True):
        user_id = self.call('GET', '/v1/me', sub=sub)[1]['userId']
        if profile:
            self.call('PUT', '/v1/me/profile', sub=sub, body=PROFILE)
        return user_id

    def test_create_kehila_writes_default_channels(self):
        items = self.repo.table.query(
            KeyConditionExpression='pk = :p AND begins_with(sk, :s)',
            ExpressionAttributeValues={':p': f'K#{self.k}', ':s': 'C#'})['Items']
        by_name = {i['name']: i for i in items}
        self.assertEqual(set(by_name), {'announcements', 'simchas', 'condolences'})
        self.assertEqual((by_name['announcements']['listenersCanRead'], by_name['announcements']['postPolicy']),
                         (True, 'management'))
        for name in ('simchas', 'condolences'):
            self.assertEqual((by_name[name]['listenersCanRead'], by_name[name]['postPolicy']), (False, 'broadcasters'))
        self.assertEqual(self.repo.get_kehila(self.k)['settings'], {
            'pollSeconds': 30, 'memberBroadcastDefault': False, 'broadcastDailyLimit': 3, 'defaultLang': 'he'})

    def test_member_creates_listener_invite(self):
        status, body = self.call('POST', f'/v1/kehilot/{self.k}/invites', sub='member-sub', body={})
        self.assertEqual(status, 201)
        self.assertEqual(len(body['code']), 10)
        invite = self.repo.get_invite(body['code'])
        self.assertEqual((invite['role'], invite['usesLeft'], invite['kehilaId']), ('listener', 10, self.k))
        self.assertAlmostEqual(body['expiresAt'], time.time() + 7 * 86400, delta=60)
        status, body = self.call('POST', f'/v1/kehilot/{self.k}/invites', sub='member-sub', body={'uses': 51})
        self.assertEqual((status, body), (400, {'error': 'invalid_uses'}))

    def test_listener_cannot_create_invite(self):
        listener = self.user('listener-sub')
        self.repo.put_membership(self.k, listener, 'listener')
        status, body = self.call('POST', f'/v1/kehilot/{self.k}/invites', sub='listener-sub', body={})
        self.assertEqual((status, body), (403, {'error': 'forbidden'}))

    def test_preview_is_public_and_shows_only_name(self):
        code = self.repo.create_invite(self.k, self.member, 'listener', 1, 7)
        status, body = self.call('GET', f'/v1/invites/{code}', sub=None)
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {'kehilaName'})
        self.assertEqual(body['kehilaName'], 'Beit Test')
        self.assertEqual(self.call('GET', '/v1/invites/NOSUCHCODE1', sub=None), (404, {'error': 'invite_not_found'}))

    def test_preview_expired_or_used_up_is_410(self):
        code = self.repo.create_invite(self.k, self.member, 'listener', 1, 7)
        self.repo.table.update_item(Key={'pk': f'INV#{code}', 'sk': 'META'},
                                    UpdateExpression='SET expiresAt = :e', ExpressionAttributeValues={':e': 1})
        self.assertEqual(self.call('GET', f'/v1/invites/{code}', sub=None), (410, {'error': 'invite_expired'}))
        used = self.repo.create_invite(self.k, self.member, 'listener', 1, 7)
        self.repo.accept_invite(used, self.user('u1'), 'Dana T', int(time.time()))
        self.assertEqual(self.call('GET', f'/v1/invites/{used}', sub=None), (410, {'error': 'invite_expired'}))

    def test_accept_makes_listener(self):
        code = self.repo.create_invite(self.k, self.member, 'listener', 5, 7)
        uid = self.user('new-sub')
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='new-sub'),
                         (200, {'kehilaId': self.k, 'role': 'listener'}))
        membership = self.repo.get_membership(self.k, uid)
        self.assertEqual((membership['role'], membership['displayName'], membership['canBroadcast']),
                         ('listener', 'Dana Test', False))
        self.assertEqual(self.repo.get_invite(code)['usesLeft'], 4)

    def test_gabbai_invite_makes_gabbai(self):
        code = self.repo.create_invite(self.k, 'admin-cli', 'gabbai', 1, 7)
        self.user('g-sub')
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='g-sub'),
                         (200, {'kehilaId': self.k, 'role': 'gabbai'}))

    def test_last_invite_use_is_consumed_once(self):
        code = self.repo.create_invite(self.k, self.member, 'listener', 1, 7)
        self.user('a-sub'), self.user('b-sub')
        # The route must not pre-read usesLeft: the second accept has to fail on the transaction condition.
        with mock.patch.object(Repo, 'get_invite', wraps=self.repo.get_invite) as spy:
            first = self.call('POST', f'/v1/invites/{code}/accept', sub='a-sub')
            second = self.call('POST', f'/v1/invites/{code}/accept', sub='b-sub')
        self.assertEqual(first[0], 200)
        self.assertEqual(second, (410, {'error': 'invite_expired'}))
        self.assertEqual(self.repo.get_invite(code)['usesLeft'], 0)
        self.assertTrue(spy.called)

    def test_expired_invite_rejected_before_ttl_deletes_it(self):
        code = self.repo.create_invite(self.k, self.member, 'listener', 5, 7)
        self.repo.table.update_item(Key={'pk': f'INV#{code}', 'sk': 'META'},
                                    UpdateExpression='SET expiresAt = :e', ExpressionAttributeValues={':e': 1})
        self.user('late-sub')
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='late-sub'),
                         (410, {'error': 'invite_expired'}))
        self.assertIsNotNone(self.repo.get_invite(code))

    def test_accept_twice_is_409(self):
        code = self.repo.create_invite(self.k, self.member, 'listener', 5, 7)
        self.user('twice-sub')
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='twice-sub')[0], 200)
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='twice-sub'),
                         (409, {'error': 'already_member'}))
        self.assertEqual(self.repo.get_invite(code)['usesLeft'], 4)

    def test_accept_twice_on_last_use_is_409(self):
        code = self.repo.create_invite(self.k, self.member, 'listener', 1, 7)
        self.user('twice-sub')
        self.call('POST', f'/v1/invites/{code}/accept', sub='twice-sub')
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='twice-sub'),
                         (409, {'error': 'already_member'}))

    def test_accept_without_profile_is_409(self):
        code = self.repo.create_invite(self.k, self.member, 'listener', 5, 7)
        self.user('noprof-sub', profile=False)
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='noprof-sub'),
                         (409, {'error': 'profile_required'}))
        self.assertEqual(self.repo.get_invite(code)['usesLeft'], 5)

    def test_accept_unknown_code_is_404(self):
        self.user('x-sub')
        self.assertEqual(self.call('POST', '/v1/invites/NOSUCHCODE1/accept', sub='x-sub'),
                         (404, {'error': 'invite_not_found'}))

    def test_lowercase_code_previews_and_accepts(self):
        code = self.repo.create_invite(self.k, self.member, 'listener', 5, 7)
        self.user('lc-sub')
        self.assertEqual(self.call('GET', f'/v1/invites/{code.lower()}', sub=None), (200, {'kehilaName': 'Beit Test'}))
        self.assertEqual(self.call('POST', f'/v1/invites/{code.lower()}/accept', sub='lc-sub')[0], 200)

    def test_confusable_letters_are_normalized(self):
        from server.cloud.repo_members import normalize_code
        self.assertEqual(normalize_code(' ab0il '), 'AB011')

    def test_transaction_conflict_is_409_try_again(self):
        from botocore.exceptions import ClientError
        code = self.repo.create_invite(self.k, self.member, 'listener', 5, 7)
        self.user('tc-sub')
        conflict = ClientError({'Error': {'Code': 'TransactionCanceledException'},
                                'CancellationReasons': [{'Code': 'TransactionConflict'}, {'Code': 'None'}]},
                               'TransactWriteItems')
        with mock.patch.object(self.repo.table.meta.client, 'transact_write_items', side_effect=conflict):
            self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='tc-sub'),
                             (409, {'error': 'try_again'}))

    def test_alphabet_never_produces_confusable_letters(self):
        from server.cloud.repo_members import CROCKFORD
        self.assertFalse(set('ILOU') & set(CROCKFORD))


class AdminCliTest(unittest.TestCase):
    @mock_aws
    def test_create_kehila_with_gabbai_invite(self):
        import sys
        from pathlib import Path
        sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'tools'))
        import kehila_admin
        repo = Repo(make_table())
        k, code = kehila_admin.create_kehila(repo, 'Beit Test', 'he', dev=True)
        self.assertEqual(repo.get_kehila(k)['settings']['pollSeconds'], 5)
        self.assertEqual(repo.get_kehila(k)['settings']['defaultLang'], 'he')
        self.assertEqual((repo.get_invite(code)['role'], repo.get_invite(code)['usesLeft']), ('gabbai', 1))


if __name__ == '__main__':
    unittest.main()
