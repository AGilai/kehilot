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

    def test_self_registration_is_unclassified_and_cannot_request_seats_or_privileges(self):
        body = dict(email='new@example.test', password=helpers.PASSWORD, firstName='שם פרטי', lastName='שם משפחה')
        for extra in (dict(role='gabbai'), dict(classification='א'), dict(allocatedSeats=4)):
            self.assertEqual(self.http('POST', '/api/register', {**body, **extra})[0], 400)
        status, account, _ = self.http('POST', '/api/register', body)
        self.assertEqual(status, 201, account)
        token = account['token']
        state = self.http('GET', '/api/me', token=token)[1]
        self.assertEqual(state['role'], 'member')
        self.assertFalse(state['seating']['eligible'])
        self.assertEqual(state['profile']['firstName'], 'שם פרטי')
        self.assertEqual(self.http('GET', '/api/admin/membership-requests', token=token)[0], 403)
        self.assertEqual(self.store.membership_requests(self.gabbai), [])
        profile = state['profile']
        profile['tribe'] = 'levi'
        self.assertEqual(self.http('PUT', '/api/profile', profile, token)[0], 200)
        requests = self.store.membership_requests(self.gabbai)
        self.assertEqual([r['id'] for r in requests], [account['user']['id']])
        self.assertNotIn('password_hash', json.dumps(requests))
        self.assertEqual(self.http('POST', '/api/register', body)[0], 409)

    def test_registration_is_rate_limited_and_password_policy_is_enforced(self):
        body = dict(email='new@example.test', password='short', firstName='שם', lastName='משפחה')
        for _ in range(5):
            self.assertEqual(self.http('POST', '/api/register', body)[0], 400)
        self.assertEqual(self.http('POST', '/api/register', body)[0], 429)

    def test_new_profile_creates_one_durable_private_gabbai_alert(self):
        profile = self.save_details()
        self.store.save_profile(self.member, profile)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM membership_requests').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT user_id,member_id FROM membership_outbox').fetchone()[:], (self.gabbai_id, self.member_id))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 0)
        restarted = Store(self.store.path)
        self.assertEqual(len(restarted.membership_requests(self.gabbai)), 1)
        self.assertEqual(self.store.state(self.member)['membershipRequests'], [])
        self.assertEqual(len(self.store.state(self.gabbai)['membershipRequests']), 1)

    def test_classification_is_gabbai_only_and_regular_attendees_never_report(self):
        profile = self.save_details()
        for field, value in [('classification', 'א'), ('role', 'gabbai'), ('allocatedSeats', 4)]:
            self.assertEqual(self.http('PUT', '/api/profile', {**profile, field: value}, 'member-token')[0], 400)
        path = '/api/admin/roster/' + self.member_id
        self.assertEqual(self.http('PUT', path, dict(classification='א'), 'member-token')[0], 403)
        self.assertEqual(self.http('PUT', path, dict(classification='דור ב'), 'gabbai-token')[0], 400)
        self.assertEqual(self.http('PUT', path, dict(classification='קבוע'), 'gabbai-token')[0], 200)
        self.assertEqual(self.store.membership_requests(self.gabbai), [])
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

    def test_gabbai_push_is_generic_private_and_opens_review_screen(self):
        self.save_details()
        self.store.set_push_token(self.gabbai, 'gabbai-token', dict(token='ExpoPushToken[testGabbaiToken123]'))
        sent = []
        def send(payload):
            sent.extend(payload)
            return dict(data=[dict(status='ok') for _ in payload])
        self.assertTrue(process_one(self.store, send))
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]['data'], dict(screen='membership'))
        self.assertNotIn('לדוגמה', json.dumps(sent))
        self.assertEqual(sent[0]['to'], 'ExpoPushToken[testGabbaiToken123]')
        self.assertFalse(process_one(self.store, send))

    def test_pending_alert_is_skipped_after_classification(self):
        self.save_details()
        self.store.set_push_token(self.gabbai, 'gabbai-token', dict(token='ExpoPushToken[testGabbaiToken123]'))
        self.store.save_roster_person(self.gabbai, dict(classification='קבוע'), self.member_id)
        self.assertTrue(process_one(self.store, lambda payload: self.fail('Resolved requests should not send a push')))
