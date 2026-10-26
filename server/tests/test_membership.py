import json
import unittest
from unittest.mock import patch
from datetime import date

from server.store import Store
from server.push import process_one
import test_api as helpers


class MembershipTest(unittest.TestCase):
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

    def save_details(self):
        profile = self.family_profile([])
        self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 200)
        return profile

    def test_email_registration_is_retired(self):
        self.assertEqual(self.http('POST', '/api/register', dict(email='new@example.test', password=helpers.PASSWORD, firstName='שם', lastName='משפחה'))[0], 410)

    def test_profiles_no_longer_queue_classification_requests(self):
        self.save_details()
        self.save_details()
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM membership_requests').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM membership_outbox').fetchone()[0], 0)
        self.assertNotIn('membershipRequests', self.store.state(self.gabbai))
        self.assertEqual(self.http('GET', '/api/admin/membership-requests', token='gabbai-token')[0], 404)

    def test_classification_is_gabbai_only_and_regular_attendees_never_report(self):
        profile = self.save_details()
        for field, value in [('classification', 'א'), ('role', 'gabbai'), ('allocatedSeats', 4)]:
            self.assertEqual(self.http('PUT', '/api/profile', {**profile, field: value}, 'member-token')[0], 400)
        path = '/api/admin/roster/' + self.member_id
        self.assertEqual(self.http('PUT', path, dict(classification='א'), 'member-token')[0], 403)
        self.assertEqual(self.http('PUT', path, dict(classification='דור ב'), 'gabbai-token')[0], 200)
        self.assertEqual(self.http('PUT', path, dict(classification='קבוע'), 'gabbai-token')[0], 200)
        state = self.store.seating(self.member)
        self.assertFalse(state['eligible'])
        event = state['event']
        payload = dict(eventId=event['id'], revision=event['revision'], mode=event['mode'], allocatedSeats=0, allocationRevision=1, arvit=0, shacharit=0)
        self.assertEqual(self.http('PUT', '/api/seating', payload, 'member-token')[0], 403)
        self.assertEqual(self.http('PUT', path, dict(classification='א', allocatedSeats=3), 'gabbai-token')[0], 200)
        state = self.store.seating(self.member)
        self.assertTrue(state['eligible'])
        payload.update(allocatedSeats=3, allocationRevision=state['allocationRevision'], arvit=1, shacharit=2)
        self.assertEqual(self.http('PUT', '/api/seating', payload, 'member-token')[0], 200)
        self.assertEqual(self.http('PUT', path, dict(classification='קבוע'), 'gabbai-token')[0], 200)
        self.assertEqual(self.http('PUT', '/api/seating', payload, 'member-token')[0], 403)
        current = self.store.seating(self.member)
        event = self.store.save_seating_event(self.gabbai, dict(date=current['event']['date'], mode='needed', title='שבת מיוחדת'))
        payload.update(eventId=event['id'], revision=event['revision'], mode='needed')
        self.assertEqual(self.http('PUT', '/api/seating', payload, 'member-token')[0], 403)

    def test_family_classifications_are_persisted_and_person_identities_survive_changes(self):
        son = self.family_child('son', hebrewBirthDate=dict(day=1, month='tishrei', year=5770))
        married = self.family_child('married-son', married=True, hebrewBirthDate=dict(day=1, month='tishrei', year=5760))
        daughter = self.family_child('daughter', 'daughter', married=True, spouseName='חתן', spouseTribe='kohen')
        young = self.family_child('young', hebrewBirthDate=dict(day=1, month='tishrei', year=5780))
        profile = self.family_profile([son, married, daughter, young])
        self.store.save_profile(self.member, profile)
        path = '/api/admin/roster/' + self.member_id
        with patch('server.roster.israel_today', return_value=date(2026, 10, 25)):
            self.assertEqual(self.http('PUT', path, dict(classification='א'), 'gabbai-token')[0], 200)
        with self.store.db() as db:
            rows = {r['id']: dict(r) for r in db.execute('SELECT * FROM roster_people')}
            self.assertEqual(rows['son']['classification'], 'דור ב')
            self.assertEqual(rows['married-son']['classification'], 'דור ב-נשוי')
            husband = next(r for r in rows.values() if r['family_child_id'] == 'daughter')
            self.assertEqual((husband['classification'], husband['tribe']), ('חתן', 'kohen'))
            self.assertNotIn('young', rows)
            identities = [tuple(r) for r in db.execute('SELECT id,created_at FROM community_people ORDER BY id')]
        son['married'] = True
        self.store.save_profile(self.member, profile)
        self.store.refresh_roster(date(2035, 1, 1))
        with self.store.db() as db:
            self.assertEqual(db.execute("SELECT classification FROM roster_people WHERE id='son'").fetchone()[0], 'דור ב-נשוי')
            self.assertEqual(db.execute("SELECT classification FROM roster_people WHERE id='young'").fetchone()[0], 'דור ב')
        self.assertEqual(self.http('PUT', path, dict(classification='קבוע'), 'gabbai-token')[0], 200)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT classification FROM roster_people WHERE id=?', (husband['id'],)).fetchone()[0], 'קבוע')
            self.assertEqual(identities, [tuple(r) for r in db.execute('SELECT id,created_at FROM community_people ORDER BY id')])
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
        self.assertEqual(self.http('PUT', path, dict(classification='א'), 'gabbai-token')[0], 200)
        restarted = Store(self.store.path)
        with restarted.db() as db:
            self.assertEqual(db.execute("SELECT id FROM roster_people WHERE family_child_id='daughter'").fetchone()[0], husband['id'])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0], 3)
        # A removed daughter archives her husband's roster entry, and restoring
        # the same daughter reactivates the same husband identity.
        profile['children'] = [son, married, young]
        self.store.save_profile(self.member, profile)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT active FROM roster_people WHERE id=?', (husband['id'],)).fetchone()[0], 0)
        profile['children'].append(daughter)
        self.store.save_profile(self.member, profile)
        with self.store.db() as db:
            self.assertEqual(db.execute("SELECT id,active FROM roster_people WHERE family_child_id='daughter'").fetchone()[:], (husband['id'], 1))

    def test_upgrade_retires_old_alerts_without_deleting_people(self):
        with self.store.db() as db:
            db.execute('INSERT INTO membership_requests VALUES (?,?)', (self.member_id, '2026-01-01'))
            db.execute('INSERT INTO membership_outbox (id,user_id,member_id,available_at) VALUES (?,?,?,0)', ('legacy', self.gabbai_id, self.member_id))
            identities = [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')]
        upgraded = Store(self.store.path)
        with upgraded.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM membership_requests').fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT status FROM membership_outbox WHERE id='legacy'").fetchone()[0], 'skipped')
            self.assertEqual(identities, [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')])
        self.assertFalse(process_one(upgraded, lambda payload: self.fail('Retired alerts must not send')))
