import unittest
from unittest import mock

from moto import mock_aws

from server.cloud.identity import Caller, caller_from_event, resolve_user_id
from server.cloud.ids import ID_RE
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table


def jwt_event(claims):
    return {'requestContext': {'authorizer': {'jwt': {'claims': claims}}}}


@mock_aws
class IdentityTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.caller = Caller(sub='sub-1', email='a@example.test', groups=())

    def test_first_call_creates_user_id(self):
        user_id = resolve_user_id(self.repo, self.caller)
        self.assertRegex(user_id, ID_RE)
        self.assertEqual(self.repo.get_user_id('sub-1'), user_id)

    def test_resolve_clears_never_signed_in(self):
        user_id = self.repo.create_user_id('sub-1', 'A' * 26)
        self.repo.mark_imported_account('sub-1', user_id)
        sub = lambda: self.repo.table.get_item(Key={'pk': 'U#sub-1', 'sk': 'SUB'})['Item']
        self.assertTrue(sub()['neverSignedIn'])
        self.assertEqual(self.repo.table.get_item(Key={'pk': f'U#{user_id}', 'sk': 'SUBREF'})['Item']['sub'], 'sub-1')
        self.assertEqual(resolve_user_id(self.repo, self.caller), user_id)
        self.assertNotIn('neverSignedIn', sub())
        with mock.patch.object(Repo, 'clear_never_signed_in') as clear:
            resolve_user_id(self.repo, self.caller)
        clear.assert_not_called()

    def test_second_call_returns_same_id(self):
        self.assertEqual(resolve_user_id(self.repo, self.caller), resolve_user_id(self.repo, self.caller))

    def test_concurrent_first_login_keeps_one_user_id(self):
        self.repo.create_user_id('sub-1', 'A' * 26)
        self.assertEqual(self.repo.create_user_id('sub-1', 'B' * 26), 'A' * 26)

    def test_lost_race_returns_winner_even_if_read_is_stale(self):
        self.repo.create_user_id('sub-1', 'A' * 26)
        with mock.patch.object(Repo, 'get_user_id', return_value=None):  # eventually consistent read lagging
            self.assertEqual(self.repo.create_user_id('sub-1', 'B' * 26), 'A' * 26)

    def test_user_mapping_stores_no_email(self):
        resolve_user_id(self.repo, self.caller)
        item = self.repo.table.get_item(Key={'pk': 'U#sub-1', 'sk': 'SUB'})['Item']
        self.assertNotIn('email', item)

    def test_groups_claim_formats(self):
        base = {'sub': 's', 'email': 'e@example.test'}
        self.assertEqual(caller_from_event(jwt_event({**base, 'cognito:groups': '[platform-admin]'})).groups,
                         ('platform-admin',))
        self.assertEqual(caller_from_event(jwt_event(base)).groups, ())
