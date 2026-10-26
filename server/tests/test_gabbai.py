import base64
import copy
import json
import unittest
from datetime import date
from types import SimpleNamespace

import test_api as helpers
from server.gabbai import aliyah_template
from server.store import Store
from server.validation import APIError
from pyluach import dates


class GabbaiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        helpers.CommunityTest.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        helpers.CommunityTest.tearDownClass.__func__(cls)

    setUp = helpers.CommunityTest.setUp
    tearDown = helpers.CommunityTest.tearDown
    http = helpers.CommunityTest.http
    family_profile = helpers.CommunityTest.family_profile
    family_child = staticmethod(helpers.CommunityTest.family_child)

    def update(self, details, **changes):
        value = dict(profile=copy.deepcopy(details['profile']), classification=details['person']['classification'] or 'קבוע',
                     allocatedSeats=details['person']['allocatedSeats'], barMitzvahDate=details['person']['barMitzvahDate'])
        value.update(changes)
        return value

    def test_gabbai_has_member_seating_and_ordinary_users_cannot_access_admin_tools(self):
        state = self.store.state(self.gabbai)
        self.assertEqual(state['classification'], 'א')
        self.assertTrue(state['seating']['eligible'])
        self.assertIsNone(state['seating']['allocatedSeats'])
        for path in ['/api/admin/people/' + self.member_id, '/api/admin/aliyah-template?date=2026-10-24']:
            self.assertEqual(self.http('GET', path, token='member-token')[0], 403)
            self.assertEqual(self.http('GET', path)[0], 401)
        self.assertEqual(self.http('PUT', '/api/admin/people/' + self.member_id, {}, 'member-token')[0], 403)
        self.assertEqual(self.http('POST', '/api/admin/aliyah-records', {}, 'member-token')[0], 403)
        self.assertEqual(self.http('POST', '/api/admin/weekly-documents', {}, 'member-token')[0], 403)

    def test_gabbai_edits_full_head_profile_and_data_survives_member_refresh_and_restart(self):
        details = self.store.person_details(self.gabbai, self.member_id)
        payload = self.update(details, classification='א', allocatedSeats=5)
        payload['profile'].update(firstName='שם פרטי', lastName='שם משפחה', tribe='levi', phone='0501234567', wifePhone='0507654321',
                                  torahName='שם לתורה', wifePrayerName='שרה בת אברהם', hebrewBirthDate=dict(day=1, month='tishrei', year=5750))
        status, saved, _ = self.http('PUT', '/api/admin/people/' + self.member_id, payload, 'gabbai-token')
        self.assertEqual(status, 200, saved)
        state = Store(self.store.path).state(self.member)
        self.assertEqual(state['profile']['firstName'], 'שם פרטי')
        self.assertEqual(state['profile']['wifePhone'], '0507654321')
        self.assertEqual(state['seating']['allocatedSeats'], 5)
        self.assertEqual(state['classification'], 'א')
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT id FROM community_people WHERE owner_user_id=? AND relationship=\'self\'', (self.member_id,)).fetchone()[0], self.member_id)

    def test_gabbai_son_marriage_classification_and_personal_edits_keep_identity_and_inheritance(self):
        son = self.family_child('permanent-son', hebrewBirthDate=dict(day=1, month='tishrei', year=5760))
        family = self.family_profile([son])
        self.store.save_profile(self.member, family)
        self.store.save_roster_person(self.gabbai, dict(classification='א'), self.member_id)
        details = self.store.person_details(self.gabbai, son['id'])
        payload = self.update(details, classification='דור ב-נשוי')
        payload['profile'].update(firstName='בן', lastName='משפחה', wifePrayerName='שרה בת אברהם')
        status, saved, _ = self.http('PUT', '/api/admin/people/' + son['id'], payload, 'gabbai-token')
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['person']['classification'], 'דור ב-נשוי')
        self.assertEqual(saved['person']['id'], son['id'])
        account = self.store.state(self.member)['profile']
        self.assertTrue(account['children'][0]['married'])
        self.assertEqual(account['children'][0]['name'], 'בן משפחה')
        self.assertEqual(account['children'][0]['spousePrayerName'], 'שרה בת אברהם')
        self.store.save_profile(self.member, account)
        self.assertEqual(Store(self.store.path).person_details(self.gabbai, son['id'])['person']['classification'], 'דור ב-נשוי')
        invalid = copy.deepcopy(payload)
        invalid['profile']['tribe'] = 'kohen'
        self.assertEqual(self.http('PUT', '/api/admin/people/' + son['id'], invalid, 'gabbai-token')[0], 400)
        self.assertEqual(self.store.person_details(self.gabbai, son['id'])['profile']['tribe'], 'yisrael')

    def test_gabbai_son_in_law_edit_updates_daughter_and_preserves_husband_identity(self):
        child = self.family_child('daughter', 'daughter', married=True, spouseName='חתן', spouseTribe='levi')
        self.store.save_profile(self.member, self.family_profile([child]))
        self.store.save_roster_person(self.gabbai, dict(classification='א'), self.member_id)
        husband = next(row for row in self.store.roster(self.gabbai) if row['familyChildId'] == child['id'])
        details = self.store.person_details(self.gabbai, husband['id'])
        payload = self.update(details)
        payload['profile'].update(firstName='חתן', lastName='חדש', tribe='kohen', torahName='חתן בן אברהם')
        self.assertEqual(self.http('PUT', '/api/admin/people/' + husband['id'], payload, 'gabbai-token')[0], 200)
        family = self.store.state(self.member)['profile']
        self.assertEqual(family['children'][0]['spouseName'], 'חתן חדש')
        self.assertEqual(family['children'][0]['spouseTribe'], 'kohen')
        self.store.save_profile(self.member, family)
        self.assertEqual(self.store.person_details(self.gabbai, husband['id'])['person']['name'], 'חתן חדש')
        young = self.update(self.store.person_details(self.gabbai, husband['id']))
        young['profile']['hebrewBirthDate'] = dict(day=1, month='tishrei', year=5780)
        self.store.save_person_details(self.gabbai, husband['id'], young)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT active FROM roster_people WHERE id=?', (husband['id'],)).fetchone()[0], 0)

    def test_invalid_admin_edit_is_atomic_and_cannot_grant_role(self):
        details = self.store.person_details(self.gabbai, self.member_id)
        payload = self.update(details)
        payload['profile'].update(phone='0501234567', role='gabbai')
        self.assertEqual(self.http('PUT', '/api/admin/people/' + self.member_id, payload, 'gabbai-token')[0], 400)
        payload['profile'].pop('role')
        payload['profile']['tribe'] = 'yisrael'
        payload['classification'] = 'סיווג שלא נרשם'
        self.assertEqual(self.http('PUT', '/api/admin/people/' + self.member_id, payload, 'gabbai-token')[0], 400)
        self.assertEqual(self.store.state(self.member)['profile']['phone'], '')
        payload = self.update(details, classification='א', allocatedSeats=True)
        self.assertEqual(self.http('PUT', '/api/admin/people/' + self.member_id, payload, 'gabbai-token')[0], 400)

    def calls(self, day):
        return [dict(position=slot['position'], guest=True) for slot in aliyah_template(day)['slots']]

    def test_calendar_controls_minimum_aliyot_and_festival_extras(self):
        cases = [(date(2026, 10, 24), 7, True), (dates.HebrewDate(5786, 1, 15).to_pydate(), 5, False),
                 (dates.HebrewDate(5786, 7, 10).to_pydate(), 6, False), (dates.HebrewDate(5785, 7, 10).to_pydate(), 7, False),
                 (dates.HebrewDate(5787, 7, 1).to_pydate(), 7, False)]
        for day, regular, extra in cases:
            with self.subTest(day=day):
                template = aliyah_template(day)
                self.assertEqual((len(template['slots']), template['allowExtra']), (regular + 1, extra))
                self.assertEqual(template['slots'][-1]['position'], 'מפטיר')
        self.assertEqual(self.http('GET', '/api/admin/aliyah-template?date=2026-10-26', token='gabbai-token')[0], 400)

    def test_complete_aliyot_minimum_status_guests_and_replacement_statistics(self):
        day = date(2026, 10, 24)
        self.store.save_profile(self.member, self.family_profile([]))
        calls = self.calls(day)
        calls[2] = dict(position='ישראל 1', personId=self.member_id)
        body = dict(date=day.isoformat(), reading='לך לך', calls=calls)
        path = '/api/admin/aliyah-records'
        status, saved, _ = self.http('POST', path, body, 'gabbai-token')
        self.assertEqual(status, 201, saved)
        self.assertTrue(saved['calls'][0]['guest'])
        self.assertIsNone(saved['calls'][0]['personId'])
        person = next(row for row in self.store.roster(self.gabbai) if row['id'] == self.member_id)
        self.assertEqual(person['aliyahCount'], 1)
        self.assertEqual(self.http('POST', path, body, 'gabbai-token')[0], 409)
        self.assertEqual(self.http('PUT', path + '/' + saved['id'], {**body, 'calls': calls[:-1]}, 'gabbai-token')[0], 400)
        bad = copy.deepcopy(calls)
        bad[0] = dict(position='כהן', personId=self.member_id)
        self.assertEqual(self.http('PUT', path + '/' + saved['id'], {**body, 'calls': bad}, 'gabbai-token')[0], 400)
        self.assertEqual(self.http('PUT', path + '/' + saved['id'], {**body, 'calls': self.calls(day)}, 'gabbai-token')[0], 200)
        person = next(row for row in self.store.roster(self.gabbai) if row['id'] == self.member_id)
        self.assertEqual((person['aliyahCount'], person['lastAliyah']), (0, 'לא נמצא'))
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM aliyah_services').fetchone()[0], 1)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_extra_aliyot_only_on_ordinary_shabbat(self):
        for day in (date(2026, 10, 24), dates.HebrewDate(5786, 1, 15).to_pydate()):
            calls = self.calls(day)
            calls.insert(-1, dict(position=f"ישראל {aliyah_template(day)['regularCount'] - 1}", guest=True))
            status, value, _ = self.http('POST', '/api/admin/aliyah-records', dict(date=day.isoformat(), reading='קריאה', calls=calls), 'gabbai-token')
            self.assertEqual(status, 201 if day.weekday() == 5 else 400, value)

    def test_guest_schema_upgrade_keeps_existing_aliyah_history_and_person_ids(self):
        original = self.store.save_aliyah_service(self.gabbai, dict(date='2026-10-24', service='shacharit', reading='לך לך', calls=[dict(position='ראשון', personId=self.member_id)]))
        with self.store.db() as db:
            rows = [tuple(row) for row in db.execute('SELECT * FROM aliyah_calls')]
            people = [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')]
            db.execute('DROP TABLE aliyah_calls')
            db.execute('CREATE TABLE aliyah_calls (service_id TEXT NOT NULL REFERENCES aliyah_services(id),position TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES roster_people(id),person_name TEXT NOT NULL,PRIMARY KEY(service_id,position))')
            db.executemany('INSERT INTO aliyah_calls VALUES (?,?,?,?)', rows)
        restarted = Store(self.store.path)
        restored = next(row for row in restarted.aliyah_services(self.gabbai) if row['id'] == original['id'])
        self.assertEqual(restored, original)
        with restarted.db() as db:
            self.assertEqual(people, [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')])
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def pdf_payload(self):
        return dict(name='weekly.pdf', title='לו״ז לשבת', body='', base64=base64.b64encode(b'%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n').decode())

    def test_pdf_is_published_with_message_and_private_download_and_notification_queue(self):
        payload = self.pdf_payload()
        status, message, _ = self.http('POST', '/api/admin/weekly-documents', payload, 'gabbai-token')
        self.assertEqual(status, 201, message)
        attachment = message['attachment']
        self.assertEqual(attachment['mimeType'], 'application/pdf')
        self.assertEqual(self.store.document(self.member, attachment['id']), base64.b64decode(payload['base64']))
        state = Store(self.store.path).state(self.member)
        self.assertEqual(state['messages'][0]['attachment']['id'], attachment['id'])
        self.assertEqual(self.http('GET', '/api/documents/' + attachment['id'])[0], 401)
        request = f"GET /api/documents/{attachment['id']} HTTP/1.0\r\nHost: localhost\r\nAuthorization: Bearer member-token\r\n\r\n"
        socket = helpers.FakeSocket(request.encode())
        self.handler(socket, ('127.0.0.1', 1234), SimpleNamespace())
        headers, content = bytes(socket.output).split(b'\r\n\r\n', 1)
        self.assertIn(b'Content-Type: application/pdf', headers)
        self.assertIn(b'Cache-Control: no-store', headers)
        self.assertEqual(content, base64.b64decode(payload['base64']))
        with self.store.db() as db:
            self.assertEqual({r['user_id'] for r in db.execute('SELECT user_id FROM outbox WHERE message_id=?', (message['id'],))}, {self.member_id, self.other_id})

    def test_pdf_rejects_invalid_data_and_does_not_publish_partial_message(self):
        for change in [dict(name='../file.pdf'), dict(base64='bad'), dict(base64=base64.b64encode(b'not a pdf').decode()), dict(name='file.exe'), dict(memberId=self.member_id)]:
            status, value, _ = self.http('POST', '/api/admin/weekly-documents', {**self.pdf_payload(), **change}, 'gabbai-token')
            self.assertEqual(status, 400, value)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM weekly_documents').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 0)

    def test_pdf_route_accepts_realistic_payload_sizes_and_rejects_oversized_uploads(self):
        payload = self.pdf_payload()
        payload['base64'] = base64.b64encode(b'%PDF-1.4\n%' + b'x' * 100000 + b'\n%%EOF\n').decode()
        status, saved, _ = self.http('POST', '/api/admin/weekly-documents', payload, 'gabbai-token')
        self.assertEqual(status, 201, saved)
        self.assertGreater(saved['attachment']['size'], 65536)
        payload['base64'] = 'A' * (14 * 1024 * 1024)
        self.assertEqual(self.http('POST', '/api/admin/weekly-documents', payload, 'gabbai-token')[0], 413)
        self.assertEqual(len(self.store.list_messages()), 1)
