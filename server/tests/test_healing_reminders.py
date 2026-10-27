from contextlib import contextmanager, ExitStack
from datetime import date
import json
import unittest
from unittest.mock import patch

import test_api as api_helpers
import test_healing_prayers as fixtures
from server.healing import next_month, message_id
from server.healing_import import import_requests
from server.push import process_healing_one
from server.store import Store


@contextmanager
def at(value):
    day = date.fromisoformat(value)
    with ExitStack() as stack:
        for module in ['store', 'healing', 'push', 'validation']:
            stack.enter_context(patch('server.' + module + '.israel_today', return_value=day))
        yield


class HealingRemindersTest(unittest.TestCase):
    setUpClass = classmethod(fixtures.HealingPrayersTest.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.HealingPrayersTest.tearDownClass.__func__)
    setUp = api_helpers.CommunityTest.setUp
    tearDown = api_helpers.CommunityTest.tearDown
    http = api_helpers.CommunityTest.http

    def add(self, day='2027-01-01', token='member-token'):
        with at(day):
            status, entry, _ = self.http('POST', '/api/healing-prayers', dict(name='שם פרטי לחולה בן אם פרטית'), token)
        self.assertEqual(status, 201, entry)
        return entry

    def own(self, day, token='member-token'):
        with at(day):
            status, rows, _ = self.http('GET', '/api/healing-prayers', token=token)
        self.assertEqual(status, 200, rows)
        return rows

    def test_exact_two_week_boundary_and_repeated_sweeps_do_not_duplicate_reminders(self):
        entry = self.add()
        self.assertEqual(entry['reminder']['dueOn'], '2027-01-15')
        self.assertEqual(entry['reminder']['expiresOn'], '2027-02-01')
        self.assertFalse(self.own('2027-01-14')[0]['reminder']['pending'])
        self.assertTrue(self.own('2027-01-15')[0]['reminder']['pending'])
        with at('2027-01-15'):
            for _ in range(3):
                self.store.maintain_healing_prayers()
            restarted = Store(self.store.path)
            self.assertTrue(restarted.healing_prayers(self.member)[0]['reminder']['pending'])
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM healing_reminder_outbox').fetchone()[0], 1)

    def test_keep_updates_record_date_resets_cycle_and_rejects_stale_responses(self):
        entry = self.add()
        self.own('2027-01-15')
        path = '/api/healing-prayers/' + entry['id'] + '/keep'
        with at('2027-01-16'):
            status, kept, _ = self.http('POST', path, dict(cycleId=entry['reminder']['cycleId']), 'member-token')
            self.assertEqual(status, 200, kept)
            self.assertEqual(kept['addedOn'], '2027-01-16')
            self.assertEqual(kept['reminder']['confirmedOn'], '2027-01-16')
            self.assertEqual(kept['reminder']['dueOn'], '2027-01-30')
            self.assertEqual(kept['reminder']['expiresOn'], '2027-02-16')
            self.assertNotEqual(kept['reminder']['cycleId'], entry['reminder']['cycleId'])
            self.assertEqual(self.http('POST', path, dict(cycleId=entry['reminder']['cycleId']), 'member-token')[0], 409)
            self.assertEqual(self.http('POST', path, dict(cycleId=kept['reminder']['cycleId']), 'member-token')[0], 409)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM healing_reminder_outbox').fetchone()[0], 0)
        self.assertFalse(self.own('2027-01-29')[0]['reminder']['pending'])
        self.assertTrue(self.own('2027-01-30')[0]['reminder']['pending'])
        self.assertEqual(len(self.own('2027-02-01')), 1)

    def test_only_owner_can_answer_and_unknown_payloads_cannot_extend_deadlines(self):
        entry = self.add()
        self.own('2027-01-15')
        path = '/api/healing-prayers/' + entry['id'] + '/keep'
        body = dict(cycleId=entry['reminder']['cycleId'])
        with at('2027-01-16'):
            self.assertEqual(self.http('POST', path, body)[0], 401)
            for token in ['other-token', 'gabbai-token']:
                self.assertEqual(self.http('POST', path, body, token)[0], 404)
            for invalid in [{}, dict(body, addedOn='2028-01-01'), dict(cycleId=None)]:
                self.assertEqual(self.http('POST', path, invalid, 'member-token')[0], 400)
        self.assertEqual(self.own('2027-01-16')[0]['reminder']['expiresOn'], '2027-02-01')

    def test_background_cleanup_physically_deletes_unanswered_name_and_cancels_queued_push(self):
        entry = self.add()
        self.own('2027-01-15')
        self.add('2027-01-28', 'other-token')
        self.assertEqual(len(self.own('2027-01-31')), 1)
        with at('2027-02-01'):
            result = self.store.maintain_healing_prayers()
            self.assertEqual(result['removed'], 1)
            self.assertFalse(process_healing_one(self.store, lambda payload: self.fail('Expired reminder sent')))
        self.assertEqual(self.own('2027-02-01'), [])
        self.assertEqual(len(self.own('2027-02-01', 'other-token')), 1)
        with self.store.db() as db:
            self.assertIsNone(db.execute('SELECT id FROM healing_prayers WHERE id=?', (entry['id'],)).fetchone())
            self.assertEqual(db.execute('SELECT COUNT(*) FROM healing_cycles WHERE prayer_id=?', (entry['id'],)).fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM healing_reminder_outbox WHERE prayer_id=?', (entry['id'],)).fetchone()[0], 0)

    def test_deadline_uses_record_date_even_if_server_was_offline_at_reminder_time(self):
        entry = self.add()
        with self.store.db() as db:
            db.execute('DELETE FROM healing_cycles WHERE prayer_id=?', (entry['id'],))
        self.assertEqual(self.own('2027-02-02'), [])

    def test_expired_keep_cannot_restore_name_and_commits_physical_cleanup(self):
        entry = self.add()
        with at('2027-02-01'):
            status, _, _ = self.http('POST', '/api/healing-prayers/' + entry['id'] + '/keep',
                                     dict(cycleId=entry['reminder']['cycleId']), 'member-token')
        self.assertEqual(status, 404)
        with self.store.db() as db:
            self.assertIsNone(db.execute('SELECT id FROM healing_prayers WHERE id=?', (entry['id'],)).fetchone())

    def test_calendar_month_clamps_month_end_and_handles_leap_year(self):
        for start, end in [('2027-01-31', '2027-02-28'), ('2028-01-31', '2028-02-29'),
                           ('2027-12-31', '2028-01-31'), ('2027-03-31', '2027-04-30')]:
            self.assertEqual(next_month(date.fromisoformat(start)).isoformat(), end)

    def test_unlinked_imports_stay_on_hold_until_a_trusted_account_link_exists(self):
        with at('2027-01-01'), self.store.db() as db:
            db.execute('''INSERT INTO roster_people (id,first_name,last_name,created_at,updated_at)
                VALUES ('existing-person','שם','קיים','2026-01-01','2026-01-01')''')
            import_requests(db, [dict(rosterPersonId='existing-person', submitter='שם קיים', name='שם חולה א', addedOn='2026-09-01'),
                                 dict(rosterPersonId=None, unmatchedSubmitter=True, submitter='שם חסר', name='שם חולה ב', addedOn='2026-09-01')], apply=True)
        with at('2027-04-01'):
            self.store.maintain_healing_prayers()
            rows = self.store.healing_prayers(self.gabbai, all_members=True)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row['reminder'] is None for row in rows))
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM healing_reminder_outbox').fetchone()[0], 0)

    def test_private_push_opens_healing_screen_and_is_cancelled_when_owner_removes_name(self):
        entry = self.add()
        self.store.set_push_token(self.member, 'member-token', dict(token='ExpoPushToken[healing_device_12345]'))
        self.own('2027-01-15')
        payloads = []
        def send(payload):
            payloads.extend(payload)
            return {'data': [{'status': 'ok'} for _ in payload]}
        with at('2027-01-15'):
            self.assertTrue(process_healing_one(self.store, send))
            self.assertFalse(process_healing_one(self.store, send))
        self.assertEqual(len(payloads), 1)
        self.assertEqual(payloads[0]['data'], dict(screen='messages', messageId=message_id(entry['reminder']['cycleId'])))
        self.assertNotIn(entry['name'], json.dumps(payloads, ensure_ascii=False))
        self.assertIn('חלפו שבועיים', payloads[0]['body'])
        self.assertEqual(self.http('DELETE', '/api/healing-prayers/' + entry['id'], token='member-token')[0], 200)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM healing_reminder_outbox').fetchone()[0], 0)

    def test_missing_push_permission_is_retried_and_does_not_hide_in_app_reminder(self):
        self.add()
        self.own('2027-01-15')
        with at('2027-01-15'):
            self.assertTrue(process_healing_one(self.store, lambda payload: self.fail('No push token')))
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT status FROM healing_reminder_outbox').fetchone()[0], 'pending')
            db.execute('UPDATE healing_reminder_outbox SET available_at=0')
        self.store.set_push_token(self.member, 'member-token', dict(token='ExpoPushToken[healing_device_12345]'))
        with at('2027-01-15'):
            self.assertTrue(process_healing_one(self.store, lambda payload: {'data': [{'status': 'ok'}]}))
        self.assertTrue(self.own('2027-01-16')[0]['reminder']['pending'])

    def test_personal_reminder_is_independent_of_community_event_preferences(self):
        self.add()
        preferences = json.loads(self.member['preferences'])
        preferences['events'] = False
        self.store.save_preferences(self.member, preferences)
        self.store.set_push_token(self.member, 'member-token', dict(token='ExpoPushToken[healing_device_12345]'))
        self.own('2027-01-15')
        sent = []
        with at('2027-01-15'):
            process_healing_one(self.store, lambda payload: sent.extend(payload) or {'data': [{'status': 'ok'}]})
        self.assertEqual(len(sent), 1)

    def test_push_retry_and_invalid_token_cleanup_do_not_reset_response_deadline(self):
        self.add()
        self.store.set_push_token(self.member, 'member-token', dict(token='ExpoPushToken[healing_device_12345]'))
        self.own('2027-01-15')
        def failure(_payload):
            raise OSError('Temporary delivery failure')
        with at('2027-01-15'):
            self.assertTrue(process_healing_one(self.store, failure))
        with self.store.db() as db:
            row = db.execute('SELECT * FROM healing_reminder_outbox').fetchone()
            self.assertEqual((row['attempts'], row['status']), (1, 'pending'))
            db.execute('UPDATE healing_reminder_outbox SET available_at=0')
        with at('2027-01-15'):
            process_healing_one(self.store, lambda _payload: {'data': [{'status': 'error', 'details': {'error': 'DeviceNotRegistered'}}]})
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM push_tokens').fetchone()[0], 0)
        self.assertEqual(self.own('2027-01-16')[0]['reminder']['expiresOn'], '2027-02-01')

    def test_reminder_is_a_private_inbox_message_and_never_appears_for_other_users(self):
        entry = self.add()
        with at('2027-01-14'):
            self.assertEqual(self.http('GET', '/api/messages', token='member-token')[1], [])
        with at('2027-01-15'):
            messages = self.http('GET', '/api/messages', token='member-token')[1]
            self.assertEqual(len(messages), 1)
            message = messages[0]
            self.assertEqual(message['id'], message_id(entry['reminder']['cycleId']))
            self.assertEqual(message['kind'], 'healing')
            self.assertIn(entry['name'], message['body'])
            self.assertEqual(message['healing']['prayerId'], entry['id'])
            self.assertEqual(message['healing']['expiresOn'], '2027-02-01')
            self.assertEqual(self.http('GET', '/api/me', token='member-token')[1]['messages'], messages)
            for token in ['other-token', 'gabbai-token']:
                self.assertEqual(self.http('GET', '/api/messages', token=token)[1], [])
                self.assertEqual(self.http('GET', '/api/me', token=token)[1]['messages'], [])
            self.assertEqual(self.store.list_messages(), [])
            self.assertEqual(self.http('POST', '/api/messages/' + message['id'] + '/replies', dict(body='תגובה'), 'member-token')[0], 404)

    def test_private_read_is_owner_scoped_persistent_and_does_not_renew_the_prayer(self):
        entry = self.add()
        identifier = message_id(entry['reminder']['cycleId'])
        path = '/api/messages/' + identifier + '/read'
        with at('2027-01-15'):
            self.assertEqual(self.http('POST', path, {})[0], 401)
            for token in ['other-token', 'gabbai-token']:
                self.assertEqual(self.http('POST', path, {}, token)[0], 404)
            self.assertEqual(self.http('POST', path, {}, 'member-token')[0], 200)
            self.assertEqual(self.http('POST', path, {}, 'member-token')[0], 200)
            state = Store(self.store.path).state(self.member)
            self.assertIn(identifier, state['readIds'])
            prayer = state['healingPrayers'][0]
            self.assertEqual(prayer['addedOn'], '2027-01-01')
            self.assertTrue(prayer['reminder']['pending'])
            self.assertEqual(prayer['reminder']['expiresOn'], '2027-02-01')

    def test_renewal_resolves_old_message_and_next_cycle_has_a_new_unread_message(self):
        entry = self.add()
        old_id = message_id(entry['reminder']['cycleId'])
        with at('2027-01-15'):
            self.http('POST', '/api/messages/' + old_id + '/read', {}, 'member-token')
        with at('2027-01-16'):
            status, kept, _ = self.http('POST', '/api/healing-prayers/' + entry['id'] + '/keep',
                                     dict(cycleId=entry['reminder']['cycleId']), 'member-token')
            self.assertEqual(status, 200)
            state = self.store.state(self.member)
            self.assertEqual(state['messages'], [])
            self.assertNotIn(old_id, state['readIds'])
            self.assertEqual(self.http('POST', '/api/messages/' + old_id + '/read', {}, 'member-token')[0], 404)
        with at('2027-01-30'):
            state = self.store.state(self.member)
            self.assertEqual(state['messages'][0]['id'], message_id(kept['reminder']['cycleId']))
            self.assertNotIn(state['messages'][0]['id'], state['readIds'])

    def test_deleted_or_expired_prayers_remove_private_messages_and_read_state(self):
        entry = self.add()
        identifier = message_id(entry['reminder']['cycleId'])
        with at('2027-01-15'):
            self.http('POST', '/api/messages/' + identifier + '/read', {}, 'member-token')
            self.http('DELETE', '/api/healing-prayers/' + entry['id'], token='member-token')
            state = self.store.state(self.member)
            self.assertEqual(state['messages'], [])
            self.assertNotIn(identifier, state['readIds'])
        entry = self.add('2027-01-16')
        identifier = message_id(entry['reminder']['cycleId'])
        with at('2027-02-16'):
            self.assertEqual(self.http('POST', '/api/messages/' + identifier + '/read', {}, 'member-token')[0], 404)
            self.assertEqual(self.store.state(self.member)['messages'], [])
            with self.store.db() as db:
                self.assertIsNone(db.execute('SELECT id FROM healing_prayers WHERE id=?', (entry['id'],)).fetchone())

    def test_read_state_upgrade_preserves_current_cycles_and_does_not_mark_them_read(self):
        entry = self.add()
        self.own('2027-01-15')
        with self.store.db() as db:
            db.execute('ALTER TABLE healing_cycles DROP COLUMN read_on')
        with at('2027-01-15'):
            state = Store(self.store.path).state(self.member)
        self.assertEqual(state['healingPrayers'][0]['reminder']['cycleId'], entry['reminder']['cycleId'])
        self.assertFalse(state['healingPrayers'][0]['reminder']['read'])
        self.assertNotIn(state['messages'][0]['id'], state['readIds'])


if __name__ == '__main__':
    unittest.main()
