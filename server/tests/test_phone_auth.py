import base64
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
import os
import time
import unittest
from unittest.mock import patch
import zipfile

from openpyxl import Workbook

import test_api as helpers
from server.app import make_handler
from server.phone_auth import mobile
from server.member_import import parse_workbook, MAX_BYTES
from server.store import Store, token_hash
from server.validation import APIError
from server import sms


def excel(rows, headers=('שם פרטי', 'שם משפחה', 'פלאפון')):
    book = Workbook()
    book.active.append(headers)
    for row in rows:
        book.active.append(row)
    output = BytesIO()
    book.save(output)
    book.close()
    return dict(name='members.xlsx', base64=base64.b64encode(output.getvalue()).decode())


class PhoneAuthTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        helpers.CommunityTest.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        helpers.CommunityTest.tearDownClass.__func__(cls)

    tearDown = helpers.CommunityTest.tearDown
    http = helpers.CommunityTest.http
    family_profile = helpers.CommunityTest.family_profile
    family_child = staticmethod(helpers.CommunityTest.family_child)

    def setUp(self):
        helpers.CommunityTest.setUp(self)
        self.environment = patch.dict(os.environ, {'SHUL_OTP_SECRET': 'test-secret-never-for-production-12345'})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.sent = []
        self.store.sms_sender = lambda phone, code: self.sent.append((phone, code))

    def sign_in(self, phone='0501234567'):
        status, challenge, _ = self.http('POST', '/api/auth/phone/request', dict(phone=phone))
        self.assertEqual(status, 200, challenge)
        status, result, _ = self.http('POST', '/api/auth/phone/verify', dict(challengeId=challenge['challengeId'], code=self.sent[-1][1]))
        self.assertEqual(status, 200, result)
        return result

    def retry(self):
        with self.store.db() as db:
            db.execute('UPDATE phone_challenges SET requested_at=requested_at-61')

    def test_mobile_formats_share_one_canonical_number(self):
        for number in ['0501234567', '050-1234567', '+972 (50) 1234567', '00972501234567']:
            self.assertEqual(mobile(number), '+972501234567')
        for number in ['', '050', '03-1234567', '+15012345678', '972501234567', '+972+501234567', None, '0501234567abc']:
            with self.assertRaises(APIError): mobile(number)

    def test_listed_phone_receives_membership_only_after_verification(self):
        self.store.import_members(self.gabbai, excel([('שם פרטי', 'שם משפחה', '0501234567')]))
        status, challenge, _ = self.http('POST', '/api/auth/phone/request', dict(phone='0501234567'))
        self.assertEqual(status, 200)
        self.assertEqual(set(challenge), {'challengeId', 'expiresIn', 'retryAfter'})
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 3)
            self.assertNotEqual(db.execute('SELECT digest FROM phone_challenges').fetchone()[0], self.sent[-1][1])
        status, result, _ = self.http('POST', '/api/auth/phone/verify', dict(challengeId=challenge['challengeId'], code=self.sent[-1][1]))
        self.assertEqual(status, 200, result)
        state = self.http('GET', '/api/me', token=result['token'])[1]
        self.assertEqual((state['classification'], state['role'], state['verifiedPhone']), ('א', 'member', '+972501234567'))
        self.assertTrue(state['seating']['eligible'])
        self.assertIsNone(state['seating']['allocatedSeats'])
        self.assertEqual(state['profile']['firstName'], 'שם פרטי')
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT user_id FROM sessions WHERE hash=?', (token_hash(result['token']),)).fetchone()[0], result['user']['id'])

    def test_unlisted_phone_is_regular_and_cannot_forge_membership_or_role(self):
        for path, value in [('/api/auth/phone/request', dict(phone='0501234567', classification='א')),
                            ('/api/auth/phone/verify', dict(challengeId='x', code='123456', role='gabbai'))]:
            self.assertEqual(self.http('POST', path, value)[0], 400)
        account = self.sign_in()
        state = self.http('GET', '/api/me', token=account['token'])[1]
        self.assertEqual((state['classification'], state['role']), ('קבוע', 'member'))
        self.assertFalse(state['seating']['eligible'])
        self.assertEqual(self.http('PUT', '/api/admin/roster/' + account['user']['id'], dict(classification='א'), account['token'])[0], 403)
        self.assertEqual(self.http('GET', '/api/admin/association-members', token=account['token'])[0], 403)
        self.assertEqual(self.http('POST', '/api/admin/association-members/import', excel([('a', 'b', '0501234567')]), account['token'])[0], 403)

    def test_resend_invalidates_previous_code_and_code_is_single_use(self):
        first = self.store.request_phone_code(dict(phone='0501234567'), 'first-ip')
        first_code = self.sent[-1][1]
        self.assertEqual(self.http('POST', '/api/auth/phone/request', dict(phone='+972501234567'))[0], 429)
        self.retry()
        second = self.store.request_phone_code(dict(phone='+972501234567'), 'first-ip')
        self.assertNotEqual(first['challengeId'], second['challengeId'])
        self.assertEqual(self.http('POST', '/api/auth/phone/verify', dict(challengeId=first['challengeId'], code=first_code))[0], 401)
        payload = dict(challengeId=second['challengeId'], code=self.sent[-1][1])
        self.assertEqual(self.http('POST', '/api/auth/phone/verify', payload)[0], 200)
        self.assertEqual(self.http('POST', '/api/auth/phone/verify', payload)[0], 401)

    def test_expired_and_five_failed_attempts_stay_invalid_across_restart(self):
        challenge = self.store.request_phone_code(dict(phone='0501234567'), 'ip')
        code = self.sent[-1][1]
        wrong = '000001' if code != '000001' else '000002'
        payload = dict(challengeId=challenge['challengeId'], code=wrong)
        for _ in range(5): self.assertEqual(self.http('POST', '/api/auth/phone/verify', payload)[0], 401)
        self.store = Store(self.store.path, sms_sender=self.store.sms_sender)
        self.handler = make_handler(self.store)
        payload['code'] = code
        self.assertEqual(self.http('POST', '/api/auth/phone/verify', payload)[0], 401)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT attempts FROM phone_challenges').fetchone()[0], 5)
        self.retry()
        challenge = self.store.request_phone_code(dict(phone='0501234567'), 'ip')
        with self.store.db() as db: db.execute('UPDATE phone_challenges SET expires=0')
        self.assertEqual(self.http('POST', '/api/auth/phone/verify', dict(challengeId=challenge['challengeId'], code=self.sent[-1][1]))[0], 401)

    def test_phone_and_ip_send_limits_persist(self):
        for _ in range(5):
            self.store.request_phone_code(dict(phone='0501234567'), 'ip')
            self.retry()
        self.store = Store(self.store.path, sms_sender=self.store.sms_sender)
        with self.assertRaises(APIError) as error:
            self.store.request_phone_code(dict(phone='0501234567'), 'different-ip')
        self.assertEqual(error.exception.status, 429)
        for index in range(15): self.store.request_phone_code(dict(phone=f'05210000{index:02}'), 'ip')
        with self.assertRaises(APIError) as error:
            self.store.request_phone_code(dict(phone='0539999999'), 'ip')
        self.assertEqual(error.exception.status, 429)

    def test_no_sms_configuration_and_transport_failure_never_issue_a_session(self):
        self.store.sms_sender = None
        with patch.dict(os.environ, {'SHUL_SMS_BACKEND': ''}):
            self.assertEqual(self.http('POST', '/api/auth/phone/request', dict(phone='0501234567'))[0], 503)
        def fail(phone, code): raise RuntimeError('provider-secret-' + code)
        self.store.sms_sender = fail
        status, response, _ = self.http('POST', '/api/auth/phone/request', dict(phone='0501234567'))
        self.assertEqual(status, 503)
        self.assertNotIn('provider-secret', json.dumps(response))
        with self.store.db() as db: self.assertEqual(db.execute('SELECT count(*) FROM phone_challenges').fetchone()[0], 0)
        with patch.dict(os.environ, {'SHUL_OTP_SECRET': ''}):
            self.assertEqual(self.http('POST', '/api/auth/phone/request', dict(phone='0501234567'))[0], 503)

    def test_concurrent_verification_creates_one_account_and_one_session(self):
        challenge = self.store.request_phone_code(dict(phone='0501234567'), 'ip')
        payload = dict(challengeId=challenge['challengeId'], code=self.sent[-1][1])
        def verify(_):
            try: return self.store.verify_phone_code(payload, 'ip')['user']['id']
            except APIError as error: return error.status
        with ThreadPoolExecutor(max_workers=2) as pool: results = list(pool.map(verify, range(2)))
        self.assertEqual(results.count(401), 1)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM verified_phones').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT count(*) FROM users').fetchone()[0], 4)

    def test_relogin_and_import_preserve_gabbai_demotion_and_permanent_family_ids(self):
        entry = excel([('שם', 'משפחה', '0501234567')])
        self.store.import_members(self.gabbai, entry)
        account = self.sign_in()
        user = self.store.authenticate(account['token'])
        profile = self.family_profile([self.family_child('permanent-child', hebrewBirthDate=dict(day=1, month='tishrei', year=5760))])
        profile['phone'] = '+972501234567'
        self.store.save_profile(user, profile)
        self.store.save_roster_person(self.gabbai, dict(classification='קבוע'), user['id'])
        self.store.import_members(self.gabbai, entry)
        again = self.sign_in()
        self.assertEqual(again['user']['id'], user['id'])
        self.assertEqual(self.store.state(user)['classification'], 'קבוע')
        self.assertEqual(self.store.state(user)['profile']['children'][0]['id'], 'permanent-child')
        self.assertFalse(self.store.state(user)['seating']['eligible'])
        self.store.save_roster_person(self.gabbai, dict(classification='א', allocatedSeats=4), user['id'])
        self.assertTrue(self.store.state(user)['seating']['eligible'])

    def test_verified_number_cannot_be_edited_to_claim_a_different_membership(self):
        account = self.sign_in()
        user = self.store.authenticate(account['token'])
        profile = self.family_profile([])
        profile['phone'] = '0509999999'
        self.assertEqual(self.http('PUT', '/api/profile', profile, account['token'])[0], 400)
        profile['phone'] = '0501234567'
        self.assertEqual(self.http('PUT', '/api/profile', profile, account['token'])[0], 200)
        self.assertEqual(self.store.state(user)['profile']['phone'], '+972501234567')
        details = self.store.person_details(self.gabbai, user['id'])
        details['profile']['phone'] = '0509999999'
        self.assertEqual(self.http('PUT', '/api/admin/people/' + user['id'], dict(profile=details['profile'], classification='א', allocatedSeats=None, barMitzvahDate=''), 'gabbai-token')[0], 400)

    def test_trusted_account_link_preserves_gabbai_role_children_history_and_sessions(self):
        profile = self.family_profile([self.family_child('existing-child')])
        self.store.save_profile(self.gabbai, profile)
        self.store.save_roster_person(self.gabbai, dict(allocatedSeats=4), self.gabbai_id)
        history = self.store.save_aliyah_service(self.gabbai, dict(date='2026-10-24', service='shacharit', reading='לך לך',
            calls=[dict(position='ישראל 1', personId=self.gabbai_id)]))
        self.assertEqual(self.store.link_phone('gabbai@example.test', '0501234567'), self.gabbai_id)
        account = self.sign_in()
        self.assertEqual(account['user']['id'], self.gabbai_id)
        state = self.http('GET', '/api/me', token=account['token'])[1]
        self.assertEqual(state['role'], 'gabbai')
        self.assertEqual(state['classification'], 'א')
        self.assertEqual(state['seating']['allocatedSeats'], 4)
        self.assertEqual(state['profile']['children'][0]['id'], 'existing-child')
        self.assertEqual(self.store.aliyah_services(self.gabbai)[0], history)
        self.assertEqual(self.http('GET', '/api/me', token='gabbai-token')[0], 200)
        self.assertEqual(self.http('POST', '/api/login', dict(email='gabbai@example.test', password=helpers.PASSWORD))[0], 401)
        with self.assertRaises(APIError): self.store.link_phone('other@example.test', '0501234567')

    def test_editable_legacy_profile_phone_is_never_implicitly_claimed(self):
        profile = self.family_profile([])
        profile['phone'] = '0501234567'
        self.store.save_profile(self.member, profile)
        account = self.sign_in()
        self.assertNotEqual(account['user']['id'], self.member_id)
        self.assertEqual(self.store.state(self.member)['profile']['phone'], '0501234567')

    def test_excel_is_atomic_additive_and_normalizes_numeric_and_international_phones(self):
        body = excel([('אחד', 'כהן', 501234567), ('שני', 'לוי', '+972521234567')])
        self.assertEqual(self.http('POST', '/api/admin/association-members/import', body, 'gabbai-token')[1], dict(added=2, updated=0, total=2))
        self.assertEqual(self.http('POST', '/api/admin/association-members/import', body, 'gabbai-token')[1], dict(added=0, updated=2, total=2))
        bad = excel([('חדש', 'חדש', '0531234567'), ('שגוי', 'שגוי', 'abc')])
        self.assertEqual(self.http('POST', '/api/admin/association-members/import', bad, 'gabbai-token')[0], 400)
        listing = self.store.association_list(self.gabbai)
        self.assertEqual([r['phone'] for r in listing], ['+972501234567', '+972521234567'])
        self.store.import_members(self.gabbai, excel([('שלישי', 'שלישי', '0531234567')]))
        self.assertEqual(len(self.store.association_list(self.gabbai)), 3)
        self.assertEqual(len(Store(self.store.path).association_list(self.gabbai)), 3)

    def test_excel_bad_files_duplicates_formulas_and_zip_bombs_are_rejected(self):
        cases = [excel([]), excel([('שם', 'משפחה', '0501234567'), ('אחר', 'אחר', '+972501234567')]),
                 excel([('=1+1', 'שם', '0501234567')]), excel([('שם', 'משפחה', '0501234567')], ('x', 'y', 'z')),
                 dict(name='members.xlsx', base64='bad!'), dict(name='members.xls', base64='AAAA')]
        for body in cases:
            self.assertEqual(self.http('POST', '/api/admin/association-members/import', body, 'gabbai-token')[0], 400)
        with self.assertRaises(APIError): parse_workbook(b'x' * (MAX_BYTES + 1))
        output = BytesIO()
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive: archive.writestr('large.xml', b'x' * (21 * 1024 * 1024))
        with self.assertRaises(APIError): parse_workbook(output.getvalue())
        self.assertEqual(self.store.association_list(self.gabbai), [])

    def test_full_names_are_not_split_by_guessing_and_later_import_promotes_automatic_regular(self):
        account = self.sign_in()
        self.store.import_members(self.gabbai, excel([('שם מלא עם רווחים', '0501234567')], ('שם מלא', 'פלאפון')))
        user = self.store.authenticate(account['token'])
        self.assertEqual(self.store.state(user)['classification'], 'א')
        entry = self.store.association_list(self.gabbai)[0]
        self.assertEqual((entry['firstName'], entry['lastName'], entry['name']), ('', '', 'שם מלא עם רווחים'))
        self.assertTrue(entry['registered'])

    def test_twilio_transport_sends_sms_without_exposing_provider_errors(self):
        env = dict(SHUL_SMS_BACKEND='twilio', TWILIO_ACCOUNT_SID='AC' + 'a' * 32, TWILIO_AUTH_TOKEN='credential', TWILIO_FROM_NUMBER='+15005550006')
        with patch.dict(os.environ, env), patch('server.sms.urllib.request.urlopen') as send:
            send.return_value.__enter__.return_value.read.return_value = b'{"sid":"SM123","status":"queued"}'
            sms.send_code('+972501234567', '123456')
            request = send.call_args.args[0]
            self.assertTrue(request.full_url.startswith('https://api.twilio.com/'))
            self.assertIn(b'To=%2B972501234567', request.data)
            self.assertIn(b'123456', request.data)
            send.side_effect = RuntimeError('credential 123456')
            with self.assertRaises(APIError) as error: sms.send_code('+972501234567', '123456')
            self.assertNotIn('credential', str(error.exception))
