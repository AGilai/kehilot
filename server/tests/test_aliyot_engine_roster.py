# Ported from origin/main 6d74d0e server/tests/test_roster.py (the `_refresh_roster` eligibility/classification tests;
# family tree, sqlite, HTTP and service-save checks are replaced by `kind`-tagged plain people).
from datetime import date
import copy
import unittest

from pyluach import dates

from aliyot_engine_helpers import EngineCase
from server.cloud.aliyot.engine import project_people, service_statistics
from server.hebrew_calendar import birth_date, bar_mitzvah_date, months_before

SOON = date(2026, 10, 25)


def son(identifier, **changes):
    return {**dict(id=identifier, kind='son', first_name='', last_name='', display_name='ילד לדוגמה', tribe='', classification='',
                   hebrew_birth_date=None, father_tribe='yisrael', father_classification='א', married=False), **changes}


def by_id(rows):
    return {row['id']: row for row in rows}


class RosterProjectionTest(EngineCase):
    def test_son_enters_roster_on_thirteenth_hebrew_birthday_with_same_id(self):
        boy = son('permanent-son', hebrew_birth_date=dict(year=5774, month='cheshvan', day=14), father_tribe='levi')
        before = copy.deepcopy(boy)
        self.assertFalse(by_id(project_people([boy], date(2026, 10, 24)))['permanent-son']['active'])
        roster = by_id(project_people([boy], SOON))
        self.assertTrue(roster[boy['id']]['active'])
        self.assertEqual(roster[boy['id']]['eligible_from'], '2026-10-25')
        self.assertEqual(roster[boy['id']]['tribe'], 'levi')
        self.assertEqual(boy, before)  # Projection never changes the input, so the identity is permanent.
        self.assertEqual(list(roster), ['permanent-son'])

    def test_son_classification_tracks_membership_and_marriage(self):
        boy = son('adult-son', hebrew_birth_date=dict(year=5765, month='tishrei', day=1))
        self.assertEqual(by_id(project_people([boy], SOON))['adult-son']['classification'], 'דור ב')
        boy.update(married=True, spouse_prayer_name='שם האישה לתפילה')
        row = by_id(project_people([boy], SOON))['adult-son']
        self.assertEqual(row['classification'], 'דור ב-נשוי')
        self.assertEqual(row['wife_prayer_name'], 'שם האישה לתפילה')
        boy.update(father_classification='קבוע')
        self.assertEqual(by_id(project_people([boy], SOON))['adult-son']['classification'], 'קבוע')
        boy.update(father_classification='')
        self.assertEqual(by_id(project_people([boy], SOON))['adult-son']['classification'], '')
        boy.update(father_classification='א', classification_override='ותיק')
        self.assertEqual(by_id(project_people([boy], SOON))['adult-son']['classification'], 'ותיק')

    def test_missing_birth_year_never_promotes_a_son(self):
        boy = son('unknown-age', hebrew_birth_date=dict(day=1, month='tishrei'))
        self.assertFalse(by_id(project_people([boy], SOON))['unknown-age']['active'])
        self.assertIsNone(bar_mitzvah_date(dict(day=1, month='tishrei'), SOON))
        # Reviewer's failing input: the engine itself must not list him.
        member = dict(id='unknown-age', first_name='בן', last_name='בדיקה', tribe='yisrael', classification='דור ב',
                      hebrew_birth_date=dict(day=1, month='tishrei'), kind='son')
        from server.cloud.aliyot.engine import recommendations
        report = recommendations([member], [], selected=date(2026, 10, 31), today=date(2026, 10, 26))
        self.assertNotIn('unknown-age', [p['id'] for s in report['sections'] for p in s['people']])
        # A self member in the same situation is active.
        self.assertTrue(project_people([dict(id='m', kind='self', hebrew_birth_date=dict(day=1, month='tishrei'))], SOON)[0]['active'])

    def test_known_underage_independent_person_waits_for_hebrew_birthday(self):
        person = dict(id='independent', hebrew_birth_date=dict(year=5780, month='tishrei', day=1))
        self.assertFalse(project_people([person], SOON)[0]['active'])
        eligible = date.fromisoformat(project_people([person], SOON)[0]['eligible_from'])
        self.assertTrue(project_people([person], eligible)[0]['active'])

    def test_standalone_son_in_law_has_person_identity_without_an_account(self):
        # Only the roster-projection part: classification from the household and activity from the daughter.
        husband = dict(id='husband', kind='son_in_law', display_name='חתן', tribe='kohen', classification='',
                       household_classification='א', daughter_active=True, daughter_married=True,
                       hebrew_birth_date=dict(year=5750, month='tishrei', day=1))
        row = project_people([husband], SOON)[0]
        self.assertEqual((row['id'], row['classification'], row['active']), ('husband', 'חתן', True))
        self.assertEqual(project_people([{**husband, 'household_classification': 'קבוע'}], SOON)[0]['classification'], 'קבוע')
        self.assertEqual(project_people([{**husband, 'household_classification': '', 'classification': 'ישן'}], SOON)[0]['classification'], 'ישן')
        self.assertEqual(project_people([{**husband, 'classification_override': 'ותיק'}], SOON)[0]['classification'], 'ותיק')

    def test_son_in_law_is_active_only_when_daughter_is_active_married_and_he_is_eligible(self):
        # Reviewer's failing input: a flagged-inactive husband with an old eligibility date must stay inactive.
        old = dict(id='husband', kind='son_in_law', display_name='חתן', tribe='yisrael', classification='חתן',
                   eligible_from='2020-01-01', active=False)
        self.assertFalse(project_people([old], date(2026, 10, 31))[0]['active'])
        base = {**old, 'daughter_active': True, 'daughter_married': True, 'active': False}
        self.assertTrue(project_people([base], date(2026, 10, 31))[0]['active'])
        for change in [dict(daughter_active=False), dict(daughter_married=False), dict(display_name=''), dict(eligible_from='2030-01-01')]:
            self.assertFalse(project_people([{**base, **change}], date(2026, 10, 31))[0]['active'], change)
        self.assertTrue(project_people([{**base, 'eligible_from': None}], date(2026, 10, 31))[0]['active'])

    def test_source_rows_are_inactive_when_their_family_record_is(self):
        row = dict(id='m', kind='self', source_active=False, eligible_from='2020-01-01')
        self.assertFalse(project_people([row], SOON)[0]['active'])
        self.assertTrue(project_people([{**row, 'source_active': True}], SOON)[0]['active'])
        self.assertFalse(project_people([{**row, 'source_active': True, 'eligible_from': '2027-01-01'}], SOON)[0]['active'])

    def test_gabbai_self_defaults_to_association_classification(self):
        self.assertEqual(project_people([dict(id='g', kind='self', classification='', is_gabbai=True)], SOON)[0]['classification'], 'א')
        self.assertEqual(project_people([dict(id='g', kind='self', classification='קבוע', is_gabbai=True)], SOON)[0]['classification'], 'קבוע')

    def test_gregorian_month_end_and_no_new_year_reset(self):
        self.assertEqual(months_before(date(2026, 8, 31), 6), date(2026, 2, 28))
        self.assertEqual(months_before(date(2024, 2, 29), 12), date(2023, 2, 28))
        self.service('2025-12-27', [dict(position='1', personId='k')])
        self.assertEqual(service_statistics(self.services, date(2026, 1, 1))['k']['six'], 1)

    def test_server_calendar_validation_and_bar_mitzvah_edge_cases(self):
        today = date(2026, 10, 25)
        for birthday in [dict(day=30, month='cheshvan', year=5784), dict(day=30, month='kislev', year=5784),
                         dict(day=1, month='adar', year=5784), dict(day=1, month='adar_i', year=5783),
                         dict(day=1, month='adar_ii', year=5783), dict(day=1, month='tishrei', year=5699),
                         dict(day=15, month='cheshvan', year=5787), dict(day=True, month='nisan', year=5783)]:
            with self.assertRaises(ValueError, msg=str(birthday)):
                birth_date(birthday, today)
        for birthday in [dict(day=30, month='cheshvan', year=5783), dict(day=30, month='kislev', year=5783)]:
            self.assertIsNotNone(birth_date(birthday, today))
        # A common-year Adar birth reaches 13 in Adar II of a leap year.
        result = bar_mitzvah_date(dict(year=5777, month='adar', day=10), today)
        self.assertEqual(dates.HebrewDate.from_pydate(result), dates.HebrewDate(5790, 13, 10))
        result = bar_mitzvah_date(dict(year=5776, month='adar_i', day=30), today)
        self.assertEqual(dates.HebrewDate.from_pydate(result), dates.HebrewDate(5789, 1, 1))

    def test_today_is_required_and_year_range_always_checked(self):
        from server.cloud.aliyot.engine import recommendations
        from server.validation import APIError
        with self.assertRaises(TypeError):
            recommendations([], [], selected=date(2026, 10, 31))
        with self.assertRaises(APIError):
            recommendations([], [], selected=date(2200, 1, 4), today=date(2026, 10, 26))

    def test_eligible_from_dates_are_accepted(self):
        row = project_people([dict(id='d', eligible_from=date(2020, 1, 1))], SOON)[0]
        self.assertTrue(row['active'])


if __name__ == '__main__':
    unittest.main()
