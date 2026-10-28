from server.cloud import routes_seatweek, seating_rules as rules
from server.tests.cloud import test_seatweek

DEFAULTS = {'opens': {'day': 'thu', 'time': '08:00'},
            'reminders': {'1': {'on': True, 'day': 'thu', 'time': '20:00'},
                          '2': {'on': True, 'day': 'fri', 'time': '11:00'}},
            'deadline': '14:00'}


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
