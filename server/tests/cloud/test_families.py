import importlib.util
import os
import unittest
from unittest import mock

import boto3
from moto import mock_aws

from server.cloud import accounts, importer
from server.cloud.families import family_name
from server.tests.cloud import test_messages
from server.tests.cloud.test_admin import PROFILE

_spec = importlib.util.spec_from_file_location(
    'kehila_admin', os.path.join(os.path.dirname(__file__), '..', '..', '..', 'tools', 'kehila_admin.py'))
kehila_admin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kehila_admin)


@mock_aws
class FamiliesTest(test_messages.MessagesTest):
    def families(self):
        return self.repo._query_prefix(self.k, 'F#')

    def family_id(self, user_id):
        return self.repo.get_membership(self.k, user_id).get('familyId')

    def user(self, sub):
        user_id = self.call('GET', '/v1/me', sub=sub)[1]['userId']
        self.call('PUT', '/v1/me/profile', sub=sub, body=PROFILE)
        return user_id

    def assert_single_adult_family(self, user_id):
        family_id = self.family_id(user_id)
        self.assertTrue(family_id)
        family = self.repo.get_family(self.k, family_id)
        self.assertEqual((family['adults'], family['children'], int(family['version'])), ([user_id], [], 1))
        self.assertEqual(self.repo.family_of(self.k, user_id), family)

    def test_family_name_rules(self):
        cases = [([('Dana', 'Levi'), ('Avi', 'Levi')], 'Levi'),
                 ([('Dana', 'Levi'), ('Avi', 'Cohen')], 'Levi · Cohen'),
                 ([('Dana', ''), ('Avi', '')], 'Dana · Avi'),
                 ([('Dana', '')], 'Dana'),
                 ([('Dana', 'Levi'), ('Avi', '')], 'Levi · Avi')]
        for people, expected in cases:
            profiles = [{'firstName': f, 'lastName': l} for f, l in people]
            self.assertEqual(family_name(profiles), expected)
        self.assertEqual(family_name([None, {'firstName': 'Avi', 'lastName': ''}]), 'Avi')

    def test_ensure_family_creates_once(self):
        first = self.repo.ensure_family(self.k, self.member)
        self.assertEqual(self.repo.ensure_family(self.k, self.member), first)
        (family,) = self.families()
        self.assertEqual((family['familyId'], family['adults']), (first, [self.member]))
        self.assert_single_adult_family(self.member)

    def test_ensure_family_skips_listener(self):
        self.assertIsNone(self.repo.ensure_family(self.k, self.listener))
        self.assertIsNone(self.repo.ensure_family(self.k, 'nobody'))
        self.assertEqual(self.families(), [])
        self.assertIsNone(self.repo.family_of(self.k, self.listener))

    def test_approve_creates_family(self):
        self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')
        status, _ = self.call('POST', f'{self.base()}/admin/requests/{self.listener}/approve',
                              body={'classification': ''})
        self.assertEqual(status, 200)
        self.assert_single_adult_family(self.listener)

    def test_approve_succeeds_when_family_creation_fails(self):
        self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')
        with mock.patch.object(self.repo, 'ensure_family', side_effect=RuntimeError('boom')):
            status, _ = self.call('POST', f'{self.base()}/admin/requests/{self.listener}/approve',
                                  body={'classification': ''})
        self.assertEqual(status, 200)
        self.assertIsNone(self.family_id(self.listener))

    def test_member_invite_creates_family(self):
        newcomer = self.user('new-sub')
        code = self.repo.create_invite(self.k, self.gabbai, 'member', 1, 7)
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='new-sub')[0], 200)
        self.assert_single_adult_family(newcomer)

    def test_listener_invite_has_no_family(self):
        newcomer = self.user('new-sub')
        code = self.repo.create_invite(self.k, self.gabbai, 'listener', 1, 7)
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='new-sub')[0], 200)
        self.assertIsNone(self.family_id(newcomer))

    def _import(self, rows):
        if not hasattr(self, 'cognito'):
            self.cognito = boto3.client('cognito-idp', region_name='il-central-1')
            self.pool = self.cognito.create_user_pool(PoolName='p', UsernameAttributes=['email'])['UserPool']['Id']
        cognito, pool = self.cognito, self.pool
        with mock.patch.object(accounts, 'cognito_client', return_value=cognito):
            results = importer.import_rows(self.repo, cognito, pool, self.k, rows)

        def user_id(email):
            user = cognito.admin_get_user(UserPoolId=pool, Username=email)
            return self.repo.get_user_id(next(a['Value'] for a in user['UserAttributes'] if a['Name'] == 'sub'))
        return results, user_id

    def test_import_member_creates_family(self):
        row = {'firstName': 'Dana', 'lastName': 'Example', 'email': 'dana@example.test', 'role': 'member'}
        results, user_id = self._import([row])
        self.assertEqual(results[0]['status'], 'created')
        self.assert_single_adult_family(user_id('dana@example.test'))
        results, _ = self._import([row])  # a re-import: exists, still one family
        self.assertEqual(results[0]['status'], 'exists')
        self.assertEqual(len(self.families()), 1)

    def test_import_listener_has_no_family(self):
        row = {'firstName': 'Dana', 'lastName': 'Example', 'email': 'dana@example.test', 'role': 'listener'}
        results, user_id = self._import([row])
        self.assertEqual(results[0]['status'], 'created')
        self.assertIsNone(self.family_id(user_id('dana@example.test')))
        self.assertEqual(self.families(), [])

    def test_backfill_is_idempotent(self):
        self.assertEqual(kehila_admin.backfill_families(self.repo), (1, 3))  # gabbai, member, quiet
        self.assertEqual(len(self.families()), 3)
        self.assertEqual(kehila_admin.backfill_families(self.repo), (1, 0))
        self.assertEqual(kehila_admin.backfill_families(self.repo, self.k), (1, 0))
        self.assertIsNone(self.family_id(self.listener))
        self.assertEqual(len(self.families()), 3)


if __name__ == '__main__':
    unittest.main()
