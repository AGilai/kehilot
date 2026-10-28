from datetime import timedelta
from unittest import mock

from moto import mock_aws

from server.cloud import jobs, push, seat_reminders
from server.tests.cloud import test_seatweek
from server.tests.cloud.test_groups import own_tests_only
from server.tests.cloud.test_seatweek import WEEK, at

REGISTRY = {'pk': 'SEATING', 'sk': 'KEHILOT'}


def fri(hour, minute=0):
    return at(hour, minute)


def thu(hour, minute=0):
    return at(hour, minute) - timedelta(days=1)


@own_tests_only
@mock_aws
class SeatReminderJobTest(test_seatweek.SeatWeekTest):
    def setUp(self):
        super().setUp()
        self.mine((5, 0))
        patcher = mock.patch.object(push, 'send')
        self.send = patcher.start()
        self.addCleanup(patcher.stop)

    def run_at(self, now, **kw):
        return seat_reminders.run(self.repo, now, **kw)

    def refs(self):
        return [c.args for c in self.send.call_args_list]

    def times(self, body):
        status, out = self.call('PUT', f'{self.base()}/admin/seats/times', body=body)
        self.assertEqual(status, 200, out)

    def test_sends_each_once_at_its_time(self):
        self.assertEqual(self.run_at(thu(19, 59))['sent'], [])
        out = self.run_at(thu(20, 4))
        self.assertEqual(out['sent'], [{'kehila': self.k, 'n': '1'}])
        self.assertEqual(out['kehilot'], 1)
        self.assertEqual(self.run_at(thu(20, 9))['sent'], [])
        self.assertEqual(self.run_at(fri(11, 0))['sent'], [{'kehila': self.k, 'n': '2'}])
        self.assertEqual(self.run_at(fri(11, 5))['sent'], [])
        self.assertEqual(self.refs(), [('seat_reminder', self.k, f'{WEEK}#1'), ('seat_reminder', self.k, f'{WEEK}#2')])
        self.assertEqual(self.repo.seat_reminders_sent(self.k, WEEK), {'1', '2'})

    def test_concurrent_runs_send_once(self):
        self.assertTrue(self.repo.claim_seat_reminder(self.k, WEEK, '1', 9999999999))  # "another run" got there first
        with mock.patch.object(self.repo, 'seat_reminders_sent', return_value=set()):  # and our read is stale
            out = self.run_at(thu(20, 4))
        self.assertEqual(out['sent'], [])
        self.send.assert_not_called()
        self.assertFalse(self.repo.claim_seat_reminder(self.k, WEEK, '1', 9999999999))

    def test_missed_runs_catch_up_before_deadline_only(self):
        out = self.run_at(fri(11, 5))
        self.assertEqual([s['n'] for s in out['sent']], ['1', '2'])
        self.send.reset_mock()
        self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': f'SEATREM#{WEEK}#1'})
        self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': f'SEATREM#{WEEK}#2'})
        self.assertEqual(self.run_at(fri(14, 0))['sent'], [])  # the deadline itself is too late
        self.assertEqual(self.run_at(fri(14, 30))['sent'], [])
        self.send.assert_not_called()

    def test_moved_reminder_sent_once(self):
        self.assertEqual(self.run_at(thu(20, 0))['sent'], [{'kehila': self.k, 'n': '1'}])
        self.times({'reminders': {'1': {'day': 'fri', 'time': '09:00'}}})
        self.assertEqual(self.run_at(fri(9, 0))['sent'], [])
        self.times({'reminders': {'2': {'time': '12:00'}}})
        self.assertEqual(self.run_at(fri(11, 0))['sent'], [])
        self.assertEqual(self.run_at(fri(12, 0))['sent'], [{'kehila': self.k, 'n': '2'}])
        self.assertEqual(self.send.call_count, 2)

    def test_off_and_no_layout_send_nothing(self):
        self.times({'reminders': {'1': {'on': False}}})
        self.assertEqual(self.run_at(thu(20, 4))['sent'], [])
        self.assertEqual(self.repo.seat_reminders_sent(self.k, WEEK), set())
        self.times({'reminders': {'1': {'on': True}}})
        self.assertEqual(self.run_at(at(11, 0, '2020-01-03'))['sent'], [])
        self.send.assert_not_called()

    def test_queue_failure_releases_the_claim(self):
        self.send.side_effect = RuntimeError('queue down')
        out = self.run_at(thu(20, 4))
        self.assertEqual(out['sent'], [])
        self.assertEqual(self.repo.seat_reminders_sent(self.k, WEEK), set())
        self.send.side_effect = None
        self.assertEqual(self.run_at(thu(20, 9))['sent'], [{'kehila': self.k, 'n': '1'}])
        self.assertEqual(self.repo.seat_reminders_sent(self.k, WEEK), {'1'})

    def test_registry_backfill_and_layout_save(self):
        self.assertEqual(self.repo.seat_kehila_ids(), [self.k])  # the layout save in setUp registered it
        self.repo.table.delete_item(Key=REGISTRY)  # a layout saved before the registry existed
        self.assertEqual(self.repo.seat_kehila_ids(), [self.k])
        self.assertIs(self.repo.table.get_item(Key=REGISTRY)['Item']['complete'], True)
        late = self.repo.create_kehila('Beit Late', {})
        layout = self.repo.get_layout(self.k, test_seatweek.friday())
        self.repo.put_layout(late, WEEK, {k: layout[k] for k in ('rows', 'cols', 'cells', 'blocks', 'rowLabels')},
                             layout['seats'], None)
        self.assertEqual(self.repo.seat_kehila_ids(), [self.k])  # no second scan: only a save registers it
        self.repo.add_seat_kehila(late)
        self.assertEqual(self.repo.seat_kehila_ids(), sorted([self.k, late]))

    def test_new_layout_save_registers_its_kehila(self):
        self.repo.table.delete_item(Key=REGISTRY)
        self.repo.table.put_item(Item={**REGISTRY, 'complete': True})
        self.assertEqual(self.repo.seat_kehila_ids(), [])
        layout = self.repo.get_layout(self.k, test_seatweek.friday())
        status, out = self.call('PUT', f'{self.base()}/admin/seating/layouts/{WEEK}', body={
            **{k: layout[k] for k in ('rows', 'cols', 'cells', 'blocks', 'rowLabels')}, 'ifUpdatedAt': None})
        self.assertEqual(status, 200, out)
        self.assertEqual(self.repo.seat_kehila_ids(), [self.k])

    def test_dry_run_writes_and_sends_nothing(self):
        with mock.patch.object(jobs, '_repo', return_value=self.repo):
            out = jobs.handler({'job': 'seat_reminders', 'dryRun': True, 'now': f'{thu(20, 5):%Y-%m-%dT%H:%M}'}, None)
        self.assertEqual(out, {'ok': True, 'kehilot': 1, 'sent': [], 'failed': 0,
                               'due': [{'kehila': self.k, 'n': '1',
                                        'recipients': len(seat_reminders.recipients(self.repo, self.k, WEEK))}]})
        self.assertGreaterEqual(out['due'][0]['recipients'], 1)
        self.assertEqual(self.repo.seat_reminders_sent(self.k, WEEK), set())
        self.send.assert_not_called()

    def test_now_override_ignored_without_dry_run(self):
        with mock.patch.object(jobs, '_repo', return_value=self.repo), \
                mock.patch.object(jobs, '_now', return_value=thu(19, 0)):
            out = jobs.handler({'job': 'seat_reminders'}, None)  # no override at all: the real clock decides
            self.assertEqual((out['due'], out['sent']), ([], []))
        self.send.assert_not_called()

    def test_event_is_validated_strictly(self):
        now = f'{thu(20, 5):%Y-%m-%dT%H:%M}'
        with mock.patch.object(jobs, '_repo', return_value=self.repo), \
                mock.patch.object(jobs, '_now', return_value=thu(20, 5)):
            for event in ({'dryRun': 'true'}, {'dryRun': 1}, {'dryRun': False, 'now': now}, {'now': now},
                          {'dryRun': None}, {'dryRun': True, 'now': 5}, {'dryRun': True, 'now': 'tomorrow'}):
                with self.assertRaises(ValueError, msg=event):
                    jobs.handler({'job': 'seat_reminders', **event}, None)
            self.send.assert_not_called()
            self.assertEqual(self.repo.seat_reminders_sent(self.k, WEEK), set())
            self.assertEqual(jobs.handler({'job': 'seat_reminders'}, None)['sent'],
                             [{'kehila': self.k, 'n': '1'}])

    def test_one_kehila_failing_does_not_stop_the_run(self):
        late = self.repo.create_kehila('Beit Late', {})
        self.repo.add_seat_kehila(late)
        real = self.repo.get_kehila
        def flaky(k):
            if k == min(self.k, late):
                raise RuntimeError('throttled')
            return real(k)
        with mock.patch.object(self.repo, 'get_kehila', side_effect=flaky):
            out = self.run_at(thu(20, 4))
        failing = min(self.k, late)
        self.assertEqual(out['sent'], [] if failing == self.k else [{'kehila': self.k, 'n': '1'}])
        self.assertEqual(out['kehilot'], 0 if failing == self.k else 1)
        self.assertEqual(out['failed'], 1)

    def test_dry_run_does_not_write_the_registry(self):
        self.repo.table.delete_item(Key=REGISTRY)
        out = self.run_at(thu(20, 5), dry_run=True)
        self.assertEqual([d['n'] for d in out['due']], ['1'])
        self.assertNotIn('Item', self.repo.table.get_item(Key=REGISTRY))
        self.assertEqual(self.repo.seat_kehila_ids(), [self.k])  # the real run backfills
        self.assertIs(self.repo.table.get_item(Key=REGISTRY)['Item']['complete'], True)

    def test_ref_parsing_and_texts(self):
        self.assertEqual(seat_reminders.parse_ref('2026-11-06#1'), ('2026-11-06', '1'))
        for bad in ('2026-11-06#3', '2026-11-06', 'x#1', '2026-11-06#1\n', '', '2026-11-06#12'):
            self.assertIsNone(seat_reminders.parse_ref(bad), bad)
