import unittest

from server.cloud import seat_times, seating_week
from server.cloud.errors import ApiError


class SeatTimesTest(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual(seating_week.DEFAULT_DEADLINE, '14:00')
        self.assertEqual(seat_times.deadline_hm({}), '14:00')
        self.assertEqual(seat_times.deadline_hm({'seatDeadline': '12:00'}), '12:00')  # a saved value is kept
        self.assertEqual(seat_times.reminders_of(None), seat_times.DEFAULT_REMINDERS)

    def test_chain(self):
        r = seat_times.reminders_of(None)
        seat_times.check(r, '14:00', 'reminders.1')                                   # defaults pass
        for n, day, time in (('1', 'thu', '08:15'), ('2', 'fri', '13:45'), ('1', 'fri', '11:00')):
            bad = {**r, n: {**r[n], 'day': day, 'time': time}}
            with self.assertRaises(ApiError) as e:
                seat_times.check(bad, '14:00', f'reminders.{n}')
            self.assertEqual((e.exception.code, e.exception.field), ('seat_times_order', f'reminders.{n}'))
        seat_times.check({**r, '1': {**r['1'], 'time': '08:30'}}, '14:00', 'reminders.1')  # exactly 30 min after opening
        with self.assertRaises(ApiError) as e:
            seat_times.check(r, '11:15', 'deadline')
        self.assertEqual((e.exception.code, e.exception.field), ('seat_reminder_after_deadline', 'reminders.2'))
        off = {**r, '2': {**r['2'], 'on': False}}
        seat_times.check(off, '11:15', 'deadline')                                  # an off reminder leaves the chain

    def test_parse_reminders(self):
        cur = seat_times.DEFAULT_REMINDERS
        self.assertEqual(seat_times.parse_reminders({'2': {'on': False}}, cur)['2'], {'on': False, 'day': 'fri', 'time': '11:00'})
        for bad in ({'3': {}}, {'1': {'day': 'sun'}}, {'1': {'time': '20:10'}}, {'1': {'on': 1}}, {'1': {'x': 1}}, [], {'1': None}):
            with self.assertRaises(ApiError) as e:
                seat_times.parse_reminders(bad, cur)
            self.assertEqual(e.exception.code, 'invalid_seat_reminders')

    def test_instants_and_dst(self):
        self.assertEqual(seat_times.instant('2026-10-30', 'thu', '20:00').isoformat(), '2026-10-29T20:00:00+02:00')
        self.assertEqual(seat_times.instant('2027-03-26', 'fri', '11:00').isoformat(), '2027-03-26T11:00:00+03:00')  # DST starts that Friday 02:00

    def test_due(self):
        r = seat_times.DEFAULT_REMINDERS
        at = lambda d, hm: seat_times.instant('2026-10-30', d, hm)
        self.assertEqual(seat_times.due(at('thu', '19:59'), '2026-10-30', r, '14:00'), [])
        self.assertEqual(seat_times.due(at('thu', '20:04'), '2026-10-30', r, '14:00'), ['1'])
        self.assertEqual(seat_times.due(at('fri', '11:00'), '2026-10-30', r, '14:00'), ['1', '2'])
        self.assertEqual(seat_times.due(at('fri', '14:00'), '2026-10-30', r, '14:00'), [])   # at the deadline: nothing


if __name__ == '__main__':
    unittest.main()
