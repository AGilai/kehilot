import logging
import unittest

from botocore.exceptions import ClientError

from server.cloud import cognito_triggers

POOL = 'il-central-1_Example'


class _Exceptions:
    class UserNotFoundException(Exception):
        pass

    class UsernameExistsException(Exception):
        pass


class FakeCognito:
    """Records calls. moto may not implement AdminLinkProviderForUser, so linking is verified only here."""
    exceptions = _Exceptions

    def __init__(self, users=None):
        self.users = users or []   # dicts: Username, UserStatus, Attributes {name: value}
        self.calls = []

    def _attrs(self, u):
        return [{'Name': k, 'Value': v} for k, v in u['Attributes'].items()]

    def list_users(self, **kw):
        self.calls.append(('list_users', kw))
        flt = kw['Filter']
        assert flt.startswith('email = "') and flt.endswith('"')
        email = flt[len('email = "'):-1]
        return {'Users': [{'Username': u['Username'], 'UserStatus': u['UserStatus'], 'Attributes': self._attrs(u)}
                          for u in self.users if u['Attributes'].get('email') == email]}

    def admin_get_user(self, UserPoolId, Username):
        self.calls.append(('admin_get_user', {'Username': Username}))
        for u in self.users:
            if u['Username'] == Username or (u['Attributes'].get('email') == Username
                                             and u['UserStatus'] != 'EXTERNAL_PROVIDER'):
                return {'Username': u['Username'], 'UserStatus': u['UserStatus'], 'UserAttributes': self._attrs(u)}
        raise self.exceptions.UserNotFoundException()

    def admin_create_user(self, **kw):
        self.calls.append(('admin_create_user', kw))
        attrs = {a['Name']: a['Value'] for a in kw['UserAttributes']}
        attrs['sub'] = 'sub-new'
        self.users.append({'Username': 'sub-new', 'UserStatus': 'FORCE_CHANGE_PASSWORD', 'Attributes': attrs})
        return {'User': {'Username': 'sub-new', 'Attributes': [{'Name': k, 'Value': v} for k, v in attrs.items()]}}

    def admin_set_user_password(self, **kw):
        self.calls.append(('admin_set_user_password', {k: v for k, v in kw.items() if k != 'Password'}))
        for u in self.users:
            if u['Username'] == 'sub-new' or u['Attributes'].get('email') == kw['Username']:
                u['UserStatus'] = 'CONFIRMED'

    def admin_update_user_attributes(self, **kw):
        self.calls.append(('admin_update_user_attributes', kw))

    def admin_confirm_sign_up(self, **kw):
        self.calls.append(('admin_confirm_sign_up', kw))

    def admin_user_global_sign_out(self, **kw):
        self.calls.append(('admin_user_global_sign_out', kw))

    def admin_link_provider_for_user(self, **kw):
        self.calls.append(('admin_link_provider_for_user', kw))

    def named(self, name):
        return [c[1] for c in self.calls if c[0] == name]


def native(sub='sub-native', email='dana@example.com', status='CONFIRMED', verified='true'):
    return {'Username': sub, 'UserStatus': status,
            'Attributes': {'sub': sub, 'email': email, 'email_verified': verified}}


def external_event(user_name, email='dana@example.com', verified='true'):
    attrs = {}
    if email is not None:
        attrs['email'] = email
    if verified is not None:
        attrs['email_verified'] = verified
    return {'triggerSource': 'PreSignUp_ExternalProvider', 'userName': user_name, 'userPoolId': POOL,
            'request': {'userAttributes': attrs}, 'response': {}}


