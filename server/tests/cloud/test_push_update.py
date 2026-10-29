import json
import os
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import expo, push, push_worker
from server.cloud.repo import Repo
from server.tests.cloud.helpers import ensure_member_channels, make_table
from server.tests.cloud.test_push import record

SHIVA = {'variant': 'full', 'surname': 'ניסיון', 'deceased': 'יוסף', 'relation': 'אביו של משה',
         'address': 'רחוב הדוגמה 5', 'until': '2026-11-09'}
EVENT = {'name': 'ערב לימוד', 'date': '2026-11-10', 'time': '21:00', 'place': 'בית הכנסת', 'for': 'all'}


def shiva_message(**fields):
    return {'type': 'condolence', 'fields': {**SHIVA, **fields}}


def event_message(changed, **fields):
    return {'type': 'event', 'fields': {**EVENT, **fields}, 'changed': changed}


class UpdateTextsTest(unittest.TestCase):
    def test_shiva_texts_he_en(self):
        # Owner ruling (UX-DESIGN 19.2a, e441679): no address and no days in the push; the body is the Kehila name.
        self.assertEqual(push.update_texts(shiva_message(), 'he', 'בית הדוגמה'),
                         ('עודכנו פרטי השבעה · משפחת ניסיון', 'בית הדוגמה'))
        self.assertEqual(push.update_texts(shiva_message(), 'en', 'Beit Test'),
                         ('Shiva details updated · ניסיון family', 'Beit Test'))
        title, body = push.update_texts(shiva_message(), 'he', 'בית הדוגמה')
        for private in ('רחוב', 'יוסף', 'אביו', '9.11', 'עד'):
            self.assertNotIn(private, title + body)

    def test_event_texts_what_changed_and_cancelled(self):
        self.assertEqual(push.update_texts(event_message({'time': '20:30'}), 'he', 'Beit Test'),
                         ('שינוי בערב לימוד: 21:00', 'Beit Test'))
        self.assertEqual(push.update_texts(event_message({'time': '20:30'}, cancelled=True), 'he', 'Beit Test')[0],
                         'שינוי בערב לימוד: בוטל')
        self.assertEqual(push.update_texts(event_message({'time': '20:30'}), 'en', 'Beit Test')[0],
                         'Change to ערב לימוד: 21:00')
        self.assertEqual(push.update_texts(event_message({'time': '20:30'}, cancelled=True), 'en', 'K')[0],
                         'Change to ערב לימוד: cancelled')

    def test_event_what_order_time_date_place_without_address(self):
        title, _ = push.update_texts(event_message({'place': 'x', 'date': 'y', 'time': 'z'}), 'he', 'K')
        self.assertEqual(title, 'שינוי בערב לימוד: 21:00 · יום ג׳ (10.11) · בית הכנסת')
        title, _ = push.update_texts(event_message({'date': 'y'}), 'en', 'K')
        self.assertEqual(title, 'Change to ערב לימוד: Tue 10.11')

    def test_short_day(self):
        self.assertEqual(push.short_day('2026-11-09', 'he'), 'יום ב׳ (9.11)')
        self.assertEqual(push.short_day('2026-11-09', 'en'), 'Mon 9.11')
        self.assertEqual(push.short_day('2026-11-14', 'he'), 'שבת (14.11)')

    def test_texts_cut_to_80_code_points(self):
        title, body = push.update_texts(shiva_message(surname='ל' * 120), 'he', 'ב' * 120)
        self.assertEqual((len(title), len(body)), (80, 80))
        self.assertTrue(title.endswith('…') and body.endswith('…'))
        title, _ = push.update_texts(event_message({'time': 'x'}, name='א' * 200), 'he', 'K')
        self.assertEqual(len(title), 80)

    def test_update_text_not_editable(self):
        self.assertNotIn('shiva', push.PUSH_TEXT)
        self.assertNotIn('message_update', push.PUSH_TEXT)


