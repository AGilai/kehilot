import json
import os
from datetime import timedelta
import unittest
import urllib.error
from unittest import mock

import boto3
from moto import mock_aws

from server.cloud import expo, push, push_worker, routes_admin, seat_reminders
from server.cloud.push import PUSH_TEXT
from server.cloud.repo import Repo
from server.tests.cloud import test_seatweek
from server.tests.cloud.helpers import ensure_member_channels, make_table
from server.tests.cloud.test_groups import own_tests_only
from server.tests.cloud.test_seatweek import WEEK, at


def record(kind, k, ref, receive_count=1, message_id='r1'):
    return {'messageId': message_id, 'receiptHandle': 'rh-' + message_id,
            'body': json.dumps({'kind': kind, 'kehila': k, 'ref': ref}),
            'attributes': {'ApproximateReceiveCount': str(receive_count)}}


@mock_aws
class PushTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.k = self.repo.create_kehila('Beit Test', {})
        ensure_member_channels(self.repo, self.k)
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
        m = self.message('announcements', type_='weekly')  # a guest-visible type
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

    def chat_channel(self, groups=()):
        item = self.repo.put_channel(self.k, 'chat-room', False, 'management', groups)
        self.repo.update_channel(self.k, item['sk'][2:], 'chat-room', False, 'management', conversation=True)
        self.chan['chat-room'] = item['sk'][2:]

    def test_chat_push_only_to_opted_in(self):
        self.chat_channel()
        item = self.message('chat-room', author='fam', kind='member', type_='chat')
        ref = self.mid(item)
        self.assertEqual(push_worker.recipients(self.repo, 'message', self.k, ref), [])
        self.mute('eng', chatChannels=[self.chan['chat-room']])
        self.mute('lis', chatChannels=[self.chan['chat-room']])  # a whole-Kehila channel: not readable by listeners
        self.mute('gab', chatChannels=[self.chan['chat-room']], mutedChannels=[self.chan['chat-room']])
        self.assertEqual(push_worker.recipients(self.repo, 'message', self.k, ref), ['eng'])
        self.run_message(item)
        self.assertEqual([s['to'] for s in self.sent], ['ExponentPushToken[eng]'])
        self.assertEqual(self.sent[0]['body'], PUSH_TEXT['chat']['en'])
        self.assertEqual(self.sent[0]['data'], {'kehila': self.k, 'messageId': ref})
        self.mute('fam', chatChannels=[self.chan['chat-room']])
        self.sent.clear()
        self.run_message(self.message('chat-room', author='eng', kind='member', type_='chat'))
        self.assertIn(PUSH_TEXT['chat']['he'], [s['body'] for s in self.sent])
        self.assertEqual(PUSH_TEXT['chat'], {'he': 'הודעה חדשה בשיחה בקהילה', 'en': 'New chat message in your community'})

    def test_chat_push_includes_group_listener(self):
        self.chat_channel(groups={'grp1'})
        ref = self.chan['chat-room']
        for uid in ('lis', 'eng'):
            self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{uid}'},
                                        UpdateExpression='SET #g = :g, notify = :n',
                                        ExpressionAttributeNames={'#g': 'groups'},
                                        ExpressionAttributeValues={':g': {'grp1'}, ':n': {'chatChannels': [ref]}})
        item = self.message('chat-room', author='fam', kind='member', type_='chat')
        self.assertCountEqual(push_worker.recipients(self.repo, 'message', self.k, self.mid(item)), ['lis', 'eng'])

    def test_chat_push_ignores_management_only(self):
        self.chat_channel()
        self.mute('eng', chatChannels=[self.chan['chat-room']], membersBroadcasts='management_only')
        item = self.message('chat-room', author='fam', kind='member', type_='chat')
        self.assertEqual(push_worker.recipients(self.repo, 'message', self.k, self.mid(item)), ['eng'])

    def test_reply_push_goes_to_target_only(self):
        m = self.message(author='gab', target='fam')
        self.assertEqual(push_worker.recipients(self.repo, 'reply', self.k, self.mid(m)), ['fam'])
        push_worker.handler({'Records': [record('reply', self.k, self.mid(m))]}, None)
        self.assertEqual([s['to'] for s in self.sent], ['ExponentPushToken[fam]'])
        self.assertEqual(self.sent[0]['data'], {'kehila': self.k, 'messageId': self.mid(m)})

    def test_reply_push_goes_to_every_adult_not_author(self):
        self.repo.link(self.k, 'fam', 'eng')
        m = self.message(author='gab', target='fam')
        self.assertCountEqual(push_worker.recipients(self.repo, 'reply', self.k, self.mid(m)), ['fam', 'eng'])
        self.repo.put_membership(self.k, 'eng', 'listener')  # a departed/listener adult gets nothing
        self.assertEqual(push_worker.recipients(self.repo, 'reply', self.k, self.mid(m)), ['fam'])

    def test_family_request_push_payload(self):
        for kind, ref in (('family_request', self.eng), ('family_gabbai', self.eng)):
            self.sent.clear()
            push_worker.handler({'Records': [record(kind, self.k, ref)]}, None)
            self.assertEqual([m['data'] for m in self.sent], [{'kehila': self.k, 'screen': 'family'}])
            self.assertEqual(self.sent[0]['to'], f'ExponentPushToken[{self.eng}]')
            self.assertEqual(self.sent[0]['body'], PUSH_TEXT[kind]['en'])
        self.assertEqual(PUSH_TEXT['family_request']['he'], 'בקשת קישור משפחה חדשה')
        self.assertEqual(PUSH_TEXT['family_gabbai']['en'], 'Your family details were updated by the management team')

    def test_family_push_only_to_member_or_gabbai_of_that_kehila(self):
        for ref in (self.lis, 'nobody'):
            self.sent.clear()
            push_worker.handler({'Records': [record('family_request', self.k, ref)]}, None)
            self.assertEqual(self.sent, [])
        self.assertEqual(push_worker.recipients(self.repo, 'family_gabbai', self.k, self.gab), [self.gab])

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
        self.assertEqual(len(PUSH_TEXT), 11)
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


