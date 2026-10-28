import json
from unittest import mock

from moto import mock_aws

from server.cloud import handler as handler_module, routes_seatweek, seat_times, seating_rules as rules
from server.tests.cloud import test_seatweek
from server.tests.cloud.test_groups import own_tests_only
from server.tests.cloud.test_handler import Context, event

DEFAULTS = {'opens': {'day': 'thu', 'time': '08:00'},
            'reminders': {'1': {'on': True, 'day': 'thu', 'time': '20:00'},
                          '2': {'on': True, 'day': 'fri', 'time': '11:00'}},
            'deadline': '14:00'}


@own_tests_only
@mock_aws
class SeatTimesApiTest(test_seatweek.SeatWeekTest):
    def path(self):
        return f'{self.base()}/admin/seats/times'

    def times(self, body=None, sub='gabbai-sub'):
        return self.call('PUT' if body is not None else 'GET', self.path(), sub=sub, body=body)

    def test_get_defaults(self):
        self.mine((5, 1))
        self.give(f'family:{self.other}', (5, 3))
        status, out = self.times()
        self.assertEqual(status, 200, out)
        week = rules.current_shabbat(routes_seatweek._now().date()).isoformat()
        self.assertEqual(out, {**DEFAULTS, 'week': week, 'layout': True, 'pending': 2,
                               'sent': {'1': False, '2': False}})

    def test_get_without_layout(self):
        self.mine((5, 1))
        with self.now(test_seatweek.at(9, 0, '2020-01-03')):
            status, out = self.times()
        self.assertEqual(status, 200, out)
        self.assertEqual((out['layout'], out['pending']), (False, None))

    def test_member_forbidden(self):
        self.assertEqual(self.times(sub='member-sub')[0], 403)
        self.assertEqual(self.times({'deadline': '15:00'}, sub='member-sub')[0], 403)

    def test_tech_allowed(self):
        self.assertEqual(self.times(sub=self.tech_sub())[0], 200)

    def test_put_reminder_and_order_error(self):
        self.assertEqual(self.times({'reminders': {'1': {'time': '08:15'}}}),
                         (400, {'error': 'seat_times_order', 'field': 'reminders.1'}))
        status, out = self.times({'reminders': {'2': {'on': False}}})
        self.assertEqual(status, 200, out)
        self.assertIs(out['reminders']['2']['on'], False)
        self.assertIs(self.times()[1]['reminders']['2']['on'], False)

    def test_put_body_shape(self):
        for body in ({}, {'foo': 1}, {'deadline': '15:00', 'foo': 1}):
            self.assertEqual(self.times(body), (400, {'error': 'invalid_body'}))
        self.assertEqual(self.times({'deadline': '25:00'})[0], 400)

    def test_deadline_cannot_pass_reminder(self):
        err = (400, {'error': 'seat_reminder_after_deadline', 'field': 'reminders.2'})
        self.assertEqual(self.times({'deadline': '11:15'}), err)
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/settings', body={'seatDeadline': '11:15'}), err)
        self.assertEqual(self.times({'reminders': {'2': {'on': False}}})[0], 200)
        self.assertEqual(self.times({'deadline': '11:15'})[0], 200)
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/settings', body={'seatDeadline': '11:30'})[0], 200)

    def test_saved_deadline_reaches_member(self):
        self.mine((5, 1))
        self.assertEqual(self.times({'deadline': '16:00'})[0], 200)
        self.assertIn('T16:00', self.me()[1]['deadline'])

    def test_listener_other_kehila_and_anonymous(self):
        self.assertEqual(self.times(sub='listener-sub')[0], 403)
        self.assertEqual(self.times({'deadline': '15:00'}, sub='listener-sub')[0], 403)
        other = self.repo.create_kehila('Other', {})
        status, _ = self.call('GET', f'/v1/kehilot/{other}/admin/seats/times')
        self.assertIn(status, (403, 404))
        self.assertEqual(self.call('GET', f'/v1/kehilot/{"0" * 26}/admin/seats/times')[0], 404)
        # Anonymous callers never reach the Lambda: the API Gateway JWT authorizer rejects them (no handler-level 401).
        evt = event('GET', self.path())
        del evt['requestContext']['authorizer']
        self.assertNotEqual(handler_module.handler(evt, Context())['statusCode'], 200)

    def test_sent_marker(self):
        self.repo.table.put_item(Item={'pk': f'K#{self.k}', 'sk': f'SEATREM#{self.times()[1]["week"]}#2'})
        self.assertEqual(self.times()[1]['sent'], {'1': False, '2': True})

    def test_rejected_put_keeps_stored_values(self):
        self.assertEqual(self.times({'deadline': '11:15'})[0], 400)
        self.assertEqual(self.times()[1]['deadline'], '14:00')
        self.assertEqual(self.times({'reminders': {'1': {'day': 'fri', 'time': '12:00'}}}),
                         (400, {'error': 'seat_times_order', 'field': 'reminders.1'}))

    def race(self, other_body_call):
        """Run `other_body_call` after PUT's check, before its write."""
        real, fired = seat_times.check, []

        def check(*args):
            real(*args)
            if not fired:
                fired.append(1)
                other_body_call()
        return mock.patch.object(seat_times, 'check', side_effect=check)

    def test_concurrent_reminder_and_deadline_conflict(self):
        with self.race(lambda: self.repo.set_settings(self.k, seat_deadline='12:15')):
            status, out = self.times({'reminders': {'2': {'time': '12:00'}}})
        self.assertEqual((status, out), (409, {'error': 'try_again'}))
        settings = self.repo.get_kehila(self.k)['settings']
        self.assertNotIn('seatReminders', settings)
        seat_times.check(seat_times.reminders_of(settings), seat_times.deadline_hm(settings), 'deadline')

    def test_concurrent_deadline_vs_reminder_conflict(self):
        later = {'1': {'on': True, 'day': 'thu', 'time': '20:00'}, '2': {'on': True, 'day': 'fri', 'time': '13:00'}}
        for route in ('times', 'settings'):
            with self.race(lambda: self.repo.set_settings(self.k, seat_reminders=later)):
                if route == 'times':
                    status, out = self.times({'deadline': '13:30'})
                else:
                    status, out = self.call('PUT', f'{self.base()}/admin/settings', body={'seatDeadline': '13:30'})
            self.assertEqual((status, out), (409, {'error': 'try_again'}), route)
            settings = self.repo.get_kehila(self.k)['settings']
            self.assertNotEqual(settings.get('seatDeadline'), '13:30')
            seat_times.check(seat_times.reminders_of(settings), seat_times.deadline_hm(settings), 'deadline')
            self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': 'META'}, UpdateExpression='REMOVE settings.seatReminders')
