import unittest

import test_seating as fixtures
from test_seating_reminders import at
from server.validation import APIError


class SeatingAccountLinksTest(unittest.TestCase):
    setUpClass = classmethod(fixtures.SeatingTest.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.SeatingTest.tearDownClass.__func__)
    tearDown = fixtures.SeatingTest.tearDown
    http = fixtures.SeatingTest.http
    allocate = fixtures.SeatingTest.allocate
    status = fixtures.SeatingTest.status
    payload = staticmethod(fixtures.SeatingTest.payload)
    report = fixtures.SeatingTest.report

    def setUp(self):
        fixtures.SeatingTest.setUp(self)
        self.household = self.store.save_roster_person(self.gabbai, dict(
            firstName='ראש', lastName='משפחה', tribe='yisrael', classification='א', allocatedSeats=4))['id']
        with self.store.db() as db:
            db.execute('UPDATE community_people SET active=0 WHERE id=?', (self.gabbai_id,))
            db.execute('UPDATE roster_people SET active=0 WHERE id=?', (self.gabbai_id,))

    def link(self, apply=True):
        return self.store.link_seating_account('gabbai@example.test', self.household, apply)

    def test_explicit_link_enables_existing_household_without_replacing_identity(self):
        self.assertFalse(self.status('gabbai-token')['eligible'])
        self.assertTrue(self.link(False)['changed'])
        self.assertFalse(self.status('gabbai-token')['eligible'])
        self.link()
        status = self.status('gabbai-token')
        self.assertTrue(status['eligible']); self.assertEqual(status['allocatedSeats'], 4)
        self.report(2, token='gabbai-token', shacharit=1)
        self.report(1, token='gabbai-token', shacharit=3)
        with self.store.db() as db:
            rows = db.execute('SELECT * FROM seating_reports WHERE submitted_by=?', (self.gabbai_id,)).fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['person_id'], self.household)
            self.assertEqual((rows[0]['arvit_needed'], rows[0]['shacharit_needed']), (3,1))
            self.assertIsNone(db.execute('SELECT source_person_id FROM roster_people WHERE id=?',(self.household,)).fetchone()[0])
        self.assertFalse(self.link()['changed'])

    def test_linked_reminders_belong_to_login_account_and_resolve_on_reporting(self):
        self.link()
        with at('2026-10-30T07:30:00+02:00'):
            reminder = self.status('gabbai-token')['reminder']
            self.assertIsNotNone(reminder)
            identifier = reminder['id']
            self.assertEqual(self.http('POST', '/api/messages/'+identifier+'/read', {}, 'other-token')[0],404)
            self.assertEqual(self.http('POST', '/api/messages/'+identifier+'/read', {}, 'gabbai-token')[0],200)
            self.assertTrue(self.status('gabbai-token')['reminder']['read'])
            with self.store.db() as db:
                self.assertEqual(db.execute('SELECT user_id FROM seating_reminder_outbox WHERE id=?',(identifier,)).fetchone()[0],self.gabbai_id)
            self.report(0, token='gabbai-token')
            self.assertIsNone(self.status('gabbai-token')['reminder'])
            self.assertFalse(self.store.seating_messages(self.gabbai))

    def test_conflicting_native_or_existing_links_are_rejected(self):
        with self.assertRaises(APIError):
            self.store.link_seating_account('member@example.test', self.household, True)
        self.link()
        with self.assertRaises(APIError):
            self.store.link_seating_account('gabbai@example.test', self.member_id, True)
        with self.assertRaises(APIError):
            self.store.link_seating_account('other@example.test', self.household, True)
        with self.assertRaises(APIError):
            self.store.link_seating_account('missing@example.test', self.household, True)

    def test_members_cannot_choose_target_and_classification_still_controls_access(self):
        self.link()
        payload = self.payload(self.status('gabbai-token'), 1)
        payload['personId'] = self.member_id
        self.assertEqual(self.http('PUT','/api/seating',payload,'gabbai-token')[0],400)
        self.store.save_roster_person(self.gabbai,dict(classification='קבוע'),self.household)
        self.assertFalse(self.status('gabbai-token')['eligible'])
        payload.pop('personId')
        self.assertEqual(self.http('PUT','/api/seating',payload,'gabbai-token')[0],403)


if __name__ == '__main__': unittest.main()
