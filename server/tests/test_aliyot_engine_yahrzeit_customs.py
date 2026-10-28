# Ported from origin/main 6d74d0e server/tests/test_yahrzeit_customs.py
from datetime import timedelta
import copy
import unittest

from pyluach import dates, hebrewcal

from aliyot_engine_helpers import EngineCase
from server.cloud.aliyot.engine import person_events, service_value, yahrzeit_occurrences


class YahrzeitCustomTest(EngineCase):
    def item(self, month, day=30):
        return dict(id='relative', name='אב לדוגמה', relationship='father', month=month, day=day, year='')

    def test_regular_adar_in_leap_year_uses_first_for_ashkenaz_second_for_sephardi(self):
        original=self.item('adar',14)
        before=copy.deepcopy(original)
        for custom,month in [('ashkenaz',12),('sephardi',13)]:
            observed=yahrzeit_occurrences(original,5787,custom)
            self.assertEqual(observed,[(dates.HebrewDate(5787,month,14).to_pydate(),'')])
        self.assertEqual(original,before)

    def test_explicit_adars_keep_their_month_in_leap_year_and_both_map_to_adar_in_regular_year(self):
        for custom in ['ashkenaz','sephardi']:
            for saved,month in [('adar_i',12),('adar_ii',13)]:
                self.assertEqual(yahrzeit_occurrences(self.item(saved,14),5787,custom),[(dates.HebrewDate(5787,month,14).to_pydate(),'')])
                self.assertEqual(yahrzeit_occurrences(self.item(saved,14),5788,custom),[(dates.HebrewDate(5788,12,14).to_pydate(),'')])
            self.assertEqual(yahrzeit_occurrences(self.item('adar',14),5788,custom),[(dates.HebrewDate(5788,12,14).to_pydate(),'')])

    def test_sephardi_missing_thirtieth_moves_only_to_next_first_and_existing_thirtieth_stays(self):
        for key,month in [('cheshvan',8),('kislev',9)]:
            for length in [29,30]:
                year=next(year for year in range(5780,5798) if len(hebrewcal.Month(year,month))==length)
                expected=dates.HebrewDate(year,month,30) if length==30 else dates.HebrewDate(year,month+1,1)
                self.assertEqual(yahrzeit_occurrences(self.item(key),year,'sephardi'),[(expected.to_pydate(),'')])

    def test_ashkenaz_checks_two_dates_only_when_the_thirtieth_is_missing(self):
        for key,month in [('cheshvan',8),('kislev',9)]:
            for length in [29,30]:
                year=next(year for year in range(5780,5798) if len(hebrewcal.Month(year,month))==length)
                observed=yahrzeit_occurrences(self.item(key),year,'ashkenaz')
                if length==30:
                    self.assertEqual(observed,[(dates.HebrewDate(year,month,30).to_pydate(),'')])
                else:
                    self.assertEqual([day for day,note in observed],[dates.HebrewDate(year,month,29).to_pydate(),dates.HebrewDate(year,month+1,1).to_pydate()])
                    self.assertTrue(all('יש לבדוק עם המתפלל כיצד הוא נוהג' in note for day,note in observed))

    def test_chesshvan_shabbat_twenty_second_and_twenty_ninth_both_show_original_date_and_reminder(self):
        person=self.person('two-shabbatot',yahrzeits=[self.item('cheshvan')])
        self.custom='ashkenaz'
        # The double-Shabbat rule applies only to a short Cheshvan.
        for year in [5789]:
            for day in [22,29]:
                selected=dates.HebrewDate(year,8,day).to_pydate()
                self.assertEqual(selected.weekday(),5)
                report=self.report(selected.isoformat())
                row=next(row for row in report['sections'][0]['people'] if row['id']==person)
                self.assertEqual(report['yahrzeitCustom'],'ashkenaz')
                self.assertEqual(len(row['events']),1 if day==22 else 2)
                for event in row['events']:
                    self.assertEqual((event['recordedDay'],event['recordedMonth'],event['recordedHebrewDate']),(30,'cheshvan','ל׳ חשוון'))
                    self.assertTrue(event['needsReview'])
                    self.assertIn('תאריך הפטירה: ל׳ חשוון',event['description'])
                    self.assertIn('יש לבדוק עם המתפלל כיצד הוא נוהג',event['description'])
                self.assertTrue(any('אשכנז' in note for note in report['notes']))

    def test_kislev_report_windows_keep_both_bounds_and_original_death_date(self):
        row=dict(bar_mitzvah_parasha='',bar_mitzvah_date='',yahrzeits=[self.item('kislev')])
        for year in [year for year in range(5780,5798) if len(hebrewcal.Month(year,9))==29][:2]:
            for day in [22,29]:
                selected=dates.HebrewDate(year,9,day).to_pydate()
                events=person_events(row,selected,service_value(selected),'ashkenaz')
                self.assertEqual(len(events),1 if day==22 else 2)
                for event in events:
                    self.assertEqual(event['recordedHebrewDate'],'ל׳ כסלו')
                    self.assertIn('תאריך הפטירה: ל׳ כסלו',event['description'])
                    self.assertTrue(event['needsReview'])

    def test_changing_custom_changes_reports_immediately_without_changing_person(self):
        person=self.person('adar-rule',yahrzeits=[self.item('adar',14)])
        for custom,month,other in [('ashkenaz',12,13),('sephardi',13,12)]:
            self.custom=custom
            observed=dates.HebrewDate(5787,month,14).to_pydate()
            selected=observed-timedelta(days=(observed.weekday()-5)%7)
            report=self.report(selected.isoformat())
            row=next(row for row in report['sections'][0]['people'] if row['id']==person)
            self.assertEqual([event['date'] for event in row['events']],[observed.isoformat()])
            self.assertFalse(row['events'][0]['needsReview'])
            other_day=dates.HebrewDate(5787,other,14).to_pydate()
            other_service=other_day-timedelta(days=(other_day.weekday()-5)%7)
            self.assertNotIn(person,[row['id'] for row in self.section('events',other_service.isoformat())])

    def test_full_cheshvan_uses_only_actual_thirtieth_in_both_customs(self):
        person=self.person('actual-thirty',yahrzeits=[self.item('cheshvan')])
        for custom in ['ashkenaz','sephardi']:
            self.custom=custom
            self.assertNotIn(person,[row['id'] for row in self.section('events','2024-11-23')])
            row=next(row for row in self.section('events','2024-11-30') if row['id']==person)
            self.assertEqual([event['date'] for event in row['events']],['2024-12-01'])
            self.assertFalse(row['events'][0]['needsReview'])

    def test_existing_thirtieth_requires_actual_date_inside_inclusive_seven_day_window(self):
        for custom in ['ashkenaz','sephardi']:
            for key,month in [('cheshvan',8),('kislev',9)]:
                year=next(year for year in range(5780,5798) if len(hebrewcal.Month(year,month))==30)
                observed=dates.HebrewDate(year,month,30).to_pydate()
                row=dict(bar_mitzvah_parasha='',bar_mitzvah_date='',yahrzeits=[self.item(key)])
                for distance in [-1,0,1,6,7,8]:
                    selected=observed-timedelta(days=distance)
                    events=person_events(row,selected,service_value(selected),custom)
                    self.assertEqual(bool(events),0<=distance<=7,(custom,key,distance))
                    if events:
                        self.assertEqual([event['date'] for event in events],[observed.isoformat()])
                        self.assertFalse(events[0]['needsReview'])


if __name__ == '__main__':
    unittest.main()
