import json
import os
import time
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import expo, push, push_worker
from server.cloud.repo import Repo
from server.tests.cloud.helpers import ensure_member_channels, make_table
from server.tests.cloud.test_push import record


@mock_aws
class ReplyPushTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.k = self.repo.create_kehila('Beit Test', {})
        ensure_member_channels(self.repo, self.k)
        self.chan = {c['name']: c['sk'][2:] for c in self.repo.list_channels(self.k)}
        self.gab = self.user('gab', 'gabbai', 'he')
        self.author = self.user('auth', 'member', 'he')
        self.shulamit = self.user('shul', 'member', 'he')
        self.yigal = self.user('yig', 'member', 'en')
        self.repo.link(self.k, 'shul', 'yig')
        self.rep1 = self.user('rep1', 'member', 'he')
        self.rep2 = self.user('rep2', 'member', 'he')
        self.sent = []
        self.now = 1_800_000_000.0
        patches = [mock.patch.object(expo, 'send', side_effect=self.fake_send),
                   mock.patch.object(expo, 'access_token', return_value=None),
                   mock.patch.object(push_worker, '_repo', return_value=self.repo),
                   mock.patch.object(time, 'time', side_effect=lambda: self.now)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def user(self, uid, role, lang):
        self.repo.put_membership(self.k, uid, role)
        self.repo.put_profile(uid, uid, 'X', lang)
        self.repo.put_device(uid, f'ExponentPushToken[{uid}]', 'ios')
        return uid

    def fake_send(self, messages, token):
        self.sent += messages
        return [{'status': 'ok', 'id': f'tk{len(self.sent)}-{i}'} for i, _ in enumerate(messages)]

    def general(self):
        return self.repo.put_message(self.k, self.chan['announcements'], 'general', 't', 'b', 'auth', 'A', 'member',
                                     None)['sk'][4:]

    def blessing(self, type_='celebration'):
        return self.repo.put_message(self.k, self.chan['announcements'], type_, 't', 'b', 'gab', 'A', 'management',
                                     'shul')['sk'][4:]

    def reply(self, m, writer, to):
        return self.repo.put_reply(self.k, m, writer, 'N', 'secret body', to)['sk'][2:]

    def run_reply(self, m, r):
        self.sent.clear()
        out = push_worker.handler({'Records': [record('reply', self.k, f'{m}/{r}')]}, None)
        self.assertEqual(out, {'batchItemFailures': []})
        return {s['to']: s for s in self.sent}

    def test_job_carries_ids_only(self):
        sent = []
        with mock.patch.dict(os.environ, {'PUSH_QUEUE_URL': 'q'}), mock.patch('boto3.client') as client:
            client.return_value.send_message.side_effect = lambda **kw: sent.append(kw)
            push.enqueue('reply', self.k, 'm1/r1')
        self.assertEqual(json.loads(sent[0]['MessageBody']), {'kind': 'reply', 'kehila': self.k, 'ref': 'm1/r1'})

    def test_author_route_pushes_author_with_fixed_text(self):
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': 'META'}, UpdateExpression='SET pushTexts = :p',
                                    ExpressionAttributeValues={':p': {'reply': {'he': 'custom!'}}})
        m = self.general()
        sent = self.run_reply(m, self.reply(m, 'rep1', 'author'))
        self.assertEqual(list(sent), ['ExponentPushToken[auth]'])
        s = sent['ExponentPushToken[auth]']
        self.assertEqual((s['title'], s['body']), ('Beit Test', 'תשובה פרטית חדשה'))
        self.assertEqual(s['data'], {'kehila': self.k, 'messageId': m})

    def test_family_route_pushes_reachable_adults(self):
        m = self.blessing('condolence')
        sent = self.run_reply(m, self.reply(m, 'rep1', 'family'))
        self.assertEqual({t: s['body'] for t, s in sent.items()},
                         {'ExponentPushToken[shul]': 'מילה אישית חדשה למשפחה',
                          'ExponentPushToken[yig]': 'New personal word for your family'})
        m2 = self.blessing()
        sent = self.run_reply(m2, self.reply(m2, 'rep1', 'family'))
        self.assertEqual(sent['ExponentPushToken[shul]']['body'], 'ברכה אישית חדשה למשפחה')

    def test_missing_to_is_family(self):
        m = self.blessing()
        r = self.reply(m, 'rep1', 'family')
        self.repo.table.update_item(Key={'pk': f'K#{self.k}#MSG#{m}', 'sk': f'R#{r}'}, UpdateExpression='REMOVE #t',
                                    ExpressionAttributeNames={'#t': 'to'})
        self.assertCountEqual(self.run_reply(m, r), ['ExponentPushToken[shul]', 'ExponentPushToken[yig]'])

    def test_personal_reply_pushes_only_chosen_adult(self):
        m = self.blessing()
        sent = self.run_reply(m, self.reply(m, 'rep1', 'shul'))
        self.assertEqual({t: s['body'] for t, s in sent.items()}, {'ExponentPushToken[shul]': 'ברכה אישית חדשה'})
        m = self.blessing()
        sent = self.run_reply(m, self.reply(m, 'rep1', 'yig'))
        self.assertEqual({t: s['body'] for t, s in sent.items()}, {'ExponentPushToken[yig]': 'New personal blessing'})
        m = self.blessing('condolence')
        sent = self.run_reply(m, self.reply(m, 'rep1', 'shul'))
        self.assertEqual(sent['ExponentPushToken[shul]']['body'], 'מילה אישית חדשה')

    def test_personal_reply_to_non_adult_or_stranger_sends_nothing(self):
        m = self.blessing()
        self.repo.put_membership(self.k, 'yig', 'listener')
        self.assertEqual(self.run_reply(m, self.reply(m, 'rep1', 'yig')), {})
        self.assertEqual(self.run_reply(m, self.reply(m, 'rep2', 'nobody')), {})

    def test_writer_never_pushed(self):
        m = self.general()
        self.assertEqual(self.run_reply(m, self.reply(m, 'auth', 'author')), {})
        b = self.blessing()
        sent = self.run_reply(b, self.reply(b, 'yig', 'family'))
        self.assertEqual(list(sent), ['ExponentPushToken[shul]'])

    def test_throttle_15_minutes_per_message_per_recipient(self):
        m, other = self.general(), self.general()
        r1, r2, r3 = self.reply(m, 'rep1', 'author'), self.reply(m, 'rep2', 'author'), self.reply(m, 'gab', 'author')
        self.assertEqual(list(self.run_reply(m, r1)), ['ExponentPushToken[auth]'])
        self.now += 60
        self.assertEqual(self.run_reply(m, r2), {})
        self.assertEqual(list(self.run_reply(other, self.reply(other, 'rep1', 'author'))), ['ExponentPushToken[auth]'])
        self.now += 15 * 60 - 60 + 1
        self.assertEqual(list(self.run_reply(m, r3)), ['ExponentPushToken[auth]'])

    def test_throttle_is_per_recipient(self):
        m = self.blessing()
        self.assertEqual(list(self.run_reply(m, self.reply(m, 'rep1', 'shul'))), ['ExponentPushToken[shul]'])
        self.now += 60
        self.assertEqual(list(self.run_reply(m, self.reply(m, 'rep2', 'yig'))), ['ExponentPushToken[yig]'])

    def test_muted_replier_still_pushes(self):
        self.repo.set_notify(self.k, 'auth', {'mutedMembers': ['rep1'], 'mutedChannels': [self.chan['announcements']]})
        m = self.general()
        self.assertEqual(list(self.run_reply(m, self.reply(m, 'rep1', 'author'))), ['ExponentPushToken[auth]'])

    def test_deleted_reply_or_removed_message_sends_nothing(self):
        m = self.general()
        r = self.reply(m, 'rep1', 'author')
        self.repo.delete_reply(self.k, m, f'R#{r}', 'rep1')
        self.assertEqual(self.run_reply(m, r), {})
        r2 = self.reply(m, 'rep2', 'author')
        self.repo.remove_message(self.k, m)
        self.assertEqual(self.run_reply(m, r2), {})
        self.assertEqual(self.run_reply('nomsg', 'norep'), {})

    def test_malformed_ref_sends_nothing(self):
        for ref in ('onlyid', '/', 'a/'):
            self.sent.clear()
            push_worker.handler({'Records': [record('reply', self.k, ref)]}, None)
            self.assertEqual(self.sent, [])

    def test_claim_item_expires_and_log_has_no_text(self):
        m = self.general()
        with self.assertLogs('server.cloud.push_worker', 'INFO') as logs:
            self.run_reply(m, self.reply(m, 'rep1', 'author'))
        self.assertNotIn('secret', '\n'.join(logs.output))
        item = self.repo.table.get_item(Key={'pk': f'K#{self.k}#U#auth', 'sk': f'RXPUSH#{m}'})['Item']
        self.assertEqual((item['at'], item['expiresAt']), (int(self.now), int(self.now) + 3600))

    def test_reply_texts_are_fixed_keys(self):
        self.assertNotIn('reply', push.PUSH_TEXT)
        self.assertEqual(push.REPLY_KEYS, ('private_reply', 'family_blessing', 'family_word', 'personal_blessing',
                                           'personal_word'))
        self.assertEqual(push.FIXED_TEXT_KEYS, push.SYSTEM_KEYS + push.REPLY_KEYS)
        self.assertEqual(push.reply_text_key('condolence', 'family'), 'family_word')
        self.assertEqual(push.reply_text_key('general', 'author'), 'private_reply')
        self.assertEqual(push.reply_text_key('celebration', 'u1'), 'personal_blessing')
        self.assertEqual(push.PUSH_TEXT['personal_word'], {'he': 'מילה אישית חדשה', 'en': 'New personal word'})
        self.assertEqual(push.PUSH_TEXT['family_blessing']['en'], 'New personal blessing for your family')
        self.assertEqual(push.PUSH_TEXT['family_word']['en'], 'New personal word for your family')
