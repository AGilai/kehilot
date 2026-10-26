import json
import time
import unittest
from datetime import datetime, timezone
from unittest import mock

from boto3.dynamodb.conditions import Key
from moto import mock_aws

from server.cloud import handler as handler_module
from server.cloud import push, repo_messages
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table
from server.tests.cloud.test_handler import Context, event

PROFILE = {'firstName': 'Dana', 'lastName': 'Test', 'lang': 'en'}
POST = {'type': 'weekly', 'title': 'Shabbat times', 'body': 'Candles at 17:30'}


@mock_aws
class MessagesTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.k = self.repo.create_kehila('Beit Test', {})
        self.channels = {c['name']: c['sk'][2:] for c in self.repo._query_prefix(self.k, 'C#')}
        self.gabbai = self.add('gabbai-sub', 'gabbai', 'Gabi Gabbai')
        self.member = self.add('member-sub', 'member', 'Mia Member', True)
        self.quiet = self.add('quiet-sub', 'member', 'Quinn Quiet', False)
        self.listener = self.add('listener-sub', 'listener', 'Lior Listener')

    def add(self, sub, role, name, can_broadcast=False):
        user_id = self.call('GET', '/v1/me', sub=sub)[1]['userId']
        self.repo.put_membership(self.k, user_id, role)
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{user_id}'},
                                    UpdateExpression='SET displayName = :n, canBroadcast = :b',
                                    ExpressionAttributeValues={':n': name, ':b': can_broadcast})
        return user_id

    def call(self, method, path, sub='gabbai-sub', body=None, query=None):
        evt = event(method, path, sub=sub, body=json.dumps(body) if body is not None else None)
        if query:
            evt['queryStringParameters'] = query
        response = handler_module.handler(evt, Context())
        return response['statusCode'], json.loads(response['body']) if response['body'] else None

    def base(self):
        return f'/v1/kehilot/{self.k}'

    def post(self, channel, sub='gabbai-sub', **extra):
        return self.call('POST', f'{self.base()}/messages', sub=sub,
                         body={**POST, 'channelId': self.channels[channel], **extra})

    def changes(self):
        return self.repo._query_prefix(self.k, 'CHG#')

    def test_gabbai_posts_to_announcements(self):
        with mock.patch.object(push, 'enqueue') as enqueue:
            status, body = self.post('announcements')
        self.assertEqual(status, 201)
        self.assertEqual((body['authorKind'], body['authorName'], body['authorId'], body['joinCount']),
                         ('management', 'Gabi Gabbai', self.gabbai, 0))
        self.assertEqual(body['channelId'], self.channels['announcements'])
        enqueue.assert_called_once_with('message', self.k, body['messageId'])
        (change,) = self.changes()
        self.assertEqual((change['kind'], change['refId'], change['channelId']),
                         ('message', body['messageId'], self.channels['announcements']))
        self.assertNotIn('visibleTo', change)
        self.assertAlmostEqual(int(change['expiresAt']), time.time() + 30 * 86400, delta=60)
        # a listener reads announcements
        status, listed = self.call('GET', f'{self.base()}/messages', sub='listener-sub')
        self.assertEqual([x['messageId'] for x in listed], [body['messageId']])

    def test_member_without_broadcast_right_gets_403(self):
        self.assertEqual(self.post('simchas', sub='quiet-sub'), (403, {'error': 'forbidden'}))
        self.assertEqual(self.post('announcements', sub='member-sub'), (403, {'error': 'forbidden'}))
        status, body = self.post('simchas', sub='member-sub')
        self.assertEqual((status, body['authorKind']), (201, 'member'))
        self.assertEqual(self.post('simchas', sub='listener-sub')[0], 404)  # cannot even see the channel

    def test_validation(self):
        base = {**POST, 'channelId': self.channels['announcements']}
        for bad, code in (({'type': 'poem'}, 'invalid_type'), ({'title': ''}, 'invalid_title'),
                          ({'title': 'x' * 121}, 'invalid_title'), ({'body': 'x' * 4001}, 'invalid_body'),
                          ({'channelId': 'nope'}, 'invalid_channel_id')):
            self.assertEqual(self.call('POST', f'{self.base()}/messages', body={**base, **bad}),
                             (400, {'error': code}), bad)
        missing = self.call('POST', f'{self.base()}/messages', body={**base, 'channelId': '0' * 26})
        self.assertEqual(missing, (404, {'error': 'channel_not_found'}))
        self.assertEqual(self.post('announcements', targetMemberId=self.member),
                         (400, {'error': 'invalid_target_member_id'}))  # weekly cannot target

    def test_listener_cannot_read_members_channel(self):
        _, posted = self.post('simchas')
        self.post('announcements')
        status, channels = self.call('GET', f'{self.base()}/channels', sub='listener-sub')
        self.assertEqual([c['name'] for c in channels], ['announcements'])
        status, listed = self.call('GET', f'{self.base()}/messages', sub='listener-sub')
        self.assertEqual(len(listed), 1)
        self.assertNotEqual(listed[0]['messageId'], posted['messageId'])
        mid = posted['messageId']
        for method, suffix in (('GET', ''), ('POST', '/read')):
            self.assertEqual(self.call(method, f'{self.base()}/messages/{mid}{suffix}', sub='listener-sub'),
                             (404, {'error': 'message_not_found'}), suffix)
        self.assertEqual(self.call('POST', f'{self.base()}/messages/{mid}/join', sub='listener-sub')[0], 403)  # listeners never join
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{"0" * 26}', sub='listener-sub')[0], 404)
        self.assertEqual(self.call('DELETE', f'{self.base()}/messages/{mid}', sub='listener-sub')[0], 404)
        self.assertEqual(len(self.call('GET', f'{self.base()}/channels', sub='member-sub')[1]), 3)

    def test_broadcast_daily_limit_429(self):
        for _ in range(3):
            self.assertEqual(self.post('simchas', sub='member-sub')[0], 201)
        self.assertEqual(self.post('simchas', sub='member-sub'), (429, {'error': 'broadcast_limit'}))
        for _ in range(4):  # management is not limited
            self.assertEqual(self.post('simchas')[0], 201)
        counters = self.repo._query_prefix(self.k, 'BC#')
        self.assertEqual(len(counters), 1)
        self.assertEqual(int(counters[0]['count']), 3)
        today = datetime.now(repo_messages.JERUSALEM).strftime('%Y-%m-%d')
        self.assertEqual(counters[0]['sk'], f'BC#{self.member}#{today}')

    def test_local_date_fallback_without_tzdata(self):
        summer = datetime(2026, 7, 1, 21, 30, tzinfo=timezone.utc)
        winter = datetime(2026, 1, 1, 21, 30, tzinfo=timezone.utc)
        with mock.patch.object(repo_messages, 'JERUSALEM', None):
            self.assertEqual(repo_messages.local_date(summer), '2026-07-02')  # UTC+3
            self.assertEqual(repo_messages.local_date(winter), '2026-01-01')  # UTC+2 -> 23:30 same day
        self.assertEqual(repo_messages.local_date(summer), '2026-07-02')

    def test_target_member_must_be_in_same_kehila(self):
        other_k = self.repo.create_kehila('Other', {})
        stranger = self.call('GET', '/v1/me', sub='stranger-sub')[1]['userId']
        self.repo.put_membership(other_k, stranger, 'member')
        for target in (stranger, self.listener, 'nope', '0' * 26):
            self.assertEqual(self.post('simchas', type='celebration', targetMemberId=target),
                             (400, {'error': 'invalid_target_member_id'}), target)
        status, body = self.post('simchas', type='celebration', targetMemberId=self.quiet)
        self.assertEqual((status, body['targetMemberId']), (201, self.quiet))
        status, body = self.post('condolences', type='condolence', targetMemberId=self.gabbai)
        self.assertEqual(status, 201)

    def test_author_and_gabbai_can_remove_others_cannot(self):
        _, mine = self.post('simchas', sub='member-sub')
        _, other = self.post('simchas', sub='member-sub')
        url = lambda m: f'{self.base()}/messages/{m["messageId"]}'
        self.assertEqual(self.call('DELETE', url(mine), sub='quiet-sub'), (403, {'error': 'forbidden'}))
        self.assertEqual(self.call('DELETE', url(mine), sub='member-sub'), (204, None))
        self.assertEqual(self.call('DELETE', url(other)), (204, None))  # gabbai
        self.assertEqual(self.call('GET', url(mine), sub='member-sub'), (404, {'error': 'message_not_found'}))
        self.assertEqual(self.call('GET', f'{self.base()}/messages')[1], [])
        stored = self.repo.table.get_item(Key={'pk': f'K#{self.k}', 'sk': f'MSG#{mine["messageId"]}'})['Item']
        self.assertTrue(stored['removed'])
        self.assertEqual([c['kind'] for c in self.changes()].count('message_removed'), 2)
        self.assertEqual(self.call('DELETE', url(mine))[0], 404)  # already gone

    def test_join_is_idempotent(self):
        _, msg = self.post('simchas', type='celebration')
        url = f'{self.base()}/messages/{msg["messageId"]}/join'
        self.assertEqual(self.call('POST', url, sub='member-sub'), (200, {'joinCount': 1, 'joined': True}))
        self.assertEqual(self.call('POST', url, sub='member-sub'), (200, {'joinCount': 1, 'joined': True}))
        self.assertEqual(self.call('POST', url, sub='quiet-sub'), (200, {'joinCount': 2, 'joined': True}))
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{msg["messageId"]}')[1]['joinCount'], 2)
        joins = [c for c in self.changes() if c['kind'] == 'join']
        self.assertEqual(len(joins), 2)
        self.assertEqual(joins[0]['channelId'], self.channels['simchas'])
        self.assertNotIn('visibleTo', joins[0])

    def test_read_writes_private_change(self):
        _, msg = self.post('announcements')
        url = f'{self.base()}/messages/{msg["messageId"]}/read'
        self.assertEqual(self.call('POST', url, sub='listener-sub'), (204, None))
        (read,) = [c for c in self.changes() if c['kind'] == 'read']
        self.assertEqual((read['refId'], read['visibleTo']), (msg['messageId'], [self.listener]))
        self.assertIn('at', self.repo.table.get_item(
            Key={'pk': f'K#{self.k}#U#{self.listener}', 'sk': f'READ#{msg["messageId"]}'})['Item'])

    def test_pagination_before_cursor(self):
        ids = [self.post('announcements')[1]['messageId'] for _ in range(5)]
        removed = ids[3]
        self.call('DELETE', f'{self.base()}/messages/{removed}')
        expected = [i for i in reversed(ids) if i != removed]
        got = self.call('GET', f'{self.base()}/messages', query={'limit': '2'})[1]
        self.assertEqual([x['messageId'] for x in got], expected[:2])
        got2 = self.call('GET', f'{self.base()}/messages', query={'limit': '2', 'before': got[-1]['messageId']})[1]
        self.assertEqual([x['messageId'] for x in got2], expected[2:4])
        self.assertEqual(len(self.call('GET', f'{self.base()}/messages')[1]), 4)
        for bad in ({'limit': '0'}, {'limit': '51'}, {'limit': 'x'}, {'before': 'zzz'}):
            self.assertEqual(self.call('GET', f'{self.base()}/messages', query=bad)[0], 400, bad)

    def test_pagination_skips_hidden_until_page_full(self):
        for _ in range(3):
            self.post('announcements')
        for _ in range(60):  # newest 60 are hidden from listeners
            self.post('simchas')
        got = self.call('GET', f'{self.base()}/messages', sub='listener-sub', query={'limit': '3'})[1]
        self.assertEqual(len(got), 3)

    def test_channel_admin(self):
        body = {'name': 'youth', 'listenersCanRead': True, 'postPolicy': 'broadcasters'}
        self.assertEqual(self.call('POST', f'{self.base()}/admin/channels', sub='member-sub', body=body)[0], 403)
        status, created = self.call('POST', f'{self.base()}/admin/channels', body=body)
        self.assertEqual((status, created['name'], created['postPolicy']), (201, 'youth', 'broadcasters'))
        cid = created['channelId']
        status, updated = self.call('PUT', f'{self.base()}/admin/channels/{cid}',
                                    body={**body, 'listenersCanRead': False})
        self.assertEqual((status, updated['listenersCanRead']), (200, False))
        names = [c['name'] for c in self.call('GET', f'{self.base()}/channels', sub='listener-sub')[1]]
        self.assertNotIn('youth', names)
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/channels/{"0" * 26}', body=body),
                         (404, {'error': 'channel_not_found'}))
        self.assertEqual(self.call('POST', f'{self.base()}/admin/channels', body={**body, 'postPolicy': 'x'}),
                         (400, {'error': 'invalid_post_policy'}))

    def test_other_kehila_message_is_not_reachable(self):
        _, msg = self.post('announcements')
        other_k = self.repo.create_kehila('Other', {})
        outsider = self.call('GET', '/v1/me', sub='out-sub')[1]['userId']
        self.repo.put_membership(other_k, outsider, 'gabbai')
        self.assertEqual(self.call('GET', f'/v1/kehilot/{other_k}/messages/{msg["messageId"]}', sub='out-sub'),
                         (404, {'error': 'message_not_found'}))
        self.assertEqual(self.call('GET', f'/v1/kehilot/{self.k}/messages', sub='out-sub')[0], 404)

    def test_messages_carry_read_flag_for_caller_only(self):
        mid = self.post('announcements')[1]['messageId']
        self.call('POST', f'{self.base()}/messages/{mid}/read', sub='member-sub')
        for sub, expected in (('member-sub', True), ('quiet-sub', False)):
            listed = self.call('GET', f'{self.base()}/messages', sub=sub)[1]
            self.assertEqual([m['read'] for m in listed], [expected])
            self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}', sub=sub)[1]['read'], expected)

    def test_read_flags_batch(self):
        ids = [self.post('announcements')[1]['messageId'] for _ in range(3)]
        self.repo.put_read(self.k, ids[0], self.member)
        self.repo.put_read(self.k, ids[2], self.member)
        self.assertEqual(self.repo.read_flags(self.k, self.member, ids + ['nope']), {ids[0], ids[2]})
        self.assertEqual(self.repo.read_flags(self.k, self.member, []), set())

    def test_directory_lists_members_not_listeners(self):
        for sub in ('member-sub', 'gabbai-sub'):
            status, body = self.call('GET', f'{self.base()}/members', sub=sub)
            self.assertEqual(status, 200)
            self.assertEqual(body, [{'userId': self.gabbai, 'displayName': 'Gabi Gabbai'},
                                    {'userId': self.member, 'displayName': 'Mia Member'},
                                    {'userId': self.quiet, 'displayName': 'Quinn Quiet'}])

    def test_listener_cannot_list_directory(self):
        self.assertEqual(self.call('GET', f'{self.base()}/members', sub='listener-sub'),
                         (403, {'error': 'forbidden'}))
