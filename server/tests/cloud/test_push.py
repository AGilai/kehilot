import json
import os
import unittest
import urllib.error
from unittest import mock

import boto3
from moto import mock_aws

from server.cloud import expo, push, push_worker
from server.cloud.push import PUSH_TEXT
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table


def record(kind, k, ref, receive_count=1, message_id='r1'):
    return {'messageId': message_id, 'receiptHandle': 'rh-' + message_id,
            'body': json.dumps({'kind': kind, 'kehila': k, 'ref': ref}),
            'attributes': {'ApproximateReceiveCount': str(receive_count)}}


@mock_aws
class PushTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.k = self.repo.create_kehila('Beit Test', {})
        self.chan = {c['name']: c['sk'][2:] for c in self.repo.list_channels(self.k)}
        self.gab = self.user('gab', 'gabbai', 'en')
        self.fam = self.user('fam', 'member', 'he')
        self.eng = self.user('eng', 'member', 'en')
        self.lis = self.user('lis', 'listener', 'en')
        self.sent = []
        self.tickets = None
        patches = [mock.patch.object(expo, 'send', side_effect=self.fake_send),
                   mock.patch.object(expo, 'access_token', return_value=None),
                   mock.patch.object(push_worker, '_repo', return_value=self.repo)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def user(self, uid, role, lang, token=True):
        self.repo.put_membership(self.k, uid, role)
        if lang:
            self.repo.put_profile(uid, uid, 'X', lang)
        if token:
            self.repo.put_device(uid, f'ExponentPushToken[{uid}]', 'ios')
        return uid

    def fake_send(self, messages, token):
        self.sent += messages
        if self.tickets is not None:
            return self.tickets(messages)
        return [{'status': 'ok', 'id': f'tk{len(self.sent)}-{i}'} for i, _ in enumerate(messages)]

    def message(self, channel='simchas', author='gab', kind='management', type_='celebration', target=None):
        return self.repo.put_message(self.k, self.chan[channel], type_, 't', 'b', author, 'A', kind, target)

    def mid(self, item):
        return item['sk'][4:]

    def mute(self, uid, **notify):
        self.repo.set_notify(self.k, uid, notify)

    def run_message(self, item, kind='message'):
        return push_worker.handler({'Records': [record(kind, self.k, self.mid(item))]}, None)

    def test_recipients_respect_channel_and_mutes(self):
        m = self.message('announcements')
        self.assertCountEqual(push_worker.recipients(self.repo, 'message', self.k, self.mid(m)),
                              ['fam', 'eng', 'lis'])  # not the author
        m = self.message('simchas')  # listener cannot read
        self.assertCountEqual(push_worker.recipients(self.repo, 'message', self.k, self.mid(m)), ['fam', 'eng'])
        self.mute('fam', mutedChannels=[self.chan['simchas']])
        self.mute('eng', mutedTypes=['celebration'])
        self.assertEqual(push_worker.recipients(self.repo, 'message', self.k, self.mid(m)), [])
        self.mute('fam', mutedMembers=['gab'])
        m2 = self.message('announcements')
        self.assertNotIn('fam', push_worker.recipients(self.repo, 'message', self.k, self.mid(m2)))

    def test_removed_message_not_pushed(self):
        m = self.message()
        self.repo.remove_message(self.k, self.mid(m))
        self.assertEqual(push_worker.recipients(self.repo, 'message', self.k, self.mid(m)), [])
        self.assertEqual(self.run_message(m), {'batchItemFailures': []})
        self.assertEqual(self.sent, [])

    def test_management_only_skips_member_broadcast(self):
        self.mute('eng', membersBroadcasts='management_only')
        member_msg = self.message(author='fam', kind='member')
        self.assertCountEqual(push_worker.recipients(self.repo, 'message', self.k, self.mid(member_msg)),
                              ['gab'])
        mgmt_msg = self.message(author='gab', kind='management')
        self.assertIn('eng', push_worker.recipients(self.repo, 'message', self.k, self.mid(mgmt_msg)))

    def test_reply_push_goes_to_target_only(self):
        m = self.message(author='gab', target='fam')
        self.assertEqual(push_worker.recipients(self.repo, 'reply', self.k, self.mid(m)), ['fam'])
        push_worker.handler({'Records': [record('reply', self.k, self.mid(m))]}, None)
        self.assertEqual([s['to'] for s in self.sent], ['ExponentPushToken[fam]'])
        self.assertEqual(self.sent[0]['data'], {'kehila': self.k, 'messageId': self.mid(m)})

    def test_request_goes_to_gabbaim(self):
        self.user('gab2', 'gabbai', None)
        self.assertCountEqual(push_worker.recipients(self.repo, 'request', self.k, 'requests'), ['gab', 'gab2'])
        push_worker.handler({'Records': [record('request', self.k, 'requests')]}, None)
        self.assertEqual({tuple(s['data'].items()) for s in self.sent},
                         {(('kehila', self.k), ('screen', 'requests'))})
        self.assertEqual({s['body'] for s in self.sent}, {PUSH_TEXT['request']['en'], PUSH_TEXT['request']['he']})

    def test_text_in_recipient_language(self):
        self.run_message(self.message('announcements'))
        body = {s['to']: s['body'] for s in self.sent}
        self.assertEqual(body['ExponentPushToken[fam]'], PUSH_TEXT['celebration']['he'])
        self.assertEqual(body['ExponentPushToken[eng]'], PUSH_TEXT['celebration']['en'])

    def test_text_per_message_type(self):
        expected = {'weekly': ('עדכון שבועי מהקהילה', 'Weekly update from your community'),
                    'celebration': ('מזל טוב חדש בקהילה', 'New mazal tov in your community'),
                    'condolence': ('הודעת אבל בקהילה', 'Condolence notice in your community'),
                    'event': ('אירוע חדש בקהילה', 'New event in your community')}
        for type_, (he, en) in expected.items():
            self.sent.clear()
            self.run_message(self.message('announcements', type_=type_))
            body = {s['to']: s['body'] for s in self.sent}
            self.assertEqual(body['ExponentPushToken[fam]'], he, type_)
            self.assertEqual(body['ExponentPushToken[eng]'], en, type_)
            self.assertEqual((PUSH_TEXT[type_]['he'], PUSH_TEXT[type_]['en']), (he, en))

    def test_unknown_type_uses_generic_text(self):
        self.run_message(self.message('announcements', type_='mystery'))
        body = {s['to']: s['body'] for s in self.sent}
        self.assertEqual(body['ExponentPushToken[fam]'], 'הודעה חדשה בקהילה')
        self.assertEqual(body['ExponentPushToken[eng]'], 'New message in your community')

    def test_title_is_kehila_name(self):
        self.run_message(self.message('announcements'))
        self.assertTrue(self.sent)
        self.assertEqual({s['title'] for s in self.sent}, {'Beit Test'})
        self.sent.clear()
        push_worker.handler({'Records': [record('request', self.k, 'requests')]}, None)
        self.assertEqual({s['title'] for s in self.sent}, {'Beit Test'})

    def test_default_lang_from_kehila_settings(self):
        self.user('nolang', 'member', None)
        self.run_message(self.message('announcements'))
        body = {s['to']: s['body'] for s in self.sent}
        self.assertEqual(body['ExponentPushToken[nolang]'], PUSH_TEXT['celebration']['he'])

    def test_payload_has_no_message_content(self):
        m = self.message('announcements')
        self.run_message(m)
        self.assertTrue(self.sent)
        texts = {t for langs in PUSH_TEXT.values() for t in langs.values()}
        self.assertEqual(len(PUSH_TEXT), 7)
        for s in self.sent:
            self.assertLessEqual(set(s['data']), {'kehila', 'messageId', 'screen'})
            self.assertIn(s['body'], texts)
            self.assertEqual((s['title'], s['sound']), ('Beit Test', 'default'))
            self.assertNotIn('A', s['data'].values())

    def test_same_token_sent_once(self):
        self.repo.table.put_item(Item={'pk': 'U#eng', 'sk': 'D#ExponentPushToken[fam]',
                                       'token': 'ExponentPushToken[fam]', 'platform': 'ios', 'lastSeen': 'x'})
        self.run_message(self.message('announcements'))
        tokens = [s['to'] for s in self.sent]
        self.assertEqual(len(tokens), len(set(tokens)))

    def test_chunks_of_100(self):
        for i in range(120):
            self.user(f'u{i}', 'member', 'en')
        calls = []
        self.tickets = lambda msgs: calls.append(len(msgs)) or [{'status': 'ok', 'id': 'x'}] * len(msgs)
        self.run_message(self.message('simchas'))
        self.assertEqual(calls, [100, 22])
        self.assertTrue(all(c <= 100 for c in calls))
        self.assertEqual(sum(calls), 122)  # 120 + fam + eng (author excluded)

    def test_device_not_registered_deleted_and_ok_tickets_stored(self):
        def tickets(msgs):
            return [{'status': 'error', 'details': {'error': 'DeviceNotRegistered'}}
                    if m['to'].endswith('[fam]') else {'status': 'ok', 'id': 'tkt-eng'} for m in msgs]
        self.tickets = tickets
        self.run_message(self.message('simchas'))
        self.assertEqual(self.repo.list_devices('fam'), [])
        self.assertEqual(len(self.repo.list_devices('eng')), 1)
        items = self.repo.table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key('pk').eq('PUSHTKT'))['Items']
        self.assertEqual([(i['sk'], i['userId'], i['token']) for i in items],
                         [('T#tkt-eng', 'eng', 'ExponentPushToken[eng]')])
        self.assertIn('expiresAt', items[0])

    def test_expo_http_error_reports_batch_failure(self):
        sqs = boto3.client('sqs', region_name='il-central-1')
        url = sqs.create_queue(QueueName='push', Attributes={'VisibilityTimeout': '5'})['QueueUrl']
        sqs.send_message(QueueUrl=url, MessageBody='x')
        got = sqs.receive_message(QueueUrl=url)['Messages'][0]
        rec = record('message', self.k, self.mid(self.message('simchas')), receive_count=3, message_id='bad')
        rec['receiptHandle'] = got['ReceiptHandle']
        with mock.patch.dict(os.environ, {'PUSH_QUEUE_URL': url}), \
                mock.patch.object(expo, 'send', side_effect=urllib.error.URLError('down')), \
                mock.patch('boto3.client', return_value=mock.Mock(wraps=sqs)) as client:
            out = push_worker.handler({'Records': [rec, record('request', self.k, 'requests')]}, None)
        self.assertEqual(out, {'batchItemFailures': [{'itemIdentifier': 'bad'}, {'itemIdentifier': 'r1'}]})
        client.return_value.change_message_visibility.assert_any_call(
            QueueUrl=url, ReceiptHandle=rec['receiptHandle'], VisibilityTimeout=240)

    def test_poison_records_dropped_not_retried(self):
        secret = 'SECRET-BODY-TEXT'
        bad = [{'messageId': 'p1', 'body': secret + '{not json'},
               {'messageId': 'p2', 'body': json.dumps({'kind': 'message', 'kehila': self.k})},
               {'messageId': 'p3', 'body': json.dumps([secret])},
               {'messageId': 'p4', 'body': json.dumps({'kind': 'message', 'kehila': 5, 'ref': secret})}]
        good = record('request', self.k, 'requests', message_id='ok')
        with self.assertLogs('server.cloud.push_worker', level='WARNING') as logs, \
                mock.patch.object(push_worker, '_delay_retry') as delay:
            out = push_worker.handler({'Records': [*bad, good]}, None)
        self.assertEqual(out, {'batchItemFailures': []})
        delay.assert_not_called()
        self.assertTrue(self.sent)
        self.assertEqual(len(logs.records), 4)
        self.assertNotIn(secret, '\n'.join(logs.output))
        self.assertIn('p1', logs.output[0])

    def test_visibility_backoff_capped(self):
        self.assertEqual([push_worker.backoff(n) for n in (1, 2, 3, 6, 9)], [60, 120, 240, 900, 900])

    def test_enqueue_noop_without_url_and_sends_with(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('PUSH_QUEUE_URL', None)
            push.enqueue('message', self.k, 'abc')  # must not raise
        sqs = boto3.client('sqs', region_name='il-central-1')
        url = sqs.create_queue(QueueName='push2')['QueueUrl']
        with mock.patch.dict(os.environ, {'PUSH_QUEUE_URL': url}):
            push.enqueue('message', self.k, 'abc')
            os.environ['PUSH_QUEUE_URL'] = url + '-missing'
            push.enqueue('message', self.k, 'abc')  # a broken queue never fails the request
        body = sqs.receive_message(QueueUrl=url)['Messages'][0]['Body']
        self.assertEqual(json.loads(body), {'kind': 'message', 'kehila': self.k, 'ref': 'abc'})


class ExpoTest(unittest.TestCase):
    def setUp(self):
        expo._cached.clear()

    def fake_urlopen(self, response):
        captured = {}

        def opener(req, timeout=None):
            captured['req'] = req
            body = mock.MagicMock()
            body.__enter__.return_value.read.return_value = json.dumps(response).encode()
            return body
        return captured, opener

    def test_send_posts_json_list_and_returns_tickets(self):
        captured, opener = self.fake_urlopen({'data': [{'status': 'ok', 'id': 'a'}]})
        with mock.patch('urllib.request.urlopen', opener):
            out = expo.send([{'to': 't'}], 'secret')
        self.assertEqual(out, [{'status': 'ok', 'id': 'a'}])
        req = captured['req']
        self.assertEqual(req.full_url, 'https://exp.host/--/api/v2/push/send')
        self.assertEqual(json.loads(req.data), [{'to': 't'}])
        self.assertEqual(req.get_header('Authorization'), 'Bearer secret')

    def test_none_token_means_no_header(self):
        for token in (None, 'none'):
            captured, opener = self.fake_urlopen({'data': []})
            with mock.patch('urllib.request.urlopen', opener):
                expo.send([], token)
            self.assertIsNone(captured['req'].get_header('Authorization'))

    def test_receipts(self):
        captured, opener = self.fake_urlopen({'data': {'a': {'status': 'ok'}}})
        with mock.patch('urllib.request.urlopen', opener):
            self.assertEqual(expo.receipts(['a'], None), {'a': {'status': 'ok'}})
        self.assertEqual(json.loads(captured['req'].data), {'ids': ['a']})

    def test_access_token_from_ssm_cached(self):
        ssm = mock.Mock()
        ssm.get_parameter.return_value = {'Parameter': {'Value': 'tok'}}
        with mock.patch.dict(os.environ, {'ENV_NAME': 'dev'}), mock.patch('boto3.client', return_value=ssm):
            self.assertEqual(expo.access_token(), 'tok')
            self.assertEqual(expo.access_token(), 'tok')
        ssm.get_parameter.assert_called_once_with(Name='/kehilot/dev/expo-access-token', WithDecryption=True)

    def test_access_token_unconfigured_is_none(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(expo.access_token())


if __name__ == '__main__':
    unittest.main()