class PreSignUpTest(unittest.TestCase):
    def test_google_login_links_to_existing_native_user(self):
        fake = FakeCognito([native(), {'Username': 'Google_123', 'UserStatus': 'EXTERNAL_PROVIDER',
                                       'Attributes': {'email': 'dana@example.com'}}])
        event = external_event('Google_123', email='Dana@Example.com')
        self.assertIs(cognito_triggers.handler(event, None, client=fake), event)
        self.assertEqual(fake.named('list_users'), [])
        self.assertEqual(fake.named('admin_get_user')[0]['Username'], 'dana@example.com')  # lowercased
        self.assertEqual(fake.named('admin_create_user'), [])
        self.assertEqual(fake.named('admin_link_provider_for_user'), [{
            'UserPoolId': POOL,
            'DestinationUser': {'ProviderName': 'Cognito', 'ProviderAttributeValue': 'sub-native'},
            'SourceUser': {'ProviderName': 'Google', 'ProviderAttributeName': 'Cognito_Subject',
                           'ProviderAttributeValue': '123'}}])

    def test_google_login_without_native_user_creates_then_links(self):
        fake = FakeCognito()
        cognito_triggers.handler(external_event('Google_9_x'), None, client=fake)
        self.assertEqual(len(fake.named('admin_create_user')), 1)
        link = fake.named('admin_link_provider_for_user')[0]
        self.assertEqual(link['DestinationUser']['ProviderAttributeValue'], 'sub-new')
        self.assertEqual(link['SourceUser']['ProviderAttributeValue'], '9_x')  # split at the first underscore only
        names = [c[0] for c in fake.calls]
        self.assertLess(names.index('admin_create_user'), names.index('admin_link_provider_for_user'))

    def test_unverified_native_user_is_repaired_before_linking(self):
        fake = FakeCognito([native(status='UNCONFIRMED', verified='false')])
        cognito_triggers.handler(external_event('Google_1'), None, client=fake)
        names = [c[0] for c in fake.calls]
        self.assertIn('admin_set_user_password', names)
        self.assertIn('admin_update_user_attributes', names)
        self.assertLess(names.index('admin_user_global_sign_out'), names.index('admin_update_user_attributes'))
        self.assertLess(names.index('admin_set_user_password'), names.index('admin_link_provider_for_user'))

    def test_unverified_google_email_rejected(self):
        for verified in ('false', None):
            fake = FakeCognito([native()])
            with self.assertRaises(Exception) as ctx:
                cognito_triggers.handler(external_event('Google_1', verified=verified), None, client=fake)
            self.assertEqual(str(ctx.exception), 'email_unverified')
            self.assertEqual(fake.calls, [])

    def test_missing_email_rejected(self):
        fake = FakeCognito()
        with self.assertRaises(Exception) as ctx:
            cognito_triggers.handler(external_event('SignInWithApple_1', email=None), None, client=fake)
        self.assertEqual(str(ctx.exception), 'email_required')
        self.assertEqual(fake.calls, [])

    def test_apple_login_links_by_email(self):
        fake = FakeCognito([native()])
        cognito_triggers.handler(external_event('SignInWithApple_000.abc', verified=None), None, client=fake)
        link = fake.named('admin_link_provider_for_user')[0]
        self.assertEqual(link['SourceUser']['ProviderName'], 'SignInWithApple')
        self.assertEqual(link['SourceUser']['ProviderAttributeValue'], '000.abc')
        self.assertEqual(link['DestinationUser']['ProviderAttributeValue'], 'sub-native')

    def test_provider_name_is_case_insensitive_and_unknown_is_rejected(self):
        fake = FakeCognito([native()])
        cognito_triggers.handler(external_event('google_5'), None, client=fake)
        self.assertEqual(fake.named('admin_link_provider_for_user')[0]['SourceUser']['ProviderName'], 'Google')
        with self.assertRaises(Exception) as ctx:
            cognito_triggers.handler(external_event('Facebook_5'), None, client=fake)
        self.assertEqual(str(ctx.exception), 'unsupported_provider')

    def test_apple_explicit_false_is_rejected(self):
        for value in ('false', False):
            with self.assertRaises(Exception) as ctx:
                cognito_triggers.handler(external_event('SignInWithApple_1', verified=value), None,
                                         client=FakeCognito([native()]))
            self.assertEqual(str(ctx.exception), 'email_unverified')

    def test_native_signup_passes_through(self):
        for source in ('PreSignUp_SignUp', 'PreSignUp_AdminCreateUser', 'TokenGeneration_HostedAuth'):
            fake = FakeCognito()
            event = {'triggerSource': source, 'userName': 'x', 'request': {}, 'response': {}}
            self.assertEqual(cognito_triggers.handler(event, None, client=fake),
                             {'triggerSource': source, 'userName': 'x', 'request': {}, 'response': {}})
            self.assertEqual(fake.calls, [])

    def test_unexpected_aws_error_raises_generic_error_and_logs_only_code_and_operation(self):
        class Boom(FakeCognito):
            def admin_link_provider_for_user(self, **kw):
                raise ClientError({'Error': {'Code': 'LimitExceededException',
                                             'Message': 'dana@example.com Google_123'}}, 'AdminLinkProviderForUser')
        with self.assertLogs(cognito_triggers.logger, level=logging.DEBUG) as logs:
            with self.assertRaises(Exception) as ctx:
                cognito_triggers.handler(external_event('Google_123'), None, client=Boom([native()]))
        exc = ctx.exception
        self.assertEqual(str(exc), 'link_failed')
        self.assertIsNone(exc.__cause__)
        self.assertTrue(exc.__suppress_context__)
        text = '\n'.join(logs.output) + repr(exc.args)
        self.assertIn('LimitExceededException', text)
        self.assertIn('AdminLinkProviderForUser', text)
        for secret in ('dana', 'example.com', '123'):
            self.assertNotIn(secret, text)

    def test_confirmed_user_with_unverified_email_is_reset_before_verify(self):
        fake = FakeCognito([native(status='CONFIRMED', verified='false')])
        cognito_triggers.handler(external_event('Google_1'), None, client=fake)
        names = [c[0] for c in fake.calls]
        self.assertLess(names.index('admin_set_user_password'), names.index('admin_user_global_sign_out'))
        self.assertLess(names.index('admin_user_global_sign_out'), names.index('admin_update_user_attributes'))
        self.assertLess(names.index('admin_update_user_attributes'), names.index('admin_link_provider_for_user'))
        self.assertEqual(fake.named('admin_confirm_sign_up'), [])

    def test_unexpected_exception_in_linking_becomes_link_failed_without_pii(self):
        from botocore.exceptions import BotoCoreError, ParamValidationError

        class Weird(FakeCognito):
            def __init__(self, exc, *a):
                super().__init__(*a)
                self.exc = exc

            def admin_link_provider_for_user(self, **kw):
                raise self.exc
        errors = [ParamValidationError(report='bad value dana@example.com'),
                  BotoCoreError(), KeyError('dana@example.com'), RuntimeError('dana@example.com')]
        for error in errors:
            with self.assertLogs(cognito_triggers.logger, level=logging.DEBUG) as logs:
                with self.assertRaises(Exception) as ctx:
                    cognito_triggers.handler(external_event('Google_123'), None, client=Weird(error, [native()]))
            exc = ctx.exception
            self.assertEqual(str(exc), 'link_failed')
            self.assertIsNone(exc.__cause__)
            self.assertTrue(exc.__suppress_context__)
            text = '\n'.join(logs.output) + repr(exc.args)
            self.assertIn(type(error).__name__, text)
            for secret in ('dana', 'example.com'):
                self.assertNotIn(secret, text)

    def test_api_error_from_ensure_account_also_becomes_link_failed(self):
        from server.cloud.errors import ApiError

        class Busy(FakeCognito):
            def admin_create_user(self, **kw):
                raise self.exceptions.UsernameExistsException('dana@example.com')
        with self.assertRaises(Exception) as ctx:
            cognito_triggers.handler(external_event('Google_1'), None, client=Busy())
        self.assertEqual(str(ctx.exception), 'link_failed')

    def test_trigger_logs_no_email(self):
        fake = FakeCognito([native()])
        with self.assertLogs(cognito_triggers.logger, level=logging.DEBUG) as logs:
            cognito_triggers.handler(external_event('Google_123'), None, client=fake)
            cognito_triggers.handler({'triggerSource': 'PreSignUp_SignUp', 'userName': 'u', 'request': {}},
                                     None, client=fake)
        text = '\n'.join(logs.output)
        self.assertIn('PreSignUp_ExternalProvider', text)
        self.assertIn('linked', text)
        self.assertIn('passthrough', text)
        for secret in ('dana', 'example.com', '123', 'sub-native'):
            self.assertNotIn(secret, text)


