import copy
import unittest
from datetime import date

import test_api as helpers
from server.store import Store
from server.classifications import BUILTINS
from server.gabbai import aliyah_template
from pyluach import dates


class ClassificationTest(unittest.TestCase):
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

    def test_registry_is_private_and_only_gabbai_can_create_classifications(self):
        path = '/api/admin/classifications'
        for method, body in [('GET', None), ('POST', dict(name='ותיק'))]:
            self.assertEqual(self.http(method, path, body)[0], 401)
            self.assertEqual(self.http(method, path, body, 'member-token')[0], 403)
        status, options, _ = self.http('GET', path, token='gabbai-token')
        self.assertEqual(status, 200)
        self.assertEqual([option['value'] for option in options], list(BUILTINS))
        self.assertEqual(self.store.state(self.gabbai)['classifications'], options)
        self.assertEqual(self.store.state(self.member)['classifications'], [])
        self.assertEqual(self.http('POST', path, dict(name='  ותיק  '), 'gabbai-token')[0], 201)
        self.assertEqual(self.store.classifications(self.gabbai)[-1], dict(value='ותיק', label='ותיק'))
        with self.store.db() as db:
            self.assertEqual(db.execute("SELECT created_by FROM classifications WHERE name='ותיק'").fetchone()[0], self.gabbai_id)

    def test_names_are_validated_and_duplicate_builtin_aliases_are_rejected(self):
        path = '/api/admin/classifications'
        for body in [dict(name=''), dict(name=' '), dict(name='x' * 61), dict(name='bad\nname'), dict(name='ותיק', role='gabbai')]:
            self.assertEqual(self.http('POST', path, body, 'gabbai-token')[0], 400)
        for name in ['א', 'א׳', 'דור ב׳', 'א — חבר עמותה', 'קבוע']:
            self.assertEqual(self.http('POST', path, dict(name=name), 'gabbai-token')[0], 409)
        self.assertEqual(self.http('POST', path, dict(name='VIP'), 'gabbai-token')[0], 201)
        self.assertEqual(self.http('POST', path, dict(name='vip'), 'gabbai-token')[0], 409)

    def test_all_classifications_can_be_assigned_to_account_holders_and_gabbaim(self):
        with self.store.db() as db:
            identities = [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')]
        for identifier in [self.member_id, self.gabbai_id]:
            for classification in BUILTINS:
                with self.subTest(person=identifier, classification=classification):
                    status, saved, _ = self.http('PUT', '/api/admin/roster/' + identifier, dict(classification=classification), 'gabbai-token')
                    self.assertEqual(status, 200, saved)
                    self.assertEqual(saved['classification'], classification)
                    details = self.store.person_details(self.gabbai, identifier)
                    profile = copy.deepcopy(details['profile'])
                    profile['tribe'] = 'yisrael'
                    status, saved, _ = self.http('PUT', '/api/admin/people/' + identifier,
                        dict(profile=profile, classification=classification, allocatedSeats=None, barMitzvahDate=''), 'gabbai-token')
                    self.assertEqual(status, 200, saved)
                    self.assertEqual(Store(self.store.path).person_details(self.gabbai, identifier)['person']['classification'], classification)
            self.assertEqual(self.store.state(self.gabbai)['role'], 'gabbai')
        with self.store.db() as db:
            self.assertEqual(identities, [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')])

    def test_custom_classification_persists_in_family_editor_and_never_grants_seats_or_role(self):
        self.store.add_classification(self.gabbai, dict(name='ותיק'))
        son = self.family_child('permanent-son', hebrewBirthDate=dict(day=1, month='tishrei', year=5760))
        self.store.save_profile(self.member, self.family_profile([son]))
        self.store.save_roster_person(self.gabbai, dict(classification='א', allocatedSeats=4), self.member_id)
        self.store.save_roster_person(self.gabbai, dict(classification='ותיק'), son['id'])
        self.store.save_roster_person(self.gabbai, dict(classification='ותיק'), self.member_id)
        reloaded = Store(self.store.path)
        state = reloaded.state(self.member)
        self.assertEqual((state['classification'], state['role'], state['seating']['eligible']), ('ותיק', 'member', False))
        self.assertIsNone(state['seating']['allocatedSeats'])
        self.assertEqual(reloaded.person_details(self.gabbai, son['id'])['person']['classification'], 'ותיק')
        self.assertEqual(state['profile']['children'][0]['id'], son['id'])
        self.assertIn('ותיק', [option['value'] for option in reloaded.classifications(self.gabbai)])
        profile = copy.deepcopy(state['profile'])
        profile['classification'] = 'א'
        self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 400)
        self.assertEqual(self.http('PUT', '/api/admin/roster/' + self.member_id, dict(classification='לא קיים'), 'gabbai-token')[0], 400)

    def test_registry_upgrade_preserves_existing_classifications_and_people(self):
        with self.store.db() as db:
            db.execute("UPDATE roster_people SET classification='ותיק' WHERE id=?", (self.member_id,))
            db.execute('DROP TABLE classifications')
            before = [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')]
        upgraded = Store(self.store.path)
        self.assertIn('ותיק', [option['value'] for option in upgraded.classifications(self.gabbai)])
        self.assertEqual(upgraded.state(self.member)['classification'], 'ותיק')
        with upgraded.db() as db:
            self.assertEqual(before, [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')])
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_rosh_hashanah_defaults_distinguish_both_days_without_rewriting_old_records(self):
        for day, expected in [(1, 'א׳ ראש השנה'), (2, 'ב׳ ראש השנה')]:
            civil = dates.HebrewDate(5787, 7, day).to_pydate()
            template = aliyah_template(civil)
            self.assertEqual(template['reading'], expected)
            self.assertEqual(template['regularCount'], 7 if civil.weekday() == 5 else 5)
            self.assertFalse(template['allowExtra'])
        original = self.store.save_aliyah_service(self.gabbai, dict(date='2026-09-12', service='shacharit', reading='ראש השנה', calls=[]))
        restored = next(row for row in Store(self.store.path).aliyah_services(self.gabbai) if row['id'] == original['id'])
        self.assertEqual(restored, original)
