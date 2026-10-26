import base64
import json
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import handler as handler_module
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table
from server.tests.cloud.test_handler import Context, event

TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'


@mock_aws
class MeTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, method, path, sub='s1', body=None, raw=None):
        evt = event(method, path, sub=sub, body=raw if raw is not None else json.dumps(body) if body is not None else None)
        response = handler_module.handler(evt, Context())
        return response['statusCode'], json.loads(response['body']) if response['body'] else None

    def user_id(self, sub):
        return self.call('GET', '/v1/me', sub=sub)[1]['userId']

    def test_profile_roundtrip_with_lang(self):
        self.assertIsNone(self.call('GET', '/v1/me')[1]['profile'])
        profile = {'firstName': 'Dana', 'lastName': 'Test', 'lang': 'en'}
        self.assertEqual(self.call('PUT', '/v1/me/profile', body=profile), (200, profile))
        self.assertEqual(self.call('GET', '/v1/me')[1]['profile'], profile)

    def test_profile_rejects_unknown_lang(self):
        status, body = self.call('PUT', '/v1/me/profile', body={'firstName': 'Dana', 'lastName': 'T', 'lang': 'fr'})
        self.assertEqual((status, body), (400, {'error': 'invalid_lang'}))

    def test_profile_name_limits(self):
        for bad in ({'firstName': ''}, {'firstName': 'x' * 61}, {'lastName': 'x' * 61}, {'firstName': 5}):
            body = {'firstName': 'Dana', 'lastName': 'T', 'lang': 'he', **bad}
            self.assertEqual(self.call('PUT', '/v1/me/profile', body=body)[0], 400, bad)

    def test_device_moves_between_users(self):
        a, b = self.user_id('s1'), self.user_id('s2')
        self.assertEqual(self.call('PUT', '/v1/me/devices', sub='s1', body={'token': TOKEN_A, 'platform': 'ios'})[0], 204)
        self.assertEqual([d['token'] for d in self.repo.list_devices(a)], [TOKEN_A])
        self.assertEqual(self.call('PUT', '/v1/me/devices', sub='s2', body={'token': TOKEN_A, 'platform': 'android'})[0], 204)
        self.assertEqual(self.repo.list_devices(a), [])
        self.assertEqual([d['token'] for d in self.repo.list_devices(b)], [TOKEN_A])

    def test_delete_device(self):
        a = self.user_id('s1')
        self.call('PUT', '/v1/me/devices', body={'token': TOKEN_A, 'platform': 'web'})
        self.assertEqual(self.call('DELETE', '/v1/me/devices/ExponentPushToken%5Baaaaaaaaaaaaaaaaaaaaaa%5D')[0], 204)
        self.assertEqual(self.repo.list_devices(a), [])
        self.assertEqual(self.call('DELETE', f'/v1/me/devices/{TOKEN_A}')[0], 204)

    def test_bad_token_format_is_400(self):
        for token in ('abc', 'ExponentPushToken[short]', 'ExponentPushToken[aaaaaaaaaaaa]x', 5):
            status, body = self.call('PUT', '/v1/me/devices', body={'token': token, 'platform': 'ios'})
            self.assertEqual((status, body), (400, {'error': 'invalid_token'}), token)
        self.assertEqual(self.call('PUT', '/v1/me/devices', body={'token': TOKEN_A, 'platform': 'palm'})[1],
                         {'error': 'invalid_platform'})

    def test_base64_body_decoded(self):
        evt = event('PUT', '/v1/me/profile', body=base64.b64encode(
            json.dumps({'firstName': 'דנה', 'lastName': 'בדיקה', 'lang': 'he'}).encode()).decode())
        evt['isBase64Encoded'] = True
        response = handler_module.handler(evt, Context())
        self.assertEqual(response['statusCode'], 200)
        self.assertEqual(json.loads(response['body'])['firstName'], 'דנה')

    def test_body_over_16kb_is_400(self):
        body = {'firstName': 'Dana', 'lastName': 'T', 'lang': 'he', 'pad': 'x' * 16384}
        self.assertEqual(self.call('PUT', '/v1/me/profile', body=body), (400, {'error': 'invalid_body'}))

    def test_body_must_be_object(self):
        self.assertEqual(self.call('PUT', '/v1/me/profile', raw='[1]'), (400, {'error': 'invalid_body'}))
        self.assertEqual(self.call('PUT', '/v1/me/profile'), (400, {'error': 'invalid_body'}))
