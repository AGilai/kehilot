import json
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import expo, push, push_worker
from server.cloud import handler as handler_module
from server.cloud.push import PUSH_TEXT
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table
from server.tests.cloud.test_handler import Context, event
from server.tests.cloud.test_push import record


@mock_aws
class PushTextsTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.sent = []
        patches = [mock.patch.object(handler_module, '_repo', return_value=self.repo),
                   mock.patch.object(expo, 'send', side_effect=self.fake_send),
                   mock.patch.object(expo, 'access_token', return_value=None),
                   mock.patch.object(push_worker, '_repo', return_value=self.repo)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.k = self.repo.create_kehila('Beit Test', {})
        self.chan = {c['name']: c['sk'][2:] for c in self.repo.list_channels(self.k)}
        self.gab = self.user('gab', 'gabbai', 'en')
        self.fam = self.user('fam', 'member', 'he')
        self.eng = self.user('eng', 'member', 'en')

    def fake_send(self, messages, token):
        self.sent += messages
        return [{'status': 'ok', 'id': f'tk{len(self.sent)}-{i}'} for i, _ in enumerate(messages)]

    def user(self, sub, role, lang):
        evt_id = self.call('GET', '/v1/me', sub=sub)[1]['userId']
        self.repo.put_membership(self.k, evt_id, role)
        self.repo.put_profile(evt_id, sub, 'X', lang)
        self.repo.put_device(evt_id, f'ExponentPushToken[{sub}]', 'ios')
        return evt_id

    def call(self, method, path, sub='gab', body=None):
        evt = event(method, path, sub=sub, body=json.dumps(body) if body is not None else None)
        response = handler_module.handler(evt, Context())
        return response['statusCode'], json.loads(response['body']) if response['body'] else None

    def url(self):
        return f'/v1/kehilot/{self.k}/admin/push-texts'

    def put(self, key, lang, text, sub='gab'):
        return self.call('PUT', self.url(), sub=sub, body={'key': key, 'lang': lang, 'text': text})

    def run_celebration(self):
        self.sent.clear()
        item = self.repo.put_message(self.k, self.chan['announcements'], 'celebration', 't', 'b', self.gab, 'A',
                                     'management', None)
        push_worker.handler({'Records': [record('message', self.k, item['sk'][4:])]}, None)
        return {s['to']: s for s in self.sent}

    def test_custom_push_text_used_for_that_lang_only(self):
        self.assertEqual(self.put('celebration', 'en', 'Mazal tov!')[0], 200)
        sent = self.run_celebration()
        self.assertEqual(sent['ExponentPushToken[eng]']['body'], 'Mazal tov!')
        self.assertEqual(sent['ExponentPushToken[fam]']['body'], PUSH_TEXT['celebration']['he'])
        status, body = self.call('GET', self.url())
        self.assertEqual((status, body['custom'], body['defaults']),
                         (200, {'celebration': {'en': 'Mazal tov!'}},
                          {key: v for key, v in PUSH_TEXT.items() if key not in push.FIXED_TEXT_KEYS}))
        self.assertEqual(self.repo.get_kehila(self.k)['name'], 'Beit Test')  # other META fields are kept
        self.assertIn('settings', self.repo.get_kehila(self.k))

    def test_empty_text_resets_to_default(self):
        self.put('celebration', 'en', 'Mazal tov!')
        self.put('celebration', 'he', 'מזל טוב')
        self.assertEqual(self.put('celebration', 'en', '')[0], 200)
        sent = self.run_celebration()
        self.assertEqual(sent['ExponentPushToken[eng]']['body'], PUSH_TEXT['celebration']['en'])
        self.assertEqual(sent['ExponentPushToken[fam]']['body'], 'מזל טוב')
        self.assertEqual(self.call('GET', self.url())[1]['custom'], {'celebration': {'he': 'מזל טוב'}})
        self.assertEqual(self.put('celebration', 'en', '')[0], 200)  # removing an absent entry is fine
        self.put('celebration', 'he', '')
        self.assertEqual(self.call('GET', self.url())[1]['custom'], {})

    def test_reply_key_not_editable(self):
        defaults = self.call('GET', self.url())[1]['defaults']
        for key in ('reply', *push.REPLY_KEYS):
            self.assertNotIn(key, defaults)
            self.assertEqual(self.put(key, 'en', 'x'), (400, {'error': 'invalid_key'}), key)
        self.assertEqual(push.resolve_text({'pushTexts': {'private_reply': {'en': 'x'}}}, 'private_reply', 'en'),
                         'New private reply')

    def test_member_cannot_edit_push_texts(self):
        self.assertEqual(self.put('celebration', 'en', 'x', sub='eng')[0], 403)
        self.assertEqual(self.call('GET', self.url(), sub='eng')[0], 403)
        self.assertEqual(self.call('GET', self.url())[1]['custom'], {})

    def test_push_text_too_long_or_multiline_400(self):
        self.assertEqual(self.put('celebration', 'en', 'x' * 80)[0], 200)
        self.assertEqual(self.put('celebration', 'en', 'x' * 81), (400, {'error': 'invalid_text'}))
        self.assertEqual(self.put('celebration', 'en', '😀' * 80)[0], 200)  # code points, not UTF-16 units
        for bad in ('a\nb', 'a\rb', 'a b', 5, None):
            self.assertEqual(self.put('celebration', 'en', bad), (400, {'error': 'invalid_text'}), repr(bad))
        self.assertEqual(self.put('nope', 'en', 'x'), (400, {'error': 'invalid_key'}))
        self.assertEqual(self.put('celebration', 'fr', 'x'), (400, {'error': 'invalid_lang'}))
        self.assertEqual(self.put('__proto__', 'en', 'x'), (400, {'error': 'invalid_key'}))

    def test_payload_data_still_generic(self):
        self.put('celebration', 'en', 'Mazal tov!')
        sent = self.run_celebration()
        self.assertTrue(sent)
        for s in sent.values():
            self.assertLessEqual(set(s['data']), {'kehila', 'messageId', 'screen'})
            self.assertEqual(s['title'], 'Beit Test')
        self.assertEqual(push.resolve_text({}, 'celebration', 'en'), PUSH_TEXT['celebration']['en'])
        self.assertEqual(push.resolve_text({'pushTexts': {'celebration': {'en': ''}}}, 'celebration', 'en'),
                         PUSH_TEXT['celebration']['en'])

    def test_control_and_bidi_characters_rejected_and_strip_first(self):
        for code in (0x09, 0x00, 0x1f, 0x7f, 0x85, 0x9f, 0x2028, 0x2029, 0x200e, 0x200f, 0x202a, 0x202e,
                     0x2066, 0x2069):
            self.assertEqual(self.put('celebration', 'en', 'a' + chr(code) + 'b'), (400, {'error': 'invalid_text'}),
                             hex(code))
        self.assertEqual(self.put('celebration', 'en', 'a\u200db\u05d0')[0], 200)  # ZWJ and Hebrew are fine
        self.assertEqual(self.put('celebration', 'en', '  ' + 'x' * 80 + '  ')[0], 200)  # strip, then length
        self.assertEqual(self.call('GET', self.url())[1]['custom'], {'celebration': {'en': 'x' * 80}})
        self.assertEqual(self.put('celebration', 'en', '\t')[0], 400)

    def test_other_kehila_gabbai_gets_404_and_nothing_written(self):
        other_k = self.repo.create_kehila('Beit Other', {})
        outsider = self.call('GET', '/v1/me', sub='outsider')[1]['userId']
        self.repo.put_membership(other_k, outsider, 'gabbai')
        url = f'/v1/kehilot/{self.k}/admin/push-texts'
        self.assertEqual(self.call('PUT', url, sub='outsider', body={'key': 'reply', 'lang': 'en', 'text': 'x'}),
                         (404, {'error': 'kehila_not_found'}))
        self.assertEqual(self.call('GET', url, sub='outsider'), (404, {'error': 'kehila_not_found'}))
        self.assertEqual(self.call('GET', self.url())[1]['custom'], {})

    def test_set_after_last_language_removed_reuses_empty_key_map(self):
        self.put('event', 'en', 'a')
        self.put('event', 'en', '')
        self.assertEqual(self.put('event', 'he', 'ב')[0], 200)
        self.assertEqual(self.call('GET', self.url())[1]['custom'], {'event': {'he': 'ב'}})
