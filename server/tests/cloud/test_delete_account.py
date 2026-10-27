import json
import os
import time
import unittest
from unittest import mock

import boto3
from boto3.dynamodb.conditions import Key
from moto import mock_aws

from server.cloud import handler as handler_module
from server.cloud import media, routes_me
from server.cloud.repo import Repo
from server.tests.cloud.helpers import MEDIA_BUCKET, make_bucket, make_table
from server.tests.cloud.test_handler import Context, event
from server.tests.cloud.test_groups import own_tests_only

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
        path, _, query = path.partition('?')
        evt = event(method, path, sub=sub, body=json.dumps(body) if body else None)
        if query:
            evt['queryStringParameters'] = dict(q.split('=') for q in query.split('&'))
        response = handler_module.handler(evt, Context())
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


JPEG = b'\xff\xd8\xff\xe0' + b'0' * 100


@own_tests_only
@mock_aws
class DeletePostsTest(DeleteAccountTest):
    """DELETE /v1/me?deletePosts=1. Reuses the parent's fixtures but none of its tests (own_tests_only)."""

    def setUp(self):
        super().setUp()
        env = mock.patch.dict(os.environ, {})
        env.start()
        self.addCleanup(env.stop)
        media.s3_client.cache_clear()
        self.addCleanup(media.s3_client.cache_clear)
        self.s3 = make_bucket()
        self.repo.put_profile(self.dana, 'Dana', 'Test', 'en')
        self.eli_sub = 'sub-eli'
        self.cognito.admin_create_user(UserPoolId=self.pool, Username=self.eli_sub)
        self.eli = self.uid(self.eli_sub)
        self.repo.put_membership(self.k1, self.eli, 'member')
        self.chan1 = self.repo.list_channels(self.k1)[0]['sk'][2:]
        self.chan2 = self.repo.list_channels(self.k2)[0]['sk'][2:]

    def seed_posts(self):
        weekly = self.repo.put_message(self.k1, self.chan1, 'weekly', 'Title one', 'Body one', self.dana, 'Dana T',
                                       'member', None, image={'contentType': 'image/jpeg', 'bytes': 104})
        self.s3.put_object(Bucket=MEDIA_BUCKET, Key=media.image_key(self.k1, weekly['sk'][4:]), Body=JPEG)
        chat = self.repo.put_message(self.k2, self.chan2, 'chat', '', 'chat text', self.dana, 'Dana T', 'member', None)
        blessing = self.repo.put_message(self.k1, self.chan1, 'celebration', 'Mazal tov', 'Wishes', self.dana,
                                         'Dana T', 'member', self.gab, 'Gab')
        bid = blessing['sk'][4:]
        self.repo.put_reply(self.k1, bid, self.eli, 'Eli', 'one')
        self.repo.put_reply(self.k1, bid, self.gab, 'Gab', 'two')
        about_other = self.repo.put_message(self.k1, self.chan1, 'celebration', 't', 'b', self.gab, 'Gab',
                                            'management', self.eli, 'Eli')
        oid = about_other['sk'][4:]
        self.repo.put_reply(self.k1, oid, self.dana, 'Dana T', 'private')
        self.repo.put_reply(self.k1, oid, self.dana, 'Dana T', 'private again')
        self.repo.put_reply(self.k1, oid, self.gab, 'Gab', 'other reply')
        return weekly, chat, blessing, about_other

    def changes(self, k):
        return [i for i in self.repo._query_prefix(k, 'CHG#') if i['kind'] == 'message_removed']

    def test_delete_posts_removes_messages_chat_and_replies_everywhere(self):
        weekly, chat, blessing, about_other = self.seed_posts()
        oid = about_other['sk'][4:]
        self.assertEqual(int(self.repo.get_message(self.k1, oid)['replierCount']), 2)
        self.assertEqual(self.call('DELETE', '/v1/me?deletePosts=1', 'sub-dana'), (204, None))
        for k, m in ((self.k1, weekly), (self.k2, chat), (self.k1, blessing)):
            item = self.repo.get_message(k, m['sk'][4:])
            self.assertEqual((item['removed'], item['title'], item['body']), (True, '', ''))
            self.assertNotIn('image', item)
        keys = self.s3.list_objects_v2(Bucket=MEDIA_BUCKET).get('Contents', [])
        self.assertEqual(keys, [])
        self.assertEqual(sorted(i['refId'] for i in self.changes(self.k1)),
                         sorted([weekly['sk'][4:], blessing['sk'][4:]]))
        self.assertEqual([i['refId'] for i in self.changes(self.k2)], [chat['sk'][4:]])
        self.assertEqual(self.repo._query_prefix(f'{self.k1}#MSG#{blessing["sk"][4:]}', 'R'), [])
        replies = self.repo.list_replies(self.k1, oid)
        self.assertEqual([r['body'] for r in replies], ['other reply'])
        self.assertEqual(int(self.repo.get_message(self.k1, oid)['replierCount']), 1)
        self.assertEqual(self.repo.table.query(KeyConditionExpression=Key('pk').eq(f'K#{self.k1}#MSG#{oid}') &
                                               Key('sk').begins_with('RP#'))['Items'][0]['sk'], f'RP#{self.gab}')
        counts = [i for i in self.repo._query_prefix(self.k1, 'CHG#') if i['kind'] == 'reply_count']
        self.assertIn(oid, [i['refId'] for i in counts])
        # the other messages are untouched
        self.assertFalse(self.repo.get_message(self.k1, oid)['removed'])

    def test_delete_posts_scrubs_text(self):
        weekly, chat, blessing, about_other = self.seed_posts()
        self.repo.remove_message(self.k2, chat['sk'][4:])  # removed earlier: title/body still there
        self.assertEqual(self.repo.get_message(self.k2, chat['sk'][4:])['body'], 'chat text')
        self.call('DELETE', '/v1/me?deletePosts=1', 'sub-dana')
        item = self.repo.get_message(self.k2, chat['sk'][4:])
        self.assertEqual((item['removed'], item['title'], item['body']), (True, '', ''))
        for item in self.repo.table.scan()['Items']:
            self.assertNotIn('chat text', json.dumps(item, default=str))
            self.assertNotIn('Wishes', json.dumps(item, default=str))

    def test_delete_posts_retry_finishes(self):
        weekly, chat, blessing, about_other = self.seed_posts()
        budget = iter([100000, 100000, 2000])
        with mock.patch.object(Context, 'get_remaining_time_in_millis', create=True,
                               side_effect=lambda: next(budget, 2000)):
            self.assertEqual(self.call('DELETE', '/v1/me?deletePosts=1', 'sub-dana'), (503, {'error': 'try_again'}))
        self.assertIsNotNone(self.repo.get_membership(self.k1, self.dana))  # nothing past the posts ran
        self.assertEqual(self.call('DELETE', '/v1/me?deletePosts=1', 'sub-dana'), (204, None))
        for item in self.repo.table.scan()['Items']:
            self.assertNotIn(self.dana, item['pk'] + item['sk'])
            if item.get('authorId') == self.dana:
                self.assertEqual((item.get('title', ''), item.get('body', ''), item.get('authorName', '')),
                                 ('', '', ''))
        self.assertEqual(self.s3.list_objects_v2(Bucket=MEDIA_BUCKET).get('Contents', []), [])
        self.assertEqual(int(self.repo.get_message(self.k1, about_other['sk'][4:])['replierCount']), 1)

    def test_retry_after_crash_between_remove_and_scrub_finishes(self):
        weekly, chat, blessing, about_other = self.seed_posts()
        with mock.patch.object(self.repo, 'scrub_message', side_effect=RuntimeError('boom')):
            self.assertEqual(self.call('DELETE', '/v1/me?deletePosts=1', 'sub-dana')[0], 500)
        self.assertEqual(self.call('DELETE', '/v1/me?deletePosts=1', 'sub-dana'), (204, None))
        for m in (weekly, blessing):
            self.assertEqual(self.repo.get_message(self.k1, m['sk'][4:])['body'], '')

    def test_delete_without_flag_keeps_posts(self):
        weekly, chat, blessing, about_other = self.seed_posts()
        self.assertEqual(self.call('DELETE', '/v1/me?deletePosts=true', 'sub-dana'), (204, None))  # only "1" counts
        item = self.repo.get_message(self.k1, weekly['sk'][4:])
        self.assertEqual((item['removed'], item['body'], item['authorName']), (False, 'Body one', ''))
        self.assertEqual(self.repo.get_message(self.k2, chat['sk'][4:])['body'], 'chat text')
        self.assertEqual(self.s3.list_objects_v2(Bucket=MEDIA_BUCKET)['KeyCount'], 1)

    def test_blessings_about_deleted_person_stay_blank_target(self):
        about_dana = self.repo.put_message(self.k1, self.chan1, 'celebration', 'Mazal', 'Wishes', self.gab, 'Gab',
                                           'management', self.dana, 'Dana T')
        self.call('DELETE', '/v1/me?deletePosts=1', 'sub-dana')
        item = self.repo.get_message(self.k1, about_dana['sk'][4:])
        self.assertEqual((item['removed'], item['targetName'], item['body']), (False, '', 'Wishes'))

    def test_listener_can_leave(self):
        self.assertEqual(self.call('DELETE', f'/v1/kehilot/{self.k2}/membership', 'sub-dana')[0], 204)
        self.assertIsNone(self.repo.get_membership(self.k2, self.dana))

    def test_image_only_chat_crash_before_change_then_retry_finishes(self):
        chat = self.repo.put_message(self.k2, self.chan2, 'chat', '', '', self.dana, 'Dana T', 'member', None,
                                     image={'contentType': 'image/jpeg', 'bytes': 104})
        mid = chat['sk'][4:]
        self.s3.put_object(Bucket=MEDIA_BUCKET, Key=media.image_key(self.k2, mid), Body=JPEG)
        self.repo.put_reply(self.k2, mid, self.gab, 'Gab', 'hi')
        with mock.patch.object(self.repo, 'put_change', side_effect=RuntimeError('boom')):
            self.assertEqual(self.call('DELETE', '/v1/me?deletePosts=1', 'sub-dana')[0], 500)
        self.assertTrue(self.repo.get_message(self.k2, mid)['removed'])
        self.assertEqual(self.call('DELETE', '/v1/me?deletePosts=1', 'sub-dana'), (204, None))
        self.assertEqual([i['refId'] for i in self.changes(self.k2)], [mid])
        self.assertEqual(self.repo.list_replies(self.k2, mid), [])

    def test_last_reply_check_is_consistent_read(self):
        weekly, chat, blessing, about_other = self.seed_posts()
        oid = about_other['sk'][4:]
        seen = []
        real = self.repo.table.query
        self.repo.table.query = lambda **kw: (seen.append(kw), real(**kw))[1]
        try:
            reply = next(r for r in self.repo.list_replies(self.k1, oid) if r['authorId'] == self.dana)
            self.repo.delete_reply(self.k1, oid, reply['sk'], self.dana)
        finally:
            del self.repo.table.query
        self.assertTrue(seen and all(kw.get('ConsistentRead') for kw in seen[1:]))