class CustomMessageTest(unittest.TestCase):
    def message(self, source, metadata):
        request = {'codeParameter': '{####}', 'userAttributes': {'email': 'dana@example.com'}}
        if metadata is not None:
            request['clientMetadata'] = metadata
        return cognito_triggers.handler({'triggerSource': source, 'request': request, 'response': {}}, None)

    def test_custom_message_hebrew_default_and_english(self):
        for source in ('CustomMessage_SignUp', 'CustomMessage_ResendCode'):
            for metadata in (None, {}, {'lang': 'fr'}, {'lang': 'he'}):
                out = self.message(source, metadata)['response']
                self.assertEqual(out['emailMessage'], 'קוד האימות שלך לקהילות: {####}')
                self.assertTrue(out['emailSubject'])
            out = self.message(source, {'lang': 'en'})['response']
            self.assertEqual(out['emailMessage'], 'Your Kehilot verification code: {####}')
        self.assertEqual(self.message('CustomMessage_ForgotPassword', None)['response']['emailMessage'],
                         'קוד לאיפוס הסיסמה בקהילות: {####}')
        self.assertEqual(self.message('CustomMessage_ForgotPassword', {'lang': 'en'})['response']['emailMessage'],
                         'Your Kehilot password reset code: {####}')

    def test_other_custom_message_sources_unchanged(self):
        event = {'triggerSource': 'CustomMessage_AdminCreateUser', 'request': {'codeParameter': '{####}'},
                 'response': {}}
        self.assertEqual(cognito_triggers.handler(event, None)['response'], {})


if __name__ == '__main__':
    unittest.main()
