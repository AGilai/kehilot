import json
import os
import time
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
        tomb = [i for i in left if i['pk'] == 'U#sub-dana']  # the only trace: a PII-free tombstone
        self.assertEqual([set(i) for i in tomb], [{'pk', 'sk', 'deleted', 'expiresAt'}])
        for item in left:
            if item in tomb:
                continue
            for key in keys:
                for needle in (self.dana, 'sub-dana'):
                    self.assertNotIn(needle, item.get(key, ''), item)
        self.assertEqual(self.repo.list_push_tickets(), [])
        self.assertEqual(self.repo.get_user_id('sub-dana'), None)  # tombstone has no userId
        # the other user is untouched
        self.assertEqual(self.repo.get_membership(self.k1, self.gab)['role'], 'gabbai')
        users = [u['Username'] for u in self.cognito.list_users(UserPoolId=self.pool)['Users']]
        self.assertEqual(users, ['sub-gab'])
        # counts stay (historic)
        mid = other['sk'][4:]
        message = self.repo.get_message(self.k1, mid)
        self.assertEqual((int(message['joinCount']), int(message['replierCount'])), (1, 1))

    def test_calls_after_delete_create_nothing_and_get_account_deleted(self):
        self.seed_activity()
        self.assertEqual(self.call('DELETE', '/v1/me', 'sub-dana')[0], 204)
        before = sorted((i['pk'], i['sk']) for i in self.repo.table.scan()['Items'])
        tomb = self.repo.table.get_item(Key={'pk': 'U#sub-dana', 'sk': 'SUB'})['Item']
        self.assertEqual(tomb['deleted'], True)
        self.assertTrue(time.time() + 80000 < int(tomb['expiresAt']) <= time.time() + 87000)
        expected = (401, {'error': 'account_deleted'})
        self.assertEqual(self.call('GET', '/v1/me', 'sub-dana'), expected)
        self.assertEqual(self.call('PUT', '/v1/me/profile', 'sub-dana',
                                   {'firstName': 'G', 'lastName': 'H', 'lang': 'en'}), expected)
        self.assertEqual(self.call('PUT', '/v1/me/devices', 'sub-dana', {'token': TOKEN, 'platform': 'ios'}), expected)
        self.assertEqual(sorted((i['pk'], i['sk']) for i in self.repo.table.scan()['Items']), before)

    def test_delete_retried_after_tombstone_still_finishes_cognito(self):
        self.seed_activity()
        with mock.patch.object(routes_me, '_delete_cognito_user', side_effect=RuntimeError('boom')):
            self.assertEqual(self.call('DELETE', '/v1/me', 'sub-dana')[0], 500)
        self.assertEqual(self.repo.table.get_item(Key={'pk': 'U#sub-dana', 'sk': 'SUB'})['Item']['deleted'], True)
        self.assertEqual(self.call('DELETE', '/v1/me', 'sub-dana')[0], 204)
        self.assertEqual([u['Username'] for u in self.cognito.list_users(UserPoolId=self.pool)['Users']], ['sub-gab'])

    def test_many_read_items_deleted_in_batches(self):
        self.seed_activity()
        with self.repo.table.batch_writer() as batch:
            for n in range(300):
                batch.put_item(Item={'pk': f'K#{self.k1}#U#{self.dana}', 'sk': f'READ#{n:05d}', 'at': 1})
        with mock.patch.object(self.repo.table, 'delete_item', wraps=self.repo.table.delete_item) as single:
            self.assertEqual(self.call('DELETE', '/v1/me', 'sub-dana')[0], 204)
        self.assertEqual([c for c in single.call_args_list if c.kwargs['Key']['sk'].startswith('READ#')], [])
        for item in self.repo.table.scan()['Items']:
            self.assertNotIn(self.dana, item['pk'] + item['sk'])

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

    def test_deletion_drops_out_of_family(self):
        self.repo.put_profile(self.dana, 'Dana', 'Test', 'en')
        self.repo.update_children(self.k1, self.repo.ensure_family(self.k1, self.dana),
                                 lambda c: c + [{'id': 'C' * 26, 'firstName': 'Noa', 'gender': 'f'}])
        self.repo.link(self.k1, self.gab, self.dana)
        self.repo.put_link_request(self.k1, self.dana, self.gab, 1)
        self.assertEqual(self.call('DELETE', '/v1/me', 'sub-dana'), (204, None))
        (family,) = self.repo._query_prefix(self.k1, 'F#')
        self.assertEqual(family['adults'], [self.gab])
        self.assertEqual([c['firstName'] for c in family['children']], ['Noa'])
        self.assertNotIn('familyNotice', self.repo.get_membership(self.k1, self.gab))
        for item in self.repo.table.scan()['Items']:
            if item['pk'] != 'U#sub-dana':
                self.assertNotIn(self.dana, json.dumps(item, default=str), item)

    def test_deletion_of_last_adult_removes_family(self):
        self.repo.ensure_family(self.k1, self.dana)
        self.assertEqual(self.call('DELETE', '/v1/me', 'sub-dana'), (204, None))
        self.assertEqual(self.repo._query_prefix(self.k1, 'F#'), [])
