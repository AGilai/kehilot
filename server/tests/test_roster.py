import copy
from datetime import date
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import test_api as api_helpers
from server.store import Store
from server.validation import APIError
from server.hebrew_calendar import birth_date, bar_mitzvah_date, months_before
from pyluach import dates


class RosterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template_dir = tempfile.TemporaryDirectory()
        cls.template = Path(cls.template_dir.name) / 'template.db'
        store = Store(cls.template)
        cls.member_id = store.create_user('member@example.test', api_helpers.PASSWORD, 'חבר לדוגמה')
        cls.other_id = store.create_user('other@example.test', api_helpers.PASSWORD, 'חבר נוסף')
        cls.gabbai_id = store.create_user('gabbai@example.test', api_helpers.PASSWORD, 'גבאי לדוגמה', 'gabbai')
        # The fixture names are explicit; production never splits a full name.
        with store.db() as db:
            for identifier, first, last in [(cls.member_id, 'חבר', 'לדוגמה'), (cls.other_id, 'חבר', 'נוסף'), (cls.gabbai_id, 'גבאי', 'לדוגמה')]:
                saved = json.loads(db.execute('SELECT profile FROM users WHERE id=?', (identifier,)).fetchone()[0])
                saved.update(firstName=first, lastName=last)
                db.execute('UPDATE users SET profile=? WHERE id=?', (json.dumps(saved), identifier))


    @classmethod
    def tearDownClass(cls):
        cls.template_dir.cleanup()

    def setUp(self):
        for module in ['server.roster', 'server.store', 'server.validation']:
            clock = patch(module + '.israel_today', return_value=date(2026, 10, 25))
            clock.start()
            self.addCleanup(clock.stop)
        api_helpers.CommunityTest.setUp(self)
    tearDown = api_helpers.CommunityTest.tearDown
    http = api_helpers.CommunityTest.http
    family_child = staticmethod(api_helpers.CommunityTest.family_child)
    family_profile = api_helpers.CommunityTest.family_profile

    def person(self, status='yisrael', **changes):
        body = dict(firstName='שם', lastName='משפחה', tribe=status, classification='קבוע')
        body.update(changes)
        return self.store.save_roster_person(self.gabbai, body)

    def record(self, day, people, service='shacharit', **changes):
        body = dict(date=day, service=service, reading='קריאת בדיקה',
                    calls=[dict(position=str(index + 1), personId=person['id']) for index, person in enumerate(people)])
        body.update(changes)
        return self.store.save_aliyah_service(self.gabbai, body)

    def indexed(self, today=None):
        return {person['id']: person for person in self.store.roster(self.gabbai, today)}

    def test_six_and_twelve_month_windows_and_latest_aliyah_are_independent(self):
        kohen, levi, yisrael = [self.person(status) for status in ['kohen', 'levi', 'yisrael']]
        empty = self.person()
        old_only = self.person()
        for day in ['2025-10-18', '2025-10-25', '2026-04-18', '2026-04-25', '2026-10-24']:
            self.record(day, [kohen, levi, yisrael] + ([old_only] if day == '2025-10-18' else []))
        roster = self.indexed(date(2026, 10, 25))
        for person, expected, window in [(kohen, 2, 6), (levi, 2, 6), (yisrael, 4, 12)]:
            row = roster[person['id']]
            self.assertEqual((row['aliyahCount'], row['windowMonths']), (expected, window))
            self.assertEqual(row['lastAliyahDate'], '2026-10-24')
            self.assertIn('קריאת בדיקה', row['lastAliyah'])
            self.assertIn(dates.HebrewDate.from_pydate(date(2026, 10, 24)).hebrew_date_string(), row['lastAliyah'])
        self.assertEqual(roster[empty['id']]['aliyahCount'], 0)
        self.assertEqual(roster[empty['id']]['lastAliyah'], 'לא נמצא')
        self.assertIsNone(roster[empty['id']]['lastAliyahDate'])
        self.assertEqual(roster[old_only['id']]['aliyahCount'], 0)
        self.assertEqual(roster[old_only['id']]['lastAliyahDate'], '2025-10-18')
        self.assertEqual(self.indexed(date(2027, 10, 25))[yisrael['id']]['aliyahCount'], 0)

    def test_gregorian_month_end_and_no_new_year_reset(self):
        self.assertEqual(months_before(date(2026, 8, 31), 6), date(2026, 2, 28))
        self.assertEqual(months_before(date(2024, 2, 29), 12), date(2023, 2, 28))
        person = self.person('kohen')
        self.record('2025-12-27', [person])
        self.assertEqual(self.indexed(date(2026, 1, 1))[person['id']]['aliyahCount'], 1)

    def test_son_enters_roster_on_thirteenth_hebrew_birthday_with_same_id(self):
        son = self.family_child('permanent-son', birthDate='', hebrewBirthDate=dict(year=5774, month='cheshvan', day=14))
        profile = self.family_profile([son])
        profile['tribe'] = 'levi'
        with patch('server.store.israel_today', return_value=date(2026, 10, 24)):
            self.store.save_profile(self.member, profile)
        with self.store.db() as db:
            self.assertIsNone(db.execute('SELECT id FROM roster_people WHERE id=?', (son['id'],)).fetchone())
            created = db.execute('SELECT created_at FROM community_people WHERE id=?', (son['id'],)).fetchone()[0]
        self.store.refresh_roster(date(2026, 10, 25))
        roster = self.indexed(date(2026, 10, 25))
        self.assertEqual(roster[son['id']]['sourcePersonId'], son['id'])
        self.assertEqual(roster[son['id']]['eligibleFrom'], '2026-10-25')
        self.assertEqual(roster[son['id']]['tribe'], 'levi')
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT created_at FROM community_people WHERE id=?', (son['id'],)).fetchone()[0], created)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM roster_people WHERE id=?', (son['id'],)).fetchone()[0], 1)
        self.store.refresh_roster(date(2026, 10, 25))
        self.assertNotIn(son['id'], self.indexed(date(2026, 10, 24)))
        self.assertIn(son['id'], self.indexed(date(2026, 10, 25)))
        with self.assertRaises(APIError):
            self.record('2026-10-24', [roster[son['id']]])

    def test_son_classification_tracks_membership_and_marriage(self):
        son = self.family_child('adult-son', hebrewBirthDate=dict(year=5765, month='tishrei', day=1))
        self.store.save_profile(self.member, self.family_profile([son]))
        self.store.save_roster_person(self.gabbai, dict(classification='א'), self.member_id)
        self.assertEqual(self.indexed()[son['id']]['classification'], 'דור ב')
        self.store.save_roster_person(self.gabbai, dict(firstName='שם הבן'), son['id'])
        son.update(married=True, spouseName='אישה', spousePrayerName='שם האישה לתפילה')
        self.store.save_profile(self.member, self.family_profile([son]))
        row = self.indexed()[son['id']]
        self.assertEqual(row['classification'], 'דור ב-נשוי')
        self.assertEqual(row['wifePrayerName'], 'שם האישה לתפילה')
        self.store.save_roster_person(self.gabbai, dict(classification='קבוע'), self.member_id)
        self.assertEqual(self.indexed()[son['id']]['classification'], 'קבוע')

    def test_missing_birth_year_never_promotes_a_son(self):
        son = self.family_child('unknown-age')
        self.store.save_profile(self.member, self.family_profile([son]))
        with self.store.db() as db:
            db.execute('UPDATE community_people SET hebrew_birth_date=? WHERE id=?', (json.dumps(dict(day=1, month='tishrei')), son['id']))
        self.store.refresh_roster(date(2026, 10, 25))
        self.assertNotIn(son['id'], self.indexed())
        self.assertIsNone(bar_mitzvah_date(dict(day=1, month='tishrei'), date(2026, 10, 25)))

    def test_known_underage_independent_person_waits_for_hebrew_birthday(self):
        person = self.person(hebrewBirthDate=dict(year=5780, month='tishrei', day=1))
        self.assertNotIn(person['id'], self.indexed(date(2026, 10, 25)))
        with self.assertRaises(APIError):
            self.record('2026-10-24', [person])
        eligible = date.fromisoformat(person['eligibleFrom'])
        self.assertIn(person['id'], self.indexed(eligible))

    def test_standalone_son_in_law_has_person_identity_without_an_account(self):
        daughter = self.family_child('daughter', 'daughter', married=True, spouseTribe='kohen', spouseName='חתן')
        self.store.save_profile(self.member, self.family_profile([daughter]))
        person = self.person('kohen', familyChildId=daughter['id'], classification='חתן',
                             firstName='חתן', lastName='שם נפרד', hebrewBirthDate=dict(year=5750, month='tishrei', day=1))
        self.assertEqual(person['familyChildId'], daughter['id'])
        self.assertEqual(person['lastName'], 'שם נפרד')
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0], 3)
        with self.assertRaises(APIError) as error:
            self.person('kohen', familyChildId=daughter['id'])
        self.assertEqual(error.exception.status, 409)
        self.record('2026-10-24', [person])
        restarted = Store(self.store.path)
        row = {p['id']: p for p in restarted.roster(self.gabbai)}[person['id']]
        self.assertEqual(row['classification'], 'חתן')
        self.assertEqual(row['aliyahCount'], 1)

    def test_service_replacement_cancellation_and_duplicate_protection(self):
        one, two = self.person(), self.person()
        service = self.record('2026-10-24', [one])
        with self.assertRaises(APIError) as error:
            self.record('2026-10-24', [one])
        self.assertEqual(error.exception.status, 409)
        body = dict(date='2026-10-24', service='shacharit', reading='קריאה מעודכנת', calls=[dict(position='ראשון', personId=two['id'])])
        for _ in range(2):
            self.store.save_aliyah_service(self.gabbai, body, service['id'])
        roster = self.indexed()
        self.assertEqual(roster[one['id']]['aliyahCount'], 0)
        self.assertEqual(roster[two['id']]['aliyahCount'], 1)
        self.assertEqual(roster[one['id']]['lastAliyah'], 'לא נמצא')
        body['cancelled'] = True
        self.store.save_aliyah_service(self.gabbai, body, service['id'])
        self.assertEqual(self.indexed()[two['id']]['lastAliyah'], 'לא נמצא')
        self.assertTrue(self.store.aliyah_services(self.gabbai)[0]['cancelled'])
        body['cancelled'] = False
        self.store.save_aliyah_service(self.gabbai, body, service['id'])
        self.assertEqual(self.indexed()[two['id']]['aliyahCount'], 1)
        self.record('2026-10-24', [one], service='mincha')
        self.assertEqual(len(self.store.aliyah_services(self.gabbai)), 2)

    def test_bad_service_replacement_is_atomic(self):
        person = self.person()
        event = self.record('2026-10-24', [person])
        for calls in [[dict(position='ראשון', personId='missing')],
                      [dict(position='ראשון', personId=person['id'])] * 2]:
            with self.assertRaises(APIError):
                self.store.save_aliyah_service(self.gabbai, dict(date=event['date'], service='shacharit', reading='bad', calls=calls), event['id'])
        self.assertEqual(self.store.aliyah_services(self.gabbai)[0], event)
        self.assertEqual(self.indexed()[person['id']]['aliyahCount'], 1)

    def test_shabbat_and_weekday_festival_are_accepted_ordinary_weekdays_rejected(self):
        person = self.person()
        self.record('2026-09-13', [person], reading='ראש השנה')
        self.record('2026-10-01', [person], reading='חול המועד סוכות')
        with self.assertRaises(APIError):
            self.record('2026-01-19', [person])
        with self.assertRaises(APIError):
            self.record('2100-01-02', [person])

    def test_roster_permissions_and_http_routes(self):
        self.assertEqual(self.http('GET', '/api/admin/roster', token='member-token')[0], 403)
        self.assertEqual(self.http('GET', '/api/admin/aliyah-services', token='member-token')[0], 403)
        body = dict(firstName='שם', lastName='משפחה', tribe='yisrael', classification='קבוע')
        self.assertEqual(self.http('POST', '/api/admin/roster', body, 'member-token')[0], 403)
        status, person, _ = self.http('POST', '/api/admin/roster', body, 'gabbai-token')
        self.assertEqual(status, 201)
        self.assertEqual(self.http('PUT', '/api/admin/roster/' + person['id'], dict(firstName='חדש'), 'gabbai-token')[0], 200)
        event = dict(date='2026-10-24', service='shacharit', reading='קריאת בדיקה', calls=[dict(position='ראשון', personId=person['id'])])
        self.assertEqual(self.http('POST', '/api/admin/aliyah-services', event, 'member-token')[0], 403)
        status, recorded, _ = self.http('POST', '/api/admin/aliyah-services', event, 'gabbai-token')
        self.assertEqual(status, 201)
        self.assertEqual(self.http('PUT', '/api/admin/aliyah-services/' + recorded['id'], event, 'gabbai-token')[0], 200)
        self.assertEqual(len(self.http('GET', '/api/admin/aliyah-services', token='gabbai-token')[1]), 1)
        self.assertEqual(self.http('GET', '/api/admin/roster', token='gabbai-token')[0], 200)

    def test_archive_and_restart_preserve_roster_and_aliyah_foreign_keys(self):
        son = self.family_child('adult-son', hebrewBirthDate=dict(year=5765, month='tishrei', day=1))
        self.store.save_profile(self.member, self.family_profile([son]))
        event = self.record('2026-10-24', [self.indexed()[son['id']]])
        self.store.save_profile(self.member, self.family_profile([]))
        self.assertNotIn(son['id'], self.indexed())
        restarted = Store(self.store.path)
        self.assertEqual(restarted.aliyah_services(self.gabbai)[0], event)
        self.store.save_profile(self.member, self.family_profile([son]))
        self.assertEqual(self.indexed()[son['id']]['aliyahCount'], 1)
        with self.store.db() as db:
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_server_calendar_validation_and_bar_mitzvah_edge_cases(self):
        today = date(2026, 10, 25)
        for birthday in [dict(day=30, month='cheshvan', year=5784), dict(day=30, month='kislev', year=5784),
                         dict(day=1, month='adar', year=5784), dict(day=1, month='adar_i', year=5783),
                         dict(day=1, month='adar_ii', year=5783), dict(day=1, month='tishrei', year=5699),
                         dict(day=15, month='cheshvan', year=5787), dict(day=True, month='nisan', year=5783)]:
            with self.assertRaises(ValueError, msg=str(birthday)):
                birth_date(birthday, today)
        for birthday in [dict(day=30, month='cheshvan', year=5783), dict(day=30, month='kislev', year=5783)]:
            self.assertIsNotNone(birth_date(birthday, today))
        # A common-year Adar birth reaches 13 in Adar II of a leap year.
        result = bar_mitzvah_date(dict(year=5777, month='adar', day=10), today)
        self.assertEqual(dates.HebrewDate.from_pydate(result), dates.HebrewDate(5790, 13, 10))
        result = bar_mitzvah_date(dict(year=5776, month='adar_i', day=30), today)
        self.assertEqual(dates.HebrewDate.from_pydate(result), dates.HebrewDate(5789, 1, 1))

    def test_old_clients_cannot_erase_a_known_birth_year(self):
        birthday = dict(year=5774, month='cheshvan', day=14)
        son = self.family_child('adult-son', hebrewBirthDate=birthday)
        body = self.family_profile([son])
        body['hebrewBirthDate'] = dict(year=5750, month='tishrei', day=1)
        self.store.save_profile(self.member, body)
        del body['hebrewBirthDate']['year']
        del body['children'][0]['hebrewBirthDate']['year']
        status, saved, _ = self.http('PUT', '/api/profile', body, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual(saved['hebrewBirthDate']['year'], 5750)
        self.assertEqual(saved['children'][0]['hebrewBirthDate']['year'], 5774)
        body['hebrewBirthDate'] = dict(day=True, month='tishrei')
        self.assertEqual(self.http('PUT', '/api/profile', body, 'member-token')[0], 400)


    def test_separate_member_names_sync_to_roster_and_preserve_history_and_ids(self):
        original = self.indexed()[self.member_id]
        event = self.record('2026-10-24', [original])
        child = self.family_child('permanent-child')
        body = self.family_profile([child])
        body.update(firstName='  משה דוד  ', lastName='  בן עמי  ', name='סדר ישן')
        status, saved, _ = self.http('PUT', '/api/profile', body, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual((saved['firstName'], saved['lastName'], saved['name']), ('משה דוד', 'בן עמי', 'משה דוד בן עמי'))
        restarted = Store(self.store.path)
        self.assertEqual(restarted.state(self.member)['profile'], saved)
        row = self.indexed()[self.member_id]
        self.assertEqual((row['firstName'], row['lastName'], row['name']), ('משה דוד', 'בן עמי', 'משה דוד בן עמי'))
        self.assertEqual(row['id'], self.member_id)
        self.assertEqual(saved['children'][0]['id'], 'permanent-child')
        self.assertEqual(self.store.aliyah_services(self.gabbai)[0], event)
        legacy = copy.deepcopy(saved)
        del legacy['firstName']
        del legacy['lastName']
        legacy.update(name='בן עמי משה דוד', phone='050-7654321')
        status, updated, _ = self.http('PUT', '/api/profile', legacy, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual(updated['name'], 'משה דוד בן עמי')
        self.assertEqual(updated['phone'], '050-7654321')

    def test_legacy_names_are_not_split_and_gabbai_edits_update_the_same_profile(self):
        with self.store.db() as db:
            value = json.loads(db.execute('SELECT profile FROM users WHERE id=?', (self.member_id,)).fetchone()[0])
            value.pop('firstName')
            value.pop('lastName')
            value['name'] = 'בן עמי משה דוד'
            db.execute('UPDATE users SET profile=? WHERE id=?', (json.dumps(value), self.member_id))
            db.execute("UPDATE roster_people SET first_name='',last_name='' WHERE id=?", (self.member_id,))
        restarted = Store(self.store.path)
        legacy = restarted.state(self.member)['profile']
        self.assertEqual((legacy['firstName'], legacy['lastName'], legacy['name']), ('', '', 'בן עמי משה דוד'))
        self.store.save_roster_person(self.gabbai, dict(firstName='משה דוד', lastName='בן עמי'), self.member_id)
        self.store.refresh_roster()
        saved = self.store.state(self.member)['profile']
        self.assertEqual((saved['firstName'], saved['lastName'], saved['name']), ('משה דוד', 'בן עמי', 'משה דוד בן עמי'))
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT name FROM community_people WHERE id=?', (self.member_id,)).fetchone()[0], saved['name'])
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_partial_empty_and_malformed_name_parts_are_rejected(self):
        original = self.family_profile([])
        for fields in [dict(firstName=''), dict(lastName=' '), dict(firstName=None), dict(lastName=[]),
                       dict(firstName='א' * 100, lastName='ב' * 100)]:
            body = {**original, **fields}
            self.assertEqual(self.http('PUT', '/api/profile', body, 'member-token')[0], 400)
        for missing in ['firstName', 'lastName']:
            body = dict(original)
            del body[missing]
            self.assertEqual(self.http('PUT', '/api/profile', body, 'member-token')[0], 400)
        self.assertEqual(self.store.state(self.member)['profile']['name'], original['name'])


if __name__ == '__main__':
    unittest.main()
