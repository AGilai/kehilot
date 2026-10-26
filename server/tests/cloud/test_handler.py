import json
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import handler as handler_module
from server.cloud.authz import require
from server.cloud.identity import Caller, resolve_user_id
from server.cloud.ids import new_id
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table
from server.validation import APIError


class Context:
    aws_request_id = 'req-1'


def event(method, path, sub='s1', email='a@example.test', body=None):
    return {
        'version': '2.0', 'rawPath': path, 'body': body,
        'requestContext': {'http': {'method': method, 'path': path},
                           'authorizer': {'jwt': {'claims': {'sub': sub, 'email': email}}}},
    }


@mock_aws
class HandlerTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.ka, self.kb = new_id(), new_id()
        self.repo.put_kehila(self.ka, 'קהילה א')
        self.repo.put_kehila(self.kb, 'קהילה ב')
        self.user_id = resolve_user_id(self.repo, Caller('s1', 'a@example.test'))
        self.repo.put_membership(self.ka, self.user_id, 'member')
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, method, path, **kwargs):
        response = handler_module.handler(event(method, path, **kwargs), Context())
        return response['statusCode'], json.loads(response['body'])

    def test_health(self):
        self.assertEqual(self.call('GET', '/health'), (200, {'ok': True}))

    def test_me_lists_only_my_kehilot(self):
        status, body = self.call('GET', '/v1/me')
        self.assertEqual(status, 200)
        self.assertEqual(body['userId'], self.user_id)
        self.assertEqual(body['kehilot'], [{'kehilaId': self.ka, 'name': 'קהילה א', 'role': 'member'}])

    def test_own_kehila_is_200(self):
        status, body = self.call('GET', f'/v1/kehilot/{self.ka}')
        self.assertEqual(status, 200)
        self.assertEqual(body['role'], 'member')

    def test_other_kehila_is_404(self):
        other = self.call('GET', f'/v1/kehilot/{self.kb}')
        missing = self.call('GET', f'/v1/kehilot/{new_id()}')
        self.assertEqual(other[0], 404)
        self.assertEqual(other, missing)

    def test_bad_kehila_id_is_400(self):
        for k in ('A%23B', 'abc', '0' * 27, self.ka.lower()):
            self.assertEqual(self.call('GET', f'/v1/kehilot/{k}')[0], 400, k)

    def test_listener_blocked_by_role_filter(self):
        with self.assertRaises(APIError) as caught:
            require(self.repo, self.user_id, self.ka, ('gabbai',))
        self.assertEqual(caught.exception.status, 403)

    def test_malformed_json_body_is_400(self):
        self.assertEqual(self.call('GET', '/v1/me', body='{not json')[0], 400)

    def test_unknown_route_is_json_404(self):
        self.assertEqual(self.call('GET', '/v1/nope'), (404, {'error': 'not_found'}))

    def test_wrong_method_is_405(self):
        self.assertEqual(self.call('POST', '/v1/me')[0], 405)

    def test_unexpected_error_is_500_without_details(self):
        with mock.patch.object(Repo, 'list_memberships', side_effect=RuntimeError('secret')), \
                self.assertLogs(level='ERROR') as logs:
            status, body = self.call('GET', '/v1/me')
        self.assertEqual((status, body), (500, {'error': 'internal'}))
        self.assertNotIn('secret', ' '.join(logs.output))
