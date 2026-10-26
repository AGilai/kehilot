from datetime import date, datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pyluach import dates
import test_api as api_helpers
from server.store import Store


class SeatingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template_dir = tempfile.TemporaryDirectory()
        cls.template = Path(cls.template_dir.name) / 'template.db'
        store = Store(cls.template)
        cls.member_id = store.create_user('member@example.test', api_helpers.PASSWORD, 'חבר לדוגמה')
        cls.other_id = store.create_user('other@example.test', api_helpers.PASSWORD, 'חבר נוסף')
        cls.gabbai_id = store.create_user('gabbai@example.test', api_helpers.PASSWORD, 'גבאי לדוגמה', 'gabbai')

    @classmethod
    def tearDownClass(cls):
        cls.template_dir.cleanup()

    def setUp(self):
        clock = patch('server.seating.current_time', return_value=datetime(2026, 10, 25, 10, tzinfo=timezone.utc))
        clock.start()
        self.addCleanup(clock.stop)
        for module in ['server.store', 'server.roster', 'server.validation']:
            today = patch(module + '.israel_today', return_value=date(2026, 10, 25))
            today.start()
            self.addCleanup(today.stop)
        api_helpers.CommunityTest.setUp(self)
        self.allocate(self.member_id, 4)

    tearDown = api_helpers.CommunityTest.tearDown
    http = api_helpers.CommunityTest.http

    def allocate(self, person_id, count):
        return self.store.save_roster_person(self.gabbai, dict(classification='א', allocatedSeats=count), person_id)

    def status(self, token='member-token'):
        status, body, _ = self.http('GET', '/api/seating', token=token)
        self.assertEqual(status, 200, body)
        return body

    @staticmethod
    def payload(context, value, shacharit=None):
        return dict(eventId=context['event']['id'], revision=context['event']['revision'], mode=context['event']['mode'],
                    allocatedSeats=context['allocatedSeats'], allocationRevision=context['allocationRevision'], arvit=value, shacharit=value if shacharit is None else shacharit)

    def report(self, value, context=None, token='member-token', shacharit=None):
        body = self.payload(context or self.status(token), value, shacharit)
        status, saved, _ = self.http('PUT', '/api/seating', body, token)
        self.assertEqual(status, 200, saved)
        return saved

    def special(self, **changes):
        body = dict(date='2026-10-31', title='פרשת וירא · שבת מיוחדת', mode='needed')
        body.update(changes)
        status, event, _ = self.http('POST', '/api/admin/seating/events', body, 'gabbai-token')
        self.assertEqual(status, 201, event)
        return event

    def summary(self, event):
        status, body, _ = self.http('GET', '/api/admin/seating/events/' + event['id'] + '/summary', token='gabbai-token')
        self.assertEqual(status, 200, body)
        return body

    def update_event(self, event, **changes):
        status, body, _ = self.http('PUT', '/api/admin/seating/events/' + event['id'], changes, 'gabbai-token')
        self.assertEqual(status, 200, body)
        return body

    def test_ordinary_missing_reports_keep_all_seats_and_special_missing_reports_release_them(self):
        self.allocate(self.other_id, 3)
        state = self.status()
        self.assertEqual(state['event']['date'], '2026-10-31')
        self.assertEqual(state['event']['parasha'], 'פרשת וירא')
        self.assertEqual(state['event']['mode'], 'unused')
        self.assertEqual((state['reported'], state['neededSeats']['arvit'], state['releasedSeats']['arvit']), (False, 4, 0))
        summary = self.summary(state['event'])
        self.assertEqual((summary['totalAllocated'], summary['totalNeeded']['arvit'], summary['totalReleased']['arvit']), (7, 7, 0))
        event = self.special()
        special = self.status()
        self.assertEqual((special['reported'], special['value'], special['neededSeats']['arvit'], special['releasedSeats']['arvit']), (False, None, 0, 4))
        summary = self.summary(event)
        self.assertEqual((summary['totalNeeded']['arvit'], summary['totalReleased']['arvit'], summary['unreportedHouseholds']), (0, 7, 3))

    def test_report_values_have_opposite_meanings_and_zero_is_an_explicit_report(self):
        normal = self.report(0)
        self.assertTrue(normal['reported'])
        self.assertEqual(normal['neededSeats']['arvit'], 4)
        self.assertEqual(self.report(2)['neededSeats']['arvit'], 2)
        event = self.special()
        zero = self.report(0)
        self.assertTrue(zero['reported'])
        self.assertEqual(zero['value'], dict(arvit=0, shacharit=0))
        self.assertEqual(zero['neededSeats']['arvit'], 0)
        self.assertEqual(self.summary(event)['unreportedHouseholds'], 1)
        for _ in range(2):
            saved = self.report(3)
        self.assertEqual((saved['neededSeats']['arvit'], saved['releasedSeats']['arvit']), (3, 1))
        self.assertEqual(self.summary(event)['totalNeeded']['arvit'], 3)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM seating_reports WHERE event_id=?', (event['id'],)).fetchone()[0], 1)

    def test_prayers_are_independent_atomic_and_single_number_clients_must_update(self):
        saved = self.report(1, shacharit=3)
        self.assertEqual(saved['value'], dict(arvit=1, shacharit=3))
        self.assertEqual(saved['neededSeats'], dict(arvit=3, shacharit=1))
        self.assertEqual(saved['releasedSeats'], dict(arvit=1, shacharit=3))
        self.assertEqual(self.summary(saved['event'])['totalNeeded'], dict(arvit=3, shacharit=1))
        context = self.status()
        for prayer in ('arvit', 'shacharit'):
            for invalid in (5, -1, True, '2', 1.5, None):
                payload = self.payload(context, 0)
                payload[prayer] = invalid
                self.assertEqual(self.http('PUT', '/api/seating', payload, 'member-token')[0], 400)
        payload = self.payload(context, 0)
        del payload['shacharit']
        self.assertEqual(self.http('PUT', '/api/seating', payload, 'member-token')[0], 400)
        payload['value'] = payload.pop('arvit')
        self.assertEqual(self.http('PUT', '/api/seating', payload, 'member-token')[0], 400)
        self.assertEqual(self.status()['value'], saved['value'])
        self.special()
        active = self.report(0, shacharit=2)
        self.assertTrue(active['reported'])
        self.assertEqual(active['neededSeats'], dict(arvit=0, shacharit=2))

    def test_reports_remain_through_saturday_and_cleanup_worker_removes_past_data(self):
        old = self.report(1, shacharit=2)
        with patch('server.seating.current_time', return_value=datetime(2026, 10, 31, 12, tzinfo=timezone.utc)):
            current = self.status()
            self.assertEqual(current['event']['id'], old['event']['id'])
            self.assertTrue(current['reported'])
            self.assertFalse(current['event']['reportingOpen'])
            self.assertEqual(self.summary(old['event'])['totalNeeded'], dict(arvit=3, shacharit=2))
        with patch('server.seating.current_time', return_value=datetime(2026, 11, 1, 0, tzinfo=timezone.utc)):
            self.store.refresh_roster()
            with self.store.db() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM seating_reports').fetchone()[0], 0)
            self.assertEqual(self.http('GET', '/api/admin/seating/events/' + old['event']['id'] + '/summary', token='gabbai-token')[0], 404)

    def test_switching_current_event_removes_previous_reports_immediately(self):
        old = self.report(1)
        self.special(date='2026-11-07')
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM seating_reports').fetchone()[0], 0)
        self.update_event(old['event'], makeCurrent=True)
        self.assertFalse(self.status()['reported'])

    def test_upgrade_clears_ambiguous_legacy_report_and_preserves_allocations_and_people(self):
        saved = self.report(1, shacharit=2)
        with self.store.db() as db:
            before = [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')]
            db.execute('DROP TABLE seating_reports')
            db.execute('CREATE TABLE seating_reports (event_id TEXT, person_id TEXT, reported_value INTEGER)')
            db.execute('INSERT INTO seating_reports VALUES (?,?,?)', (saved['event']['id'], self.member_id, 1))
        restarted = Store(self.store.path)
        status = restarted.seating(self.member)
        self.assertFalse(status['reported'])
        self.assertEqual(status['allocatedSeats'], 4)
        self.assertEqual(status['neededSeats'], dict(arvit=4, shacharit=4))
        with restarted.db() as db:
            self.assertEqual(before, [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM seating_reports').fetchone()[0], 0)

    def test_reports_are_bounded_and_metadata_cannot_change_membership_or_meaning(self):
        context = self.status()
        for value in [-1, 5, True, 1.5, '2', None]:
            self.assertEqual(self.http('PUT', '/api/seating', self.payload(context, value), 'member-token')[0], 400)
        for patch_value in [dict(allocatedSeats=100), dict(revision=999), dict(allocationRevision=999), dict(mode='needed')]:
            body = {**self.payload(context, 1), **patch_value}
            self.assertEqual(self.http('PUT', '/api/seating', body, 'member-token')[0], 409)
        body = {**self.payload(context, 1), 'personId': self.other_id}
        self.assertEqual(self.http('PUT', '/api/seating', body, 'member-token')[0], 400)
        self.assertFalse(self.status()['reported'])

    def test_only_association_household_heads_can_report_and_only_gabbai_can_allocate(self):
        body = self.payload(self.status(), 2)
        self.assertEqual(self.http('PUT', '/api/seating', body, 'other-token')[0], 403)
        self.assertFalse(self.status('other-token')['eligible'])
        self.assertEqual(self.http('PUT', '/api/admin/roster/' + self.member_id, dict(allocatedSeats=8), 'member-token')[0], 403)
        self.assertEqual(self.http('POST', '/api/admin/seating/events', dict(date='2026-10-31', mode='needed'), 'member-token')[0], 403)
        self.assertEqual(self.http('GET', '/api/admin/seating/events', token='member-token')[0], 403)
        event_id = self.status()['event']['id']
        self.assertEqual(self.http('GET', '/api/admin/seating/events/' + event_id + '/summary', token='member-token')[0], 403)
        self.assertEqual(self.http('GET', '/api/seating')[0], 401)
        profile = self.store.state(self.member)['profile']
        profile.update(firstName='חבר', lastName='לדוגמה', tribe='yisrael', allocatedSeats=100)
        self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 400)
        self.assertEqual(self.status()['allocatedSeats'], 4)

    def test_unknown_allocation_is_distinct_from_an_explicit_zero(self):
        self.allocate(self.member_id, None)
        unknown = self.status()
        self.assertTrue(unknown['eligible'])
        self.assertIsNone(unknown['neededSeats'])
        self.assertEqual(self.summary(unknown['event'])['unconfiguredHouseholds'], 2)
        body = dict(eventId=unknown['event']['id'], revision=1, mode='unused', allocatedSeats=0, allocationRevision=unknown['allocationRevision'], arvit=0, shacharit=0)
        self.assertEqual(self.http('PUT', '/api/seating', body, 'member-token')[0], 409)
        self.allocate(self.member_id, 0)
        self.special()
        zero = self.report(0)
        self.assertTrue(zero['reported'])
        self.assertEqual(zero['neededSeats']['arvit'], 0)
        self.assertEqual(self.summary(zero['event'])['unconfiguredHouseholds'], 1)

    def test_allocation_changes_invalidate_old_reports_even_if_the_number_is_later_restored(self):
        original = self.status()
        self.report(1, original)
        self.allocate(self.member_id, 3)
        changed = self.status()
        self.assertTrue(changed['reportInvalidated'])
        self.assertFalse(changed['reported'])
        self.assertEqual(changed['neededSeats']['arvit'], 3)
        self.assertEqual(self.http('PUT', '/api/seating', self.payload(original, 1), 'member-token')[0], 409)
        self.allocate(self.member_id, 4)
        restored = self.status()
        self.assertTrue(restored['reportInvalidated'])
        self.assertGreater(restored['allocationRevision'], original['allocationRevision'])
        self.assertEqual(self.report(2, restored)['neededSeats']['arvit'], 2)
        self.store.save_roster_person(self.gabbai, dict(classification='קבוע'), self.member_id)
        self.assertFalse(self.status()['eligible'])
        with self.store.db() as db:
            self.assertIsNone(db.execute('SELECT allocated_seats FROM roster_people WHERE id=?', (self.member_id,)).fetchone()[0])

    def test_changing_mode_requires_a_new_active_report_and_rejects_stale_forms(self):
        old = self.status()
        self.report(2, old)
        event = self.update_event(old['event'], mode='needed')
        current = self.status()
        self.assertGreater(event['revision'], old['event']['revision'])
        self.assertEqual(current['neededSeats']['arvit'], 0)
        self.assertTrue(current['reportInvalidated'])
        self.assertEqual(self.http('PUT', '/api/seating', self.payload(old, 2), 'member-token')[0], 409)
        self.assertEqual(self.report(1, current)['neededSeats']['arvit'], 1)
        closed = self.update_event(event, reportingOpen=False)
        self.assertEqual(closed['revision'], event['revision'])
        self.assertEqual(self.status()['neededSeats']['arvit'], 1)
        self.assertEqual(self.status()['event']['mode'], 'needed')
        self.assertFalse(self.status()['event']['reportingOpen'])

    def test_closed_windows_and_explicit_deadlines_reject_late_updates(self):
        event = self.special(closesAt='2026-10-25T11:00:00+00:00')
        self.report(3)
        with patch('server.seating.current_time', return_value=datetime(2026, 10, 25, 12, tzinfo=timezone.utc)):
            context = self.status()
            self.assertFalse(context['event']['reportingOpen'])
            self.assertEqual(self.http('PUT', '/api/seating', self.payload(context, 4), 'member-token')[0], 409)
            self.assertEqual(self.status()['neededSeats']['arvit'], 3)
        bad = self.http('PUT', '/api/admin/seating/events/' + event['id'], dict(closesAt='2026-10-25T11:00:00'), 'gabbai-token')[0]
        self.assertEqual(bad, 400)

    def test_week_rollover_never_carries_a_report_into_another_shabbat(self):
        old = self.report(2)
        with patch('server.seating.current_time', return_value=datetime(2026, 11, 1, 10, tzinfo=timezone.utc)):
            current = self.status()
            self.assertEqual(current['event']['date'], '2026-11-07')
            self.assertFalse(current['reported'])
            self.assertEqual(current['neededSeats']['arvit'], 4)
            self.assertEqual(self.http('PUT', '/api/seating', self.payload(old, 2), 'member-token')[0], 409)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM seating_reports').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM seating_events WHERE id=?', (old['event']['id'],)).fetchone()[0], 0)

    def test_known_special_occasions_use_active_opt_in_and_gabbai_can_configure_megillah(self):
        with self.store.db() as db:
            db.execute('DELETE FROM seating_events')
        with patch('server.seating.current_time', return_value=datetime(2026, 2, 22, 10, tzinfo=timezone.utc)):
            zachor = self.status()
            self.assertEqual(zachor['event']['mode'], 'needed')
            self.assertIn('שבת זכור', zachor['event']['title'])
        with patch('server.seating.current_time', return_value=datetime(2026, 9, 6, 10, tzinfo=timezone.utc)):
            high = self.status()
            self.assertEqual(high['event']['mode'], 'needed')
            self.assertIn('ראש השנה', high['event']['title'])
        evening = dates.HebrewDate(5787, 13, 13).to_pydate().isoformat()
        body = dict(date=evening, title='קריאת מגילה בערב', occasion='megillah_evening', mode='unused')
        self.assertEqual(self.http('POST', '/api/admin/seating/events', body, 'gabbai-token')[0], 400)
        body['mode'] = 'needed'
        status, event, _ = self.http('POST', '/api/admin/seating/events', body, 'gabbai-token')
        self.assertEqual(status, 201)
        self.assertEqual(self.status()['event']['id'], event['id'])

    def test_allocations_persist_independently_of_profile_updates_and_have_valid_bounds(self):
        for value in [True, -1, 1001, '4', 1.5]:
            self.assertEqual(self.http('PUT', '/api/admin/roster/' + self.member_id, dict(allocatedSeats=value), 'gabbai-token')[0], 400)
        self.store.save_roster_person(self.gabbai, dict(classification='קבוע'), self.other_id)
        self.assertEqual(self.http('PUT', '/api/admin/roster/' + self.other_id, dict(allocatedSeats=1), 'gabbai-token')[0], 400)
        saved = self.report(1)
        profile = self.store.state(self.member)['profile']
        profile.update(firstName='שם', lastName='משפחה', tribe='yisrael')
        self.store.save_profile(self.member, profile)
        restarted = Store(self.store.path)
        current = restarted.seating(self.member)
        self.assertEqual(current['allocatedSeats'], 4)
        self.assertEqual(current['allocationRevision'], saved['allocationRevision'])
        self.assertEqual(current['neededSeats']['arvit'], 3)
        self.assertTrue(current['reported'])
        with restarted.db() as db:
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_events_are_date_bound_and_current_selection_is_explicit(self):
        original = self.status()['event']
        self.assertEqual(self.http('PUT', '/api/admin/seating/events/' + original['id'], dict(date='2026-11-07'), 'gabbai-token')[0], 400)
        queued = self.special(date='2026-11-07', makeCurrent=False)
        self.assertEqual(self.status()['event']['id'], original['id'])
        self.update_event(queued, makeCurrent=True)
        self.assertEqual(self.status()['event']['id'], queued['id'])
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM seating_events WHERE is_current=1').fetchone()[0], 1)

    def test_automatic_deadline_overrides_are_honored_and_schema_upgrades_preserve_identity(self):
        original = self.status()['event']
        self.update_event(original, closesAt='2026-10-31T10:00:00+02:00')
        with patch('server.seating.current_time', return_value=datetime(2026, 10, 31, 6, tzinfo=timezone.utc)):
            self.assertEqual(self.status()['event']['id'], original['id'])
            self.assertTrue(self.status()['event']['reportingOpen'])
        with self.store.db() as db:
            before = [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')]
            db.execute('DROP TABLE seating_reports')
            db.execute('DROP TABLE seating_events')
            db.execute('ALTER TABLE roster_people DROP COLUMN allocated_seats')
            db.execute('ALTER TABLE roster_people DROP COLUMN seat_allocation_revision')
        self.store = Store(self.store.path)
        self.assertIsNone(self.status()['allocatedSeats'])
        self.allocate(self.member_id, 5)
        self.report(1)
        restarted = Store(self.store.path)
        self.assertEqual(restarted.seating(self.member)['neededSeats']['arvit'], 4)
        with restarted.db() as db:
            after = [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')]
            self.assertEqual(before, after)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])


if __name__ == '__main__':
    unittest.main()
