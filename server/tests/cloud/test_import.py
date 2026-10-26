import json
import os
import unittest
from unittest import mock

import boto3
from moto import mock_aws

from server.cloud import accounts
from server.cloud import handler as handler_module
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table
from server.tests.cloud.test_handler import Context, event

IMPORT = '/v1/kehilot/{}/admin/import'


def row(first='Dana', last='Example', email='dana@example.test', role='member', classification=''):
    return {'firstName': first, 'lastName': last, 'email': email, 'role': role, 'classification': classification}


@mock_aws
class ImportTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.cognito = boto3.client('cognito-idp', region_name='il-central-1')
        self.pool = self.cognito.create_user_pool(PoolName='p', UsernameAttributes=['email'])['UserPool']['Id']
        for patcher in (mock.patch.object(handler_module, '_repo', return_value=self.repo),
                        mock.patch.object(accounts, 'cognito_client', return_value=self.cognito),
                        mock.patch.dict(os.environ, {'USER_POOL_ID': self.pool})):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.k = self.repo.create_kehila('Beit Alef', {})
        self.gab = self.signin('sub-gab', 'gab@example.test')
        self.repo.put_membership(self.k, self.gab, 'gabbai')

    def signin(self, sub, email):
        return self.call('GET', '/v1/me', sub, email)[1]['userId']

    def call(self, method, path, sub='sub-gab', email='gab@example.test', body=None):
        response = handler_module.handler(
            event(method, path, sub=sub, email=email, body=json.dumps(body) if body is not None else None),
            Context())
        return response['statusCode'], json.loads(response['body']) if response['body'] else None

    def do_import(self, rows, **kwargs):
        return self.call('POST', IMPORT.format(self.k), body={'rows': rows}, **kwargs)

    def cognito_users(self):
        return self.cognito.list_users(UserPoolId=self.pool)['Users']

    def user_by_email(self, email):
        return self.cognito.admin_get_user(UserPoolId=self.pool, Username=email)

    def user_id_of(self, email):
        sub = next(a['Value'] for a in self.user_by_email(email)['UserAttributes'] if a['Name'] == 'sub')
        return self.repo.get_user_id(sub)

    def test_import_creates_confirmed_verified_user_without_email_sent(self):
        status, body = self.do_import([row()])
        self.assertEqual((status, body), (200, {'results': [{'index': 0, 'status': 'created'}]}))
        user = self.user_by_email('dana@example.test')
        self.assertEqual(user['UserStatus'], 'CONFIRMED')
        attrs = {a['Name']: a['Value'] for a in user['UserAttributes']}
        self.assertEqual(attrs['email_verified'], 'true')
        member = self.repo.get_membership(self.k, self.user_id_of('dana@example.test'))
        self.assertEqual((member['role'], member['displayName']), ('member', 'Dana Example'))
        self.assertEqual(self.repo.get_profile(self.user_id_of('dana@example.test')),
                         {'firstName': 'Dana', 'lastName': 'Example', 'lang': 'he'})

    def test_create_suppresses_message_and_sets_random_permanent_password(self):
        with mock.patch.object(self.cognito, 'admin_create_user', wraps=self.cognito.admin_create_user) as create, \
                mock.patch.object(self.cognito, 'admin_set_user_password',
                                  wraps=self.cognito.admin_set_user_password) as setpw:
            self.do_import([row(), row('Eli', 'Example', 'eli@example.test')])
        self.assertEqual(create.call_args.kwargs['MessageAction'], 'SUPPRESS')
        self.assertTrue(setpw.call_args.kwargs['Permanent'])
        passwords = [c.kwargs['Password'] for c in setpw.call_args_list]
        self.assertEqual(len(set(passwords)), 2)
        self.assertTrue(all(len(p) >= 12 for p in passwords))
        self.assertNotIn(passwords[0], json.dumps(self.repo.table.scan()['Items'], default=str))

    def test_import_existing_cognito_user_only_adds_membership(self):
        self.cognito.admin_create_user(UserPoolId=self.pool, Username='dana@example.test', UserAttributes=[
            {'Name': 'email', 'Value': 'dana@example.test'}, {'Name': 'email_verified', 'Value': 'true'}])
        with mock.patch.object(self.cognito, 'admin_create_user') as create:
            status, body = self.do_import([row()])
        create.assert_not_called()
        self.assertEqual(body['results'], [{'index': 0, 'status': 'added'}])
        self.assertEqual(len(self.cognito_users()), 1)
        self.assertEqual(self.repo.get_membership(self.k, self.user_id_of('dana@example.test'))['role'], 'member')

    def test_email_is_stripped_and_lowercased(self):
        self.do_import([row(email='  Dana@Example.TEST ')])
        self.assertIsNotNone(self.user_id_of('dana@example.test'))

    def test_reimport_is_idempotent(self):
        rows = [row(), row('Eli', 'Example', 'eli@example.test', 'listener')]
        self.do_import(rows)
        ids = [self.user_id_of(r['email']) for r in rows]
        members = len(self.repo.list_members(self.k))
        status, body = self.do_import(rows)
        self.assertEqual([r['status'] for r in body['results']], ['exists', 'exists'])
        self.assertEqual([self.user_id_of(r['email']) for r in rows], ids)
        self.assertEqual(len(self.cognito_users()), 2)
        self.assertEqual(len(self.repo.list_members(self.k)), members)

    def test_import_upgrades_listener_and_clears_request(self):
        self.do_import([row(role='listener')])
        uid = self.user_id_of('dana@example.test')
        self.repo.put_request(self.k, uid, 'Dana Example', False, 1)
        status, body = self.do_import([row(role='member', classification='א')])
        self.assertEqual(body['results'], [{'index': 0, 'status': 'upgraded'}])
        member = self.repo.get_membership(self.k, uid)
        self.assertEqual((member['role'], member['classification']), ('member', 'א'))
        self.assertIsNone(self.repo.get_request(self.k, uid))

    def test_import_does_not_downgrade_or_change_other_roles(self):
        self.do_import([row(role='gabbai'), row('Eli', 'Example', 'eli@example.test', 'member')])
        status, body = self.do_import([row(role='listener'), row('Eli', 'Example', 'eli@example.test', 'gabbai')])
        self.assertEqual([r['status'] for r in body['results']], ['exists', 'exists'])
        self.assertEqual(self.repo.get_membership(self.k, self.user_id_of('dana@example.test'))['role'], 'gabbai')
        self.assertEqual(self.repo.get_membership(self.k, self.user_id_of('eli@example.test'))['role'], 'member')

    def test_member_broadcast_follows_kehila_default(self):
        self.repo.set_all_broadcast(self.k, True)
        self.do_import([row(), row('Eli', 'Example', 'eli@example.test', 'listener')])
        self.assertTrue(self.repo.get_membership(self.k, self.user_id_of('dana@example.test'))['canBroadcast'])
        self.assertFalse(self.repo.get_membership(self.k, self.user_id_of('eli@example.test'))['canBroadcast'])

    def test_profile_language_is_kehila_default(self):
        k2 = self.repo.create_kehila('Beit Bet', {'defaultLang': 'en'})
        self.repo.put_membership(k2, self.gab, 'gabbai')
        self.call('POST', IMPORT.format(k2), body={'rows': [row()]})
        self.assertEqual(self.repo.get_profile(self.user_id_of('dana@example.test'))['lang'], 'en')

    def test_import_does_not_overwrite_existing_profile(self):
        self.do_import([row()])
        uid = self.user_id_of('dana@example.test')
        self.repo.put_profile(uid, 'Dani', 'Mine', 'en')
        self.do_import([row(first='Other', last='Name')])
        self.assertEqual(self.repo.get_profile(uid), {'firstName': 'Dani', 'lastName': 'Mine', 'lang': 'en'})

    def test_import_of_deleted_account_creates_a_new_user(self):
        self.do_import([row()])
        old_sub = next(a['Value'] for a in self.user_by_email('dana@example.test')['UserAttributes']
                       if a['Name'] == 'sub')
        old_id = self.user_id_of('dana@example.test')
        self.repo.purge_user(old_id, old_sub)
        self.cognito.admin_delete_user(UserPoolId=self.pool, Username='dana@example.test')
        status, body = self.do_import([row()])
        self.assertEqual(body['results'], [{'index': 0, 'status': 'created'}])
        new_id = self.user_id_of('dana@example.test')
        self.assertNotEqual(new_id, old_id)
        self.assertEqual(self.repo.get_membership(self.k, new_id)['role'], 'member')

    def test_username_exists_race_reads_the_user_again(self):
        self.cognito.admin_create_user(UserPoolId=self.pool, Username='dana@example.test', UserAttributes=[
            {'Name': 'email', 'Value': 'dana@example.test'}])
        real_get = self.cognito.admin_get_user
        calls = []

        def flaky_get(**kwargs):
            calls.append(1)
            if len(calls) == 1:
                raise self.cognito.exceptions.UserNotFoundException({'Error': {'Code': 'UserNotFoundException'}}, 'x')
            return real_get(**kwargs)
        with mock.patch.object(self.cognito, 'admin_get_user', side_effect=flaky_get):
            sub, created = accounts.ensure_account(self.cognito, self.pool, 'dana@example.test')
        self.assertFalse(created)
        self.assertTrue(sub)

    def test_duplicate_email_in_one_batch_reported_once(self):
        status, body = self.do_import([row(), row('Eli', 'Example', 'DANA@example.test')])
        self.assertEqual(body['results'], [{'index': 0, 'status': 'created'},
                                           {'index': 1, 'status': 'invalid', 'error': 'duplicate_email'}])
        self.assertEqual(len(self.cognito_users()), 1)

    def test_invalid_rows_are_reported_per_row_and_valid_ones_still_import(self):
        rows = [row(email='nope'), row(first=' '), row(last='x' * 61), row(role='boss'),
                row(classification='לוי'), row(email='x' * 250 + '@example.test'), row(first=5), row('Ok', 'Fine', 'ok@example.test')]
        status, body = self.do_import(rows)
        self.assertEqual(status, 200)
        self.assertEqual([(r['status'], r.get('error')) for r in body['results']], [
            ('invalid', 'invalid_email'), ('invalid', 'invalid_first_name'), ('invalid', 'invalid_last_name'),
            ('invalid', 'invalid_role'), ('invalid', 'invalid_classification'), ('invalid', 'invalid_email'),
            ('invalid', 'invalid_first_name'), ('created', None)])
        self.assertEqual(len(self.cognito_users()), 1)

    def test_results_contain_no_pii(self):
        status, body = self.do_import([row(), row('Eli', 'Levi-Example', 'eli@example.test'),
                                       row('Bad', 'Row', 'bad-email')])
        text = json.dumps(body, ensure_ascii=False)
        for secret in ('Dana', 'Example', 'Eli', 'Levi', 'Bad', 'Row', '@', 'bad-email'):
            self.assertNotIn(secret, text)

    def test_import_logs_contain_no_pii(self):
        with self.assertLogs('server.cloud', level='INFO') as logs:
            self.do_import([row(), row('Eli', 'Levi-Example', 'eli@example.test'), row('Bad', 'Row', 'bad-email')])
        text = '\n'.join(logs.output)
        for secret in ('Dana', 'Example', 'Eli', 'Levi', 'Bad', 'bad-email', '@'):
            self.assertNotIn(secret, text)
        self.assertIn('created=2', text)

    def test_cognito_failure_logs_no_pii(self):
        error = self.cognito.exceptions.InvalidParameterException(
            {'Error': {'Code': 'InvalidParameterException', 'Message': 'bad dana@example.test'}}, 'AdminCreateUser')
        with mock.patch.object(self.cognito, 'admin_create_user', side_effect=error):
            with self.assertLogs('server.cloud', level='INFO') as logs:
                status, body = self.do_import([row()])
        self.assertEqual((status, body), (500, {'error': 'internal'}))
        self.assertNotIn('dana', '\n'.join(logs.output))

    def test_failed_password_set_removes_the_half_created_user(self):
        error = self.cognito.exceptions.InvalidPasswordException(
            {'Error': {'Code': 'InvalidPasswordException', 'Message': 'x'}}, 'AdminSetUserPassword')
        with mock.patch.object(self.cognito, 'admin_set_user_password', side_effect=error):
            status, body = self.do_import([row()])
        self.assertEqual(status, 500)
        self.assertEqual(self.cognito_users(), [])

    def test_member_cannot_import(self):
        member = self.signin('sub-m', 'm@example.test')
        self.repo.put_membership(self.k, member, 'member')
        status, body = self.do_import([row()], sub='sub-m', email='m@example.test')
        self.assertEqual((status, body), (403, {'error': 'forbidden'}))
        self.assertEqual(self.cognito_users(), [])

    def test_more_than_25_rows_is_400(self):
        rows = [row('A', 'B', f'p{i}@example.test') for i in range(26)]
        self.assertEqual(self.do_import(rows), (400, {'error': 'invalid_rows'}))
        self.assertEqual(self.do_import([]), (400, {'error': 'invalid_rows'}))
        self.assertEqual(self.do_import(['x']), (400, {'error': 'invalid_rows'}))
        self.assertEqual(self.call('POST', IMPORT.format(self.k), body={'rows': 'x'}), (400, {'error': 'invalid_rows'}))
        self.assertEqual(len(self.do_import(rows[:25])[1]['results']), 25)

    def test_body_over_64kb_is_400(self):
        big = [row('A' * 60, 'B', f'p{i}@example.test') for i in range(25)] + [{'pad': 'x' * 70000}]
        self.assertEqual(self.do_import(big)[0], 400)
