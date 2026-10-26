import json
import os
import unittest
from unittest import mock

import boto3
from moto import mock_aws

from server.cloud import handler as handler_module
from server.cloud import routes_me
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table
from server.tests.cloud.test_handler import Context, event

TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'


@mock_aws
class DeleteAccountTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.cognito = boto3.client('cognito-idp', region_name='il-central-1')
        self.pool = self.cognito.create_user_pool(PoolName='p')['UserPool']['Id']
        env = mock.patch.dict(os.environ, {'USER_POOL_ID': self.pool})
        env.start()
        self.addCleanup(env.stop)
        for sub in ('sub-gab', 'sub-dana'):
            self.cognito.admin_create_user(UserPoolId=self.pool, Username=sub)
        self.k1 = self.repo.create_kehila('Beit Alef', {})
        self.k2 = self.repo.create_kehila('Beit Bet', {})
        self.gab = self.uid('sub-gab')
        self.dana = self.uid('sub-dana')
        for k in (self.k1, self.k2):
            self.repo.put_membership(k, self.gab, 'gabbai')
        self.repo.put_membership(self.k1, self.dana, 'member')
        self.repo.put_membership(self.k2, self.dana, 'listener')

    def call(self, method, path, sub, body=None):
        response = handler_module.handler(event(method, path, sub=sub, body=json.dumps(body) if body else None),
                                          Context())
        return response['statusCode'], json.loads(response['body']) if response['body'] else None

    def uid(self, sub):
        return self.call('GET', '/v1/me', sub)[1]['userId']

    def seed_activity(self):
        chan = self.repo.list_channels(self.k1)[0]['sk'][2:]
        self.repo.put_profile(self.dana, 'Dana', 'Test', 'en')
        self.repo.put_device(self.dana, TOKEN, 'ios')
        self.repo.put_request(self.k2, self.dana, 'Dana T', False, 1)
        own = self.repo.put_message(self.k1, chan, 'weekly', 't', 'b', self.dana, 'Dana T', 'member', None)
        aimed = self.repo.put_message(self.k1, chan, 'celebration', 't', 'b', self.gab, 'Gab', 'management',
                                      self.dana, 'Dana T')
        other = self.repo.put_message(self.k1, chan, 'weekly', 't', 'b', self.gab, 'Gab', 'management', None)
        mid = other['sk'][4:]
        self.repo.join_message(self.k1, mid, self.dana)
        self.repo.put_reply(self.k1, mid, self.dana, 'Dana T', 'mazal tov')
        self.repo.put_read(self.k1, mid, self.dana)
        self.repo.count_broadcast(self.k1, self.dana, '2026-10-26', 3)
        self.repo.put_push_ticket('tk1', TOKEN, self.dana, 9999999999)
        return own, aimed, other

    def test_delete_account_removes_personal_items(self):
        own, aimed, other = self.seed_activity()
        self.repo.put_message(self.k1, 'c', 'weekly', 't', 'b', self.gab, 'Gab', 'management', None)
        self.assertEqual(self.call('DELETE', '/v1/me', 'sub-dana'), (204, None))
        keys = ('pk', 'sk', 'gsi1pk', 'gsi1sk')
        left = self.repo.table.scan()['Items']
        for item in left:
            for key in keys:
                for needle in (self.dana, 'sub-dana'):
                    self.assertNotIn(needle, item.get(key, ''), item)
        self.assertEqual(self.repo.list_push_tickets(), [])
        self.assertEqual(self.repo.get_user_id('sub-dana'), None)
        # the other user is untouched
        self.assertEqual(self.repo.get_membership(self.k1, self.gab)['role'], 'gabbai')
        users = [u['Username'] for u in self.cognito.list_users(UserPoolId=self.pool)['Users']]
        self.assertEqual(users, ['sub-gab'])
        # counts stay (historic)
        mid = other['sk'][4:]
        message = self.repo.get_message(self.k1, mid)
        self.assertEqual((int(message['joinCount']), int(message['replierCount'])), (1, 1))

    def test_deleted_author_name_blanked(self):
        own, aimed, other = self.seed_activity()
        self.call('DELETE', '/v1/me', 'sub-dana')
        mine = self.repo.get_message(self.k1, own['sk'][4:])
        self.assertEqual((mine['authorName'], mine['authorId']), ('', self.dana))
        self.assertEqual(self.repo.get_message(self.k1, aimed['sk'][4:])['targetName'], '')
        self.assertEqual(self.repo.get_message(self.k1, other['sk'][4:])['authorName'], 'Gab')
        reply = self.repo.list_replies(self.k1, other['sk'][4:])
        self.assertEqual([r['authorName'] for r in reply], [''])
        self.assertEqual(reply[0]['body'], 'mazal tov')

    def test_delete_account_blocked_for_last_gabbai(self):
        self.seed_activity()
        status, body = self.call('DELETE', '/v1/me', 'sub-gab')
        self.assertEqual((status, body), (409, {'error': 'last_gabbai'}))
        # nothing deleted: not even the membership in the Kehila where another gabbai exists
        self.repo.put_membership(self.k1, self.dana, 'gabbai')
        self.assertEqual(self.call('DELETE', '/v1/me', 'sub-gab')[0], 409)
        self.assertIsNotNone(self.repo.get_membership(self.k1, self.gab))
        self.assertIsNotNone(self.repo.get_membership(self.k2, self.gab))
        self.assertEqual(len(self.cognito.list_users(UserPoolId=self.pool)['Users']), 2)

    def test_gabbai_can_delete_when_another_remains(self):
        for k in (self.k1, self.k2):
            self.repo.put_membership(k, self.dana, 'gabbai')
        self.assertEqual(self.call('DELETE', '/v1/me', 'sub-gab')[0], 204)
        self.assertIsNone(self.repo.get_membership(self.k1, self.gab))

    def test_retry_after_cognito_failure_finishes(self):
        self.seed_activity()
        with mock.patch.object(routes_me, '_delete_cognito_user', side_effect=RuntimeError('boom')):
            self.assertEqual(self.call('DELETE', '/v1/me', 'sub-dana')[0], 500)
        # data is gone, Cognito user still exists; the retry removes it
        self.assertEqual(self.call('DELETE', '/v1/me', 'sub-dana')[0], 204)
        users = [u['Username'] for u in self.cognito.list_users(UserPoolId=self.pool)['Users']]
        self.assertEqual(users, ['sub-gab'])

    def test_missing_pool_env_fails_before_deleting(self):
        with mock.patch.dict(os.environ):
            del os.environ['USER_POOL_ID']
            self.assertEqual(self.call('DELETE', '/v1/me', 'sub-dana')[0], 500)
        self.assertIsNotNone(self.repo.get_membership(self.k1, self.dana))