NBSP = '\u00a0'


@own_tests_only
@mock_aws
class SeatReminderPushTest(test_seatweek.SeatWeekTest):
    def setUp(self):
        super().setUp()
        self.mine((5, 0))
        self.give(f'family:{self.other}', (5, 3))
        self.repo.put_profile(self.member, 'Mia', 'Member', 'he')
        self.repo.put_profile(self.quiet, 'Quinn', 'Quiet', 'en')
        for uid in (self.member, self.quiet):
            self.repo.put_device(uid, f'ExponentPushToken[{uid}]', 'ios')
        self.sent = []
        self.now = at(21, 0) - timedelta(days=1)  # Thursday 21:00
        patches = [mock.patch.object(expo, 'send', side_effect=self.fake_send),
                   mock.patch.object(expo, 'access_token', return_value=None),
                   mock.patch.object(push_worker, '_repo', return_value=self.repo),
                   mock.patch.object(push_worker, '_now', side_effect=lambda: self.now)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def fake_send(self, messages, token):
        self.sent += messages
        return [{'status': 'ok', 'id': f'tk{len(self.sent)}-{i}'} for i, _ in enumerate(messages)]

    def work(self, ref):
        self.sent.clear()
        return push_worker.handler({'Records': [record('seat_reminder', self.k, ref)]}, None)

    def by_user(self):
        return {s['to'][len('ExponentPushToken['):-1]: s for s in self.sent}

    def test_seat_reminder_payload_and_text(self):
        self.assertEqual(self.work(f'{WEEK}#1'), {'batchItemFailures': []})
        got = self.by_user()
        self.assertEqual(set(got), {self.member, self.quiet})
        he, en = got[self.member], got[self.quiet]
        self.assertEqual(he['title'], 'Beit Test · טופס מקומות לשבת')
        self.assertEqual(he['body'], f'עוד לא עניתם על טופס המקומות לשבת. אפשר לענות עד יום ו׳{NBSP}14:00.')
        self.assertEqual(en['title'], 'Beit Test · Shabbat seats form')
        self.assertEqual(en['body'], f"You haven't answered the Shabbat seats form yet. You can answer until Fri{NBSP}14:00.")
        for s in (he, en):
            self.assertEqual(s['data'], {'kehila': self.k, 'screen': 'seats', 'week': WEEK})
            blob = json.dumps({k: v for k, v in s.items() if k != 'to'}, ensure_ascii=False)  # 'to' is the device
            for private in ('Mia', 'Quinn', 'Member', 'Quiet', self.fam, self.member):
                self.assertNotIn(private, blob)
        self.assertNotIn('seat_reminder', PUSH_TEXT)

    def test_seat_reminder_recipients_at_send_time(self):
        self.assertEqual(self.put_me([1])[0], 200)  # the family answers after the claim, before the worker
        self.work(f'{WEEK}#1')
        self.assertEqual(set(self.by_user()), {self.quiet})
        self.assertEqual(self.respond([{'household': f'family:{self.other}', 'released': 0}])[0], 200)
        self.assertEqual(set(self.by_user()), {self.quiet})  # a file upload is not an answer

    def test_worker_drops_after_deadline_or_off(self):
        ref = f'{WEEK}#1'
        self.now = at(14, 0)
        self.work(ref)
        self.assertEqual(self.sent, [])
        self.now = at(21, 0) - timedelta(days=1)
        self.assertEqual(len(self.work(ref) and self.sent), 2)
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/seats/times', body={'reminders': {'1': {'on': False}}})[0], 200)
        self.work(ref)
        self.assertEqual(self.sent, [])
        self.assertEqual(len(self.work(f'{WEEK}#2') and self.sent), 2)  # the other reminder is still on
        self.work('2020-01-03#1')  # no layout that Friday
        self.assertEqual(self.sent, [])
        for bad in ('garbage', f'{WEEK}#3', f'{WEEK}'):
            self.assertEqual(self.work(bad), {'batchItemFailures': []})
            self.assertEqual(self.sent, [])

    def test_seat_reminder_gentle_text_today_vs_other_day(self):
        self.work(f'{WEEK}#2')
        got = self.by_user()
        self.assertEqual(got[self.member]['title'], 'Beit Test')
        self.assertEqual(got[self.member]['body'], 'תזכורת עדינה: טופס המקומות פתוח עד 14:00 היום. מקום שתפנו יכול לשמח מישהו אחר בשבת.')
        self.assertEqual(got[self.quiet]['body'], 'A gentle reminder: the seats form is open until 14:00 today. '
                                                  'A seat you free could make someone else\'s Shabbat.')
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/seats/times',
                                   body={'reminders': {'2': {'day': 'thu', 'time': '21:00'}}})[0], 200)
        self.now = at(21, 30) - timedelta(days=1)
        for uid in (self.member, self.quiet):  # same reminder again, as if no user had been handled yet
            self.repo.release_seat_reminder(self.k, WEEK, f'2#U#{uid}')
        self.work(f'{WEEK}#2')
        self.assertEqual(self.by_user()[self.quiet]['body'], 'A gentle reminder: the seats form is open until '
                         f'Fri{NBSP}14:00. A seat you free could make someone else\'s Shabbat.')
        self.assertIn(f'יום ו׳{NBSP}14:00', self.by_user()[self.member]['body'])

    def test_redelivery_sends_each_user_once(self):
        record_ = {'Records': [record('seat_reminder', self.k, f'{WEEK}#1')]}
        push_worker.handler(record_, None)
        push_worker.handler(record_, None)  # SQS delivers the record again
        self.assertEqual(sorted(s['to'] for s in self.sent),
                         sorted(f'ExponentPushToken[{u}]' for u in (self.member, self.quiet)))

    def test_mid_chunk_failure_then_retry_sends_each_user_once(self):
        record_ = {'Records': [record('seat_reminder', self.k, f'{WEEK}#1')]}
        calls = []
        def flaky(messages, token):
            calls.append(len(messages))
            if len(calls) == 2:
                raise urllib.error.URLError('boom')
            return self.fake_send(messages, token)
        with mock.patch.object(push_worker, 'CHUNK', 1), mock.patch.object(expo, 'send', side_effect=flaky):
            first = push_worker.handler(record_, None)
            self.assertEqual(len(first['batchItemFailures']), 1)
            push_worker.handler(record_, None)
            push_worker.handler(record_, None)
        self.assertEqual(sorted(s['to'] for s in self.sent),
                         sorted(f'ExponentPushToken[{u}]' for u in (self.member, self.quiet)))

    def test_rejected_message_releases_the_user_marker(self):
        record_ = {'Records': [record('seat_reminder', self.k, f'{WEEK}#1')]}
        with mock.patch.object(expo, 'send', side_effect=lambda m, t: [{'status': 'error', 'details': {'error': 'MessageRateExceeded'}}] * len(m)):
            push_worker.handler(record_, None)
        self.assertEqual(self.repo.seat_reminders_sent(self.k, WEEK), set())
        push_worker.handler(record_, None)
        self.assertEqual(len(self.sent), 2)

    def test_seat_reminder_not_in_editable_push_texts(self):
        self.assertNotIn(seat_reminders.KIND, PUSH_TEXT)
        self.assertFalse(routes_admin._editable(seat_reminders.KIND))
        self.assertNotIn(seat_reminders.KIND, push.SYSTEM_KEYS)

    def test_send_needs_a_queue_and_enqueue_stays_quiet(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError):
                push.send('seat_reminder', self.k, f'{WEEK}#1')
            push.enqueue('message', self.k, 'm1')  # no queue: still a no-op
        sqs = boto3.client('sqs', region_name='il-central-1')
        url = sqs.create_queue(QueueName='seatq')['QueueUrl']
        with mock.patch.dict(os.environ, {'PUSH_QUEUE_URL': url}):
            push.send('seat_reminder', self.k, f'{WEEK}#1')
            body = json.loads(sqs.receive_message(QueueUrl=url)['Messages'][0]['Body'])
            self.assertEqual(body, {'kind': 'seat_reminder', 'kehila': self.k, 'ref': f'{WEEK}#1'})
            with mock.patch('boto3.client', side_effect=RuntimeError('down')):
                with self.assertRaises(RuntimeError):
                    push.send('seat_reminder', self.k, f'{WEEK}#1')
                push.enqueue('message', self.k, 'm1')  # swallowed, as before


if __name__ == '__main__':
    unittest.main()