@mock_aws
class UpdatePushTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.k = self.repo.create_kehila('Beit Test', {})
        ensure_member_channels(self.repo, self.k)
        self.chan = {c['name']: c['sk'][2:] for c in self.repo.list_channels(self.k)}
        self.gab = self.user('gab', 'gabbai', 'he')
        self.updater = self.user('upd', 'member', 'he')
        self.reader = self.user('rea', 'member', 'en')
        self.sent = []
        patches = [mock.patch.object(expo, 'send', side_effect=self.fake_send),
                   mock.patch.object(expo, 'access_token', return_value=None),
                   mock.patch.object(push_worker, '_repo', return_value=self.repo)]
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

    def condolence(self, fields=SHIVA):
        m = self.repo.put_message(self.k, self.chan['simchas'], 'condolence', 't', 'b', 'gab', 'G', 'management',
                                  None, template_id='condolence', fields=fields)['sk'][4:]
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'MSG#{m}'}, UpdateExpression='SET updatedBy = :u',
                                    ExpressionAttributeValues={':u': 'upd'})
        return m

    def run_job(self, m):
        self.sent.clear()
        out = push_worker.handler({'Records': [record('message_update', self.k, m)]}, None)
        self.assertEqual(out, {'batchItemFailures': []})
        return {s['to']: s for s in self.sent}

    def test_quiet_message_shape(self):
        m = self.condolence()
        sent = self.run_job(m)
        self.assertIn('ExponentPushToken[rea]', sent)
        for s in sent.values():
            self.assertEqual((s['priority'], s['channelId'], s['interruptionLevel']), ('normal', 'quiet', 'passive'))
            self.assertNotIn('sound', s)
            self.assertEqual(s['data'], {'kehila': self.k, 'messageId': m})
        self.assertEqual(sent['ExponentPushToken[rea]']['title'], 'Shiva details updated · ניסיון family')
        self.assertEqual(sent['ExponentPushToken[gab]']['title'], 'עודכנו פרטי השבעה · משפחת ניסיון')
        self.assertEqual(sent['ExponentPushToken[rea]']['body'], 'Beit Test')

    def test_custom_push_text_does_not_apply(self):
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': 'META'}, UpdateExpression='SET pushTexts = :p',
                                    ExpressionAttributeValues={':p': {'condolence': {'he': 'custom!', 'en': 'custom!'}}})
        sent = self.run_job(self.condolence())
        self.assertNotIn('custom!', json.dumps(list(sent.values()), ensure_ascii=False))

    def test_event_update_push(self):
        m = self.repo.put_message(self.k, self.chan['announcements'], 'event', 't', 'b', 'gab', 'G', 'management',
                                  None, template_id='event', fields=EVENT)['sk'][4:]
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'MSG#{m}'}, UpdateExpression='SET changed = :c',
                                    ExpressionAttributeValues={':c': {'time': '20:30'}})
        sent = self.run_job(m)
        self.assertEqual(sent['ExponentPushToken[rea]']['title'], 'Change to ערב לימוד: 21:00')

    def test_updater_and_muted_not_recipients(self):
        muted_type = self.user('mut', 'member', 'he')
        muted_author = self.user('mua', 'member', 'he')
        self.repo.set_notify(self.k, muted_type, {'mutedTypes': ['condolence']})
        self.repo.set_notify(self.k, muted_author, {'mutedMembers': ['gab']})
        m = self.condolence()
        recipients = push_worker.recipients(self.repo, 'message_update', self.k, m)
        self.assertNotIn('upd', recipients)       # the updater
        self.assertNotIn(muted_type, recipients)
        self.assertNotIn(muted_author, recipients)
        self.assertIn('gab', recipients)           # the author is told when somebody else updated
        self.assertIn('rea', recipients)

    def test_message_kind_still_excludes_author_not_updater(self):
        m = self.condolence()
        found = push_worker.recipients(self.repo, 'message', self.k, m)
        self.assertIn('upd', found)
        self.assertNotIn('gab', found)

    def test_removed_or_missing_message_sends_nothing(self):
        m = self.condolence()
        self.repo.remove_message(self.k, m)
        self.assertEqual(self.run_job(m), {})
        self.assertEqual(self.run_job('01ARZ3NDEKTSV4RRFFQ69G5FAV'), {})

    def test_job_carries_ids_only(self):
        sent = []
        with mock.patch.dict(os.environ, {'PUSH_QUEUE_URL': 'q'}), mock.patch('boto3.client') as client:
            client.return_value.send_message.side_effect = lambda **kw: sent.append(kw)
            push.enqueue('message_update', self.k, 'm1')
        self.assertEqual(json.loads(sent[0]['MessageBody']), {'kind': 'message_update', 'kehila': self.k, 'ref': 'm1'})


if __name__ == '__main__':
    unittest.main()
