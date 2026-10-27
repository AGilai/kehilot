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
                         {'firstName': 'Dana', 'lastName': 'Example', 'lang': 'he', 'phone': None})

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

    def test_import_sets_imported_card_once(self):
        self.do_import([row()])
        sub = self.cognito_users()[0]['Username']
        card = lambda: self.call('GET', f'/v1/kehilot/{self.k}', sub, 'dana@example.test')[1]['cards']['imported']
        self.assertTrue(card())
        status, _ = self.call('POST', f'/v1/kehilot/{self.k}/me/cards/imported/dismiss', sub, 'dana@example.test')
        self.assertEqual(status, 204)
        self.assertFalse(card())
        self.assertEqual(self.do_import([row()])[1]['results'][0]['status'], 'exists')
        self.assertFalse(card())

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
        self.assertEqual(self.repo.get_profile(uid), {'firstName': 'Dani', 'lastName': 'Mine', 'lang': 'en', 'phone': None})

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

    def test_more_than_10_rows_is_400(self):
        rows = [row('A', 'B', f'p{i}@example.test') for i in range(11)]
        self.assertEqual(self.do_import(rows), (400, {'error': 'invalid_rows'}))
        self.assertEqual(self.do_import([]), (400, {'error': 'invalid_rows'}))
        self.assertEqual(self.do_import(['x']), (400, {'error': 'invalid_rows'}))
        self.assertEqual(self.call('POST', IMPORT.format(self.k), body={'rows': 'x'}), (400, {'error': 'invalid_rows'}))
        self.assertEqual(len(self.do_import(rows[:10])[1]['results']), 10)

    def test_body_over_64kb_is_400(self):
        status, body = self.do_import([row(first='A' * 70000)])
        self.assertEqual((status, body), (400, {'error': 'invalid_body'}))
        self.assertEqual(self.cognito_users(), [])

    def test_create_uses_sub_from_create_response_without_second_lookup(self):
        with mock.patch.object(self.cognito, 'admin_get_user', wraps=self.cognito.admin_get_user) as get:
            self.do_import([row()])
        self.assertEqual(get.call_count, 1)

    def test_ensure_account_lowercases_and_strips(self):
        sub, created = accounts.ensure_account(self.cognito, self.pool, '  Dana@Example.TEST ')
        self.assertTrue(created)
        self.assertEqual(accounts.ensure_account(self.cognito, self.pool, 'dana@example.test'), (sub, False))
        self.assertEqual(len(self.cognito_users()), 1)

    def make_user(self, status):
        """A moto user in FORCE_CHANGE_PASSWORD (the default after admin_create_user) or UNCONFIRMED."""
        if status == 'UNCONFIRMED':
            self.cognito.sign_up(ClientId=self.cognito.create_user_pool_client(
                UserPoolId=self.pool, ClientName='c')['UserPoolClient']['ClientId'],
                Username='dana@example.test', Password='Chosen-By-Stranger1!',
                UserAttributes=[{'Name': 'email', 'Value': 'dana@example.test'}])
        else:
            self.cognito.admin_create_user(UserPoolId=self.pool, Username='dana@example.test', UserAttributes=[
                {'Name': 'email', 'Value': 'dana@example.test'}])
        self.assertEqual(self.user_by_email('dana@example.test')['UserStatus'], status)

    def check_normalised(self, status):
        self.make_user(status)
        with mock.patch.object(self.cognito, 'admin_set_user_password',
                               wraps=self.cognito.admin_set_user_password) as setpw:
            result = self.do_import([row()])[1]['results']
        self.assertEqual(result, [{'index': 0, 'status': 'added'}])
        user = self.user_by_email('dana@example.test')
        self.assertEqual(user['UserStatus'], 'CONFIRMED')
        attrs = {a['Name']: a['Value'] for a in user['UserAttributes']}
        self.assertEqual(attrs['email_verified'], 'true')
        self.assertEqual(setpw.call_count, 1)
        self.assertTrue(setpw.call_args.kwargs['Permanent'])
        self.assertNotEqual(setpw.call_args.kwargs['Password'], 'Chosen-By-Stranger1!')

    def test_existing_force_change_password_user_is_normalised(self):
        self.check_normalised('FORCE_CHANGE_PASSWORD')

    def test_existing_unconfirmed_user_is_confirmed_with_new_password(self):
        self.check_normalised('UNCONFIRMED')

    def test_confirmed_user_is_left_untouched(self):
        self.do_import([row()])
        with mock.patch.object(self.cognito, 'admin_set_user_password') as setpw, \
                mock.patch.object(self.cognito, 'admin_update_user_attributes') as upd, \
                mock.patch.object(self.cognito, 'admin_confirm_sign_up') as conf:
            self.do_import([row()])
        for m in (setpw, upd, conf):
            m.assert_not_called()

    def test_stops_when_time_is_short_and_skips_the_rest(self):
        remaining = iter([20000, 20000, 2000, 2000])
        from server.cloud import importer
        results = importer.import_rows(self.repo, self.cognito, self.pool, self.k,
                                       [row(email=f'p{i}@example.test') for i in range(4)],
                                       remaining_ms=lambda: next(remaining))
        self.assertEqual([r['status'] for r in results], ['created', 'created', 'skipped', 'skipped'])
        self.assertEqual(len(self.cognito_users()), 2)
        # re-sending the skipped rows finishes the job
        again = self.do_import([row(email=f'p{i}@example.test') for i in range(4)])[1]['results']
        self.assertEqual([r['status'] for r in again], ['exists', 'exists', 'created', 'created'])

    def test_handler_passes_lambda_deadline(self):
        class Ctx(Context):
            def get_remaining_time_in_millis(self):
                return 1000
        response = handler_module.handler(event('POST', IMPORT.format(self.k), sub='sub-gab', email='gab@example.test',
                                                body=json.dumps({'rows': [row()]})), Ctx())
        self.assertEqual(json.loads(response['body'])['results'], [{'index': 0, 'status': 'skipped'}])

    def test_try_again_on_transaction_conflict(self):
        from botocore.exceptions import ClientError
        self.do_import([row(role='listener')])
        err = ClientError({'Error': {'Code': 'TransactionCanceledException', 'Message': 'x'},
                           'CancellationReasons': [{'Code': 'TransactionConflict'}, {'Code': 'None'}]},
                          'TransactWriteItems')
        with mock.patch.object(self.repo.table.meta.client, 'transact_write_items', side_effect=err):
            self.assertEqual(self.do_import([row(role='member')]), (409, {'error': 'try_again'}))

    def test_upgrade_race_where_listener_changed_reports_exists(self):
        from botocore.exceptions import ClientError
        self.do_import([row(role='listener')])
        err = ClientError({'Error': {'Code': 'TransactionCanceledException', 'Message': 'x'},
                           'CancellationReasons': [{'Code': 'ConditionalCheckFailed'}, {'Code': 'None'}]},
                          'TransactWriteItems')
        with mock.patch.object(self.repo.table.meta.client, 'transact_write_items', side_effect=err):
            status, body = self.do_import([row(role='member')])
        self.assertEqual(body['results'], [{'index': 0, 'status': 'exists'}])

    def failing(self, name, times=1):
        """Wrap a moto client method so that its first `times` calls raise (no PII in the error)."""
        real = getattr(self.cognito, name)
        state = {'n': 0}

        def wrapper(**kwargs):
            state['n'] += 1
            if state['n'] <= times:
                raise self.cognito.exceptions.InternalErrorException(
                    {'Error': {'Code': 'InternalErrorException', 'Message': 'x'}}, name)
            return real(**kwargs)
        return mock.patch.object(self.cognito, name, side_effect=wrapper)

    def attrs_of(self):
        return {a['Name']: a['Value'] for a in self.user_by_email('dana@example.test')['UserAttributes']}

    def test_normalise_order_password_then_verified_then_confirm(self):
        self.make_user('UNCONFIRMED')
        calls = []
        for name in ('admin_set_user_password', 'admin_update_user_attributes', 'admin_confirm_sign_up'):
            real = getattr(self.cognito, name)
            patcher = mock.patch.object(self.cognito, name, side_effect=(
                lambda n, r: lambda **kw: (calls.append(n), r(**kw))[1])(name, real))
            patcher.start()
            self.addCleanup(patcher.stop)
        self.do_import([row()])
        self.assertEqual(calls[:2], ['admin_set_user_password', 'admin_update_user_attributes'])
        self.assertIn(calls[2:], ([], ['admin_confirm_sign_up']))
        self.assertEqual(self.user_by_email('dana@example.test')['UserStatus'], 'CONFIRMED')

    def test_unconfirmed_set_password_failure_leaves_user_unconfirmed_then_repaired(self):
        self.make_user('UNCONFIRMED')
        with self.failing('admin_set_user_password'), \
                mock.patch.object(self.cognito, 'admin_confirm_sign_up') as confirm:
            self.assertEqual(self.do_import([row()])[0], 500)
        confirm.assert_not_called()  # the stranger's password never became a live login
        self.assertEqual(self.user_by_email('dana@example.test')['UserStatus'], 'UNCONFIRMED')
        with mock.patch.object(self.cognito, 'admin_set_user_password',
                               wraps=self.cognito.admin_set_user_password) as setpw:
            self.assertEqual(self.do_import([row()])[1]['results'][0]['status'], 'added')
        self.assertEqual(setpw.call_count, 1)
        self.assertEqual(self.user_by_email('dana@example.test')['UserStatus'], 'CONFIRMED')
        self.assertEqual(self.attrs_of()['email_verified'], 'true')

    def test_attribute_update_failure_is_repaired_by_next_import(self):
        self.make_user('FORCE_CHANGE_PASSWORD')
        with self.failing('admin_update_user_attributes'):
            self.assertEqual(self.do_import([row()])[0], 500)
        self.assertNotEqual(self.attrs_of().get('email_verified'), 'true')
        with mock.patch.object(self.cognito, 'admin_set_user_password',
                               wraps=self.cognito.admin_set_user_password) as setpw:
            self.assertEqual(self.do_import([row()])[1]['results'][0]['status'], 'added')
        self.assertEqual(setpw.call_count, 1)  # still unverified: rotated again before verifying
        self.assertEqual(self.attrs_of()['email_verified'], 'true')

    def test_confirmed_unverified_user_loses_known_password_and_sessions_before_verify(self):
        """Attacker scenario: a CONFIRMED account whose email was changed to the victim's (unverified)."""
        self.make_user('FORCE_CHANGE_PASSWORD')
        self.cognito.admin_set_user_password(UserPoolId=self.pool, Username='dana@example.test',
                                             Password='Known-To-Attacker1!', Permanent=True)
        self.assertEqual(self.user_by_email('dana@example.test')['UserStatus'], 'CONFIRMED')
        self.assertNotEqual(self.attrs_of().get('email_verified'), 'true')
        client_id = self.cognito.create_user_pool_client(
            UserPoolId=self.pool, ClientName='c2',
            ExplicitAuthFlows=['ADMIN_NO_SRP_AUTH'])['UserPoolClient']['ClientId']

        def login(password):
            return self.cognito.admin_initiate_auth(
                UserPoolId=self.pool, ClientId=client_id, AuthFlow='ADMIN_NO_SRP_AUTH',
                AuthParameters={'USERNAME': 'dana@example.test', 'PASSWORD': password})
        login('Known-To-Attacker1!')  # works before
        calls = []
        for name in ('admin_set_user_password', 'admin_user_global_sign_out', 'admin_update_user_attributes',
                     'admin_confirm_sign_up'):
            real = getattr(self.cognito, name)
            patcher = mock.patch.object(self.cognito, name, side_effect=(
                lambda n, r: lambda **kw: (calls.append(n), r(**kw))[1])(name, real))
            patcher.start()
            self.addCleanup(patcher.stop)
        self.do_import([row()])
        self.assertEqual(calls, ['admin_set_user_password', 'admin_user_global_sign_out',
                                 'admin_update_user_attributes'])
        self.assertEqual(self.attrs_of()['email_verified'], 'true')
        with self.assertRaises(self.cognito.exceptions.NotAuthorizedException):
            login('Known-To-Attacker1!')

    def test_username_exists_but_not_found_retries_create_once_then_try_again(self):
        exists = self.cognito.exceptions.UsernameExistsException(
            {'Error': {'Code': 'UsernameExistsException', 'Message': 'x'}}, 'AdminCreateUser')
        with mock.patch.object(self.cognito, 'admin_create_user', side_effect=exists) as create:
            self.assertEqual(self.do_import([row()]), (409, {'error': 'try_again'}))
        self.assertEqual(create.call_count, 2)
        self.assertEqual(self.cognito_users(), [])

    def test_username_exists_not_found_then_create_succeeds_on_retry(self):
        exists = self.cognito.exceptions.UsernameExistsException(
            {'Error': {'Code': 'UsernameExistsException', 'Message': 'x'}}, 'AdminCreateUser')
        real = self.cognito.admin_create_user
        calls = []

        def once(**kwargs):
            calls.append(1)
            if len(calls) == 1:
                raise exists
            return real(**kwargs)
        with mock.patch.object(self.cognito, 'admin_create_user', side_effect=once):
            sub, created = accounts.ensure_account(self.cognito, self.pool, 'dana@example.test')
        self.assertEqual(created, True)
