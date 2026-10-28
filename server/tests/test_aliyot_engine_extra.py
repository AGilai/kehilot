# New tests (not ported): the pure replacements for upstream's SQL history query and `_refresh_roster` projection.
from datetime import date
import copy
import unittest

from aliyot_engine_helpers import EngineCase
from server.cloud.aliyot.engine import project_people, service_statistics
from server.validation import APIError


class EngineExtraTest(EngineCase):
    def test_last_reading_uses_recency_ordering_mincha_then_minyan_then_id_then_position(self):
        who = 'p'
        self.service('2026-09-01', [dict(position='ב', personId=who)], reading='second-minyan', minyan=2)
        self.service('2026-09-01', [dict(position='ב', personId=who), dict(position='א', personId=who)], reading='first-minyan', minyan=1)
        stat = service_statistics(self.services, date(2026, 10, 31))[who]
        self.assertEqual((stat['last_reading'], stat['last_date'], stat['twelve']), ('first-minyan', '2026-09-01', 3))
        self.service('2026-09-01', [dict(position='כהן', personId=who)], reading='afternoon', service='mincha')
        self.assertEqual(service_statistics(self.services, date(2026, 10, 31))[who]['last_reading'], 'afternoon')

    def test_windows_recent_dates_and_cancelled_or_guest_calls(self):
        self.calls('2026-04-29', ['p'])   # Before the six-month bound for 2026-10-31, inside twelve months.
        self.calls('2026-09-05', ['p'])   # Inside 60 days.
        self.calls('2026-08-01', ['p'], cancelled=True)
        self.service('2026-10-24', [dict(position='כהן', personId=None)])
        stat = service_statistics(self.services, date(2026, 10, 31))
        self.assertEqual(list(stat), ['p'])
        self.assertEqual((stat['p']['six'], stat['p']['twelve']), (1, 2))
        self.assertEqual(stat['p']['recent_dates'], frozenset({'2026-09-05'}))

    def test_mincha_includes_same_day_shacharit_only(self):
        self.service('2026-09-21', [dict(position='ישראל 1', personId='p')], reading='שחרית')
        self.service('2026-09-21', [dict(position='ישראל 1', personId='p')], reading='מנחה', service='mincha')
        self.assertNotIn('p', service_statistics(self.services, date(2026, 9, 21)))
        stat = service_statistics(self.services, date(2026, 9, 21), 'mincha')['p']
        self.assertEqual((stat['twelve'], stat['last_reading']), (1, 'שחרית'))

    def test_project_people_eligibility_and_purity(self):
        people = [dict(id='boy', hebrew_birth_date=dict(day=1, month='tishrei', year=5780), active=False),
                  dict(id='explicit', eligible_from='2027-01-01', active=True),
                  dict(id='plain', active=True), dict(id='archived', eligible_from=None, active=False,
                                                       hebrew_birth_date=dict(day=1, month='tishrei', year=5780))]
        before = copy.deepcopy(people)
        now = {row['id']: row['active'] for row in project_people(people, date(2026, 10, 31))}
        later = {row['id']: row['active'] for row in project_people(people, date(2032, 10, 3))}
        self.assertEqual(now, dict(boy=False, explicit=False, plain=True, archived=False))
        self.assertEqual(later, dict(boy=True, explicit=True, plain=True, archived=False))
        self.assertEqual(people, before)

    def test_inactive_people_are_not_reported_and_custom_is_validated(self):
        self.person('gone')
        self.update('gone', active=False)
        self.assertEqual(self.section('israel_a'), [])
        self.custom = 'other'
        with self.assertRaises(APIError):
            self.report()


if __name__ == '__main__':
    unittest.main()
