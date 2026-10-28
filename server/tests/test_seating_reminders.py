from contextlib import contextmanager, ExitStack
from datetime import date, datetime, timedelta
import unittest
from unittest.mock import patch

from pyluach import dates
import test_seating as fixtures
from server.seating import ISRAEL
from server.seating_reminders import process_one
from server.store import Store


@contextmanager
def at(value):
    instant = datetime.fromisoformat(value)
    with ExitStack() as stack:
        for module in ['server.seating', 'server.seating_reminders', 'server.store']:
            stack.enter_context(patch(module + '.current_time', return_value=instant))
        yield


class SeatingRemindersTest(unittest.TestCase):
    setUpClass = classmethod(fixtures.SeatingTest.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.SeatingTest.tearDownClass.__func__)
    setUp = fixtures.SeatingTest.setUp
    tearDown = fixtures.SeatingTest.tearDown
    http = fixtures.SeatingTest.http
    allocate = fixtures.SeatingTest.allocate
    status = fixtures.SeatingTest.status
    payload = staticmethod(fixtures.SeatingTest.payload)
    report = fixtures.SeatingTest.report
    update_event = fixtures.SeatingTest.update_event

    def reset_events(self):
        with self.store.db() as db:
            db.execute('DELETE FROM seating_reports')
            db.execute('DELETE FROM seating_events')

    def token(self):
        self.store.set_push_token(self.member, 'member-token', dict(token='ExpoPushToken[seating_device_12345]'))

    def send(self, payload):
        self.sent.extend(payload)
        return {'data': [{'status': 'ok'} for _ in payload]}

    def test_friday_exact_slot_boundaries_and_israel_winter_time(self):
        self.token(); self.sent = []
        with at('2026-10-30T07:29:59+02:00'):
            self.store.maintain_seating_reminders()
            self.assertIsNone(self.status()['reminder'])
            self.assertFalse(process_one(self.store, self.send))
        with at('2026-10-30T07:30:00+02:00'):
            current = self.status()
            self.assertEqual(current['reminder']['slot'], '07:30')
            self.assertEqual(current['reminder']['scheduledAt'], '2026-10-30T05:30:00+00:00')
            self.assertTrue(process_one(self.store, self.send))
            self.assertFalse(process_one(self.store, self.send))
        with at('2026-10-30T11:59:59+02:00'):
            self.assertFalse(process_one(self.store, self.send))
        with at('2026-10-30T12:00:00+02:00'):
            self.assertTrue(process_one(self.store, self.send))
            self.assertEqual(self.status()['reminder']['slot'], '12:00')
        self.assertEqual(len(self.sent), 2)
        self.assertTrue(all(p['data']['screen'] == 'messages' for p in self.sent))
        self.assertNotIn(self.member['profile'], str(self.sent))

    def test_even_zero_report_before_slots_suppresses_both_notifications(self):
        self.report(0, shacharit=0)
        self.token(); self.sent = []
        for clock in ['2026-10-30T07:30:00+02:00', '2026-10-30T12:00:00+02:00']:
            with at(clock):
                self.assertFalse(process_one(self.store, self.send))
                self.assertIsNone(self.status()['reminder'])
        self.assertEqual(self.sent, [])

    def test_reporting_after_morning_cancels_queued_push_and_noon_and_reports_can_be_edited(self):
        with at('2026-10-30T07:30:00+02:00'):
            self.assertIsNotNone(self.status()['reminder'])
            saved = self.report(1, shacharit=3)
            self.assertIsNone(saved['reminder'])
            self.token(); self.sent = []
            self.assertFalse(process_one(self.store, self.send))
            changed = self.report(2, saved, shacharit=1)
            self.assertEqual(changed['value'], dict(arvit=2, shacharit=1))
            self.assertEqual(changed['neededSeats'], dict(arvit=2, shacharit=3))
        with at('2026-10-30T12:00:00+02:00'):
            self.assertFalse(process_one(self.store, self.send))
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM seating_reports').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM seating_reminder_outbox').fetchone()[0], 0)

    def test_only_eligible_heads_with_known_allocations_receive_reminders(self):
        with at('2026-10-30T07:30:00+02:00'):
            self.store.maintain_seating_reminders()
            self.assertIsNone(self.status('other-token')['reminder'])
            self.assertIsNone(self.status('gabbai-token')['reminder'])
            self.allocate(self.member_id, None)
            self.assertIsNone(self.status()['reminder'])
            self.allocate(self.member_id, 0)
            self.assertIsNotNone(self.status()['reminder'])
            self.store.save_roster_person(self.gabbai, dict(classification='קבוע'), self.member_id)
            self.assertIsNone(self.status()['reminder'])

    def test_private_message_reads_do_not_count_as_reporting_and_noon_is_unread_again(self):
        with at('2026-10-30T07:30:00+02:00'):
            state = self.store.state(self.member)
            morning = next(m for m in state['messages'] if m.get('kind') == 'seating')
            path = '/api/messages/' + morning['id'] + '/read'
            self.assertEqual(self.http('POST', path, {})[0], 401)
            self.assertEqual(self.http('POST', path, {}, 'other-token')[0], 404)
            self.assertEqual(self.http('POST', path, {}, 'gabbai-token')[0], 404)
            self.assertEqual(self.http('POST', path, {}, 'member-token')[0], 200)
            state = Store(self.store.path).state(self.member)
            self.assertIn(morning['id'], state['readIds'])
            self.assertFalse(state['seating']['reported'])
            self.assertEqual(self.http('GET', '/api/messages', token='other-token')[1], [])
        with at('2026-10-30T12:00:00+02:00'):
            state = self.store.state(self.member)
            reminder = next(m for m in state['messages'] if m.get('kind') == 'seating')
            self.assertNotEqual(reminder['id'], morning['id'])
            self.assertNotIn(reminder['id'], state['readIds'])
            self.assertNotIn(morning['id'], state['readIds'])
            self.assertEqual(self.http('POST', path, {}, 'member-token')[0], 404)

    def test_reports_and_reminders_are_physically_removed_at_midnight_after_shabbat(self):
        with at('2026-10-30T07:30:00+02:00'):
            old = self.status(); self.report(2)
        with at('2026-10-31T23:59:59+02:00'):
            self.assertTrue(self.status()['reported'])
        with at('2026-11-01T00:00:00+02:00'):
            self.store.maintain_seating_reminders()
            current = self.status()
            self.assertEqual(current['event']['date'], '2026-11-07')
            self.assertFalse(current['reported'])
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM seating_reports').fetchone()[0], 0)
            self.assertIsNone(db.execute('SELECT id FROM seating_events WHERE id=?', (old['event']['id'],)).fetchone())
            self.assertEqual(db.execute('SELECT COUNT(*) FROM seating_reminder_outbox').fetchone()[0], 0)

    def test_rosh_hashanah_is_one_two_day_period_and_clears_only_after_second_day(self):
        self.reset_events()
        with at('2026-09-11T07:30:00+03:00'):
            current = self.status()
            self.assertEqual(current['event']['startsOn'], '2026-09-12')
            self.assertEqual(current['event']['endsOn'], '2026-09-13')
            self.assertEqual(current['event']['reminderDate'], '2026-09-11')
            self.assertEqual(current['event']['mode'], 'needed')
            self.report(3)
        with at('2026-09-13T23:59:59+03:00'):
            self.assertTrue(self.status()['reported'])
            self.assertEqual(self.status()['event']['id'], current['event']['id'])
        with at('2026-09-14T00:00:00+03:00'):
            self.store.maintain_seating_reminders()
            self.assertFalse(self.status()['reported'])
        with self.store.db() as db:
            self.assertIsNone(db.execute('SELECT id FROM seating_events WHERE id=?', (current['event']['id'],)).fetchone())

    def test_friday_festival_and_shabbat_share_one_report_and_use_thursday_summer_reminders(self):
        self.reset_events()
        holiday = dates.HebrewDate(5787, 3, 6).to_pydate()
        self.assertEqual(holiday.weekday(), 4)
        eve = holiday - timedelta(days=1)
        with at(eve.isoformat() + 'T07:30:00+03:00'):
            current = self.status()
            self.assertEqual(current['event']['date'], holiday.isoformat())
            self.assertEqual(current['event']['endsOn'], (holiday + timedelta(days=1)).isoformat())
            self.assertEqual(current['event']['reminderDate'], eve.isoformat())
            self.assertTrue(current['reminder']['scheduledAt'].endswith('04:30:00+00:00'))
            self.report(1, shacharit=2)
        with at((holiday + timedelta(days=1)).isoformat() + 'T20:00:00+03:00'):
            self.assertTrue(self.status()['reported'])
        with at((holiday + timedelta(days=2)).isoformat() + 'T00:00:00+03:00'):
            self.assertFalse(self.status()['reported'])

    def test_weekday_yom_kippur_is_selected_before_the_following_shabbat(self):
        self.reset_events()
        with at('2026-09-20T07:30:00+03:00'):
            current = self.status()
            self.assertEqual(current['event']['date'], '2026-09-21')
            self.assertEqual(current['event']['title'], 'יום כיפור')
            self.assertEqual(current['event']['mode'], 'needed')
            self.assertEqual(current['reminder']['slot'], '07:30')

    def test_closed_events_quota_changes_and_stale_contexts_cancel_old_alerts(self):
        with at('2026-10-30T07:30:00+02:00'):
            old = self.status()
            self.allocate(self.member_id, 3)
            changed = self.status()
            self.assertNotEqual(changed['reminder']['id'], old['reminder']['id'])
            self.update_event(changed['event'], reportingOpen=False)
            self.assertIsNone(self.status()['reminder'])
            self.token(); self.sent = []
            self.assertFalse(process_one(self.store, self.send))

    def test_restart_deduplicates_and_late_slots_are_not_replayed(self):
        self.token(); self.sent = []
        with at('2026-10-30T07:30:00+02:00'):
            first = self.status()['reminder']
            self.assertEqual(Store(self.store.path).seating(self.member)['reminder']['id'], first['id'])
        with at('2026-10-30T08:00:00+02:00'):
            self.assertFalse(process_one(self.store, self.send))
        with at('2026-10-30T12:00:00+02:00'):
            self.assertTrue(process_one(self.store, self.send))
            self.assertFalse(process_one(self.store, self.send))
        with at('2026-10-30T12:30:00+02:00'):
            self.assertFalse(process_one(self.store, self.send))
        self.assertEqual(len(self.sent), 1)

    def test_failed_delivery_retry_cannot_survive_submission(self):
        self.token()
        def failure(_payload):
            raise OSError('Temporary notification service failure')
        with at('2026-10-30T07:30:00+02:00'):
            self.assertTrue(process_one(self.store, failure))
            with self.store.db() as db:
                self.assertEqual(db.execute('SELECT attempts FROM seating_reminder_outbox').fetchone()[0], 1)
            self.report(0)
        with at('2026-10-30T07:35:00+02:00'):
            self.assertFalse(process_one(self.store, lambda payload: self.fail('Reminder sent after a report')))

    def test_custom_sunday_event_moves_reminders_back_from_shabbat_to_friday(self):
        status, event, _ = self.http('POST', '/api/admin/seating/events',
                                   dict(date='2026-11-01', mode='unused', occasion='custom'), 'gabbai-token')
        self.assertEqual(status, 201, event)
        self.assertEqual(event['reminderDate'], '2026-10-30')
        with at('2026-10-31T07:30:00+02:00'):
            self.assertIsNone(self.status()['reminder'])

    def test_period_end_upgrade_preserves_existing_report_and_allocation(self):
        original = self.report(1, shacharit=2)
        with self.store.db() as db:
            db.execute('ALTER TABLE seating_events DROP COLUMN end_date')
        with at('2026-10-25T12:00:00+02:00'):
            current = Store(self.store.path).seating(self.member)
        self.assertEqual(current['event']['id'], original['event']['id'])
        self.assertEqual(current['event']['endsOn'], '2026-10-31')
        self.assertEqual(current['value'], original['value'])
        self.assertEqual(current['allocationRevision'], original['allocationRevision'])
        self.assertTrue(current['reported'])


if __name__ == '__main__':
    unittest.main()
