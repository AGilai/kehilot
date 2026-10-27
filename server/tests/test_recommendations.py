from datetime import date, timedelta
import json
import unittest
from unittest.mock import patch

from pyluach import dates, hebrewcal

import test_api as helpers
from server.recommendations import parasha_matches, service_day, service_value, yahrzeit_occurrences


class RecommendationsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls): helpers.CommunityTest.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls): helpers.CommunityTest.tearDownClass.__func__(cls)
    setUp = helpers.CommunityTest.setUp
    tearDown = helpers.CommunityTest.tearDown
    http = helpers.CommunityTest.http
    family_profile = helpers.CommunityTest.family_profile
    family_child = staticmethod(helpers.CommunityTest.family_child)

    def person(self, identifier, tribe='yisrael', classification='א', **changes):
        fields = dict(firstName=identifier, lastName='בדיקה', tribe=tribe, classification=classification)
        fields.update(changes)
        return self.store.save_roster_person(self.gabbai, fields)['id']

    def calls(self, day, people, cancelled=False):
        return self.store.save_aliyah_service(self.gabbai, dict(date=day, reading='בדיקה', service='shacharit', cancelled=cancelled,
            calls=[dict(position=f'ישראל {index+1}', personId=person) for index, person in enumerate(people)]))

    def report(self, day='2026-10-31'):
        return self.store.aliyah_recommendations(self.gabbai, day)

    def section(self, identifier, day='2026-10-31'):
        return next(section['people'] for section in self.report(day)['sections'] if section['id'] == identifier)

    def test_admin_only_calendar_and_reports_validate_dates(self):
        for path in ['/api/admin/aliyah-recommendations', '/api/admin/aliyah-recommendations/calendar?year=5787']:
            self.assertEqual(self.http('GET', path)[0], 401)
            self.assertEqual(self.http('GET', path, token='member-token')[0], 403)
            self.assertEqual(self.http('GET', path, token='gabbai-token')[0], 200)
        for suffix in ['?date=bad', '?date=2026-10-27', '?date=2026-02-30', '?date=2200-01-01']:
            self.assertEqual(self.http('GET', '/api/admin/aliyah-recommendations'+suffix, token='gabbai-token')[0], 400)
        for year in ['bad', '5699', '6000']:
            self.assertEqual(self.http('GET', '/api/admin/aliyah-recommendations/calendar?year='+year, token='gabbai-token')[0], 400)

    def test_upcoming_calendar_has_exact_dates_and_separate_rosh_hashanah_days(self):
        with patch('server.recommendations.israel_today', return_value=date(2026,10,26)):
            calendar = self.store.recommendation_calendar(self.gabbai)
            self.assertEqual(calendar['defaultDate'], '2026-10-31')
            report = self.store.aliyah_recommendations(self.gabbai)
            self.assertEqual(report['service']['title'], 'שבת פרשת וירא - תשפ״ז')
        entries = {entry['date']: entry for entry in calendar['services']}
        self.assertEqual(entries['2026-09-12']['reading'], 'א׳ ראש השנה')
        self.assertEqual(entries['2026-09-13']['reading'], 'ב׳ ראש השנה')
        self.assertEqual(entries['2027-04-22']['reading'], 'א׳ פסח')
        self.assertNotIn('2027-04-23', entries)  # Weekday Chol Hamoed is not Yom Tov.
        self.assertEqual(len({entry['key'] for entry in calendar['services']}), len(calendar['services']))
        self.assertEqual([entry['reading'] for entry in calendar['services'] if entry['date']=='2026-09-21'], ['יום כיפור - שחרית','יום כיפור - מנחה'])
        self.assertTrue(all(service_day(date.fromisoformat(day)) for day in entries))
        with patch('server.recommendations.israel_today', return_value=date(2027,4,21)):
            self.assertEqual(self.store.recommendation_calendar(self.gabbai)['defaultDate'], '2027-04-22')

    def test_limits_and_exact_classification_filters(self):
        groups = [('kohen','kohen','קבוע',17), ('levi','levi','חתן',17), ('israel_a','yisrael','א',27),
                  ('israel_b','yisrael','דור ב',37), ('israel_regular','yisrael','קבוע',12)]
        with self.store.db() as db:
            for group,tribe,classification,total in groups:
                for number in range(total):
                    identifier = f'{group}-{number:02}'
                    db.execute('''INSERT INTO roster_people
                        (id,first_name,last_name,display_name,tribe,classification,created_at,updated_at)
                        VALUES (?,?,?,?,?,?,?,?)''', (identifier,identifier,'בדיקה',identifier,tribe,classification,'2026-01-01','2026-01-01'))
        married = self.person('married', classification='דור ב-נשוי')
        son_in_law = self.person('husband', classification='חתן')
        self.store.add_classification(self.gabbai,dict(name='ותיק'))
        custom = self.person('custom', classification='ותיק')
        report = self.report()
        self.assertEqual([section['title'] for section in report['sections']], ['אירועים','כהנים','לוויים','ישראל','ישראל — דור ב׳','ישראל — קבוע'])
        self.assertEqual([len(section['people']) for section in report['sections'][1:]], [15,15,25,35,10])
        all_ids = {person['id'] for section in report['sections'][1:] for person in section['people']}
        self.assertTrue({married,son_in_law,custom}.isdisjoint(all_ids))

    def test_sort_counts_then_oldest_last_date_and_never_recorded_first(self):
        never = self.person('never', 'kohen')
        old = self.person('old', 'kohen')
        recent = self.person('recent', 'kohen')
        twice = self.person('twice', 'kohen')
        self.calls('2026-08-01',[old,twice])
        self.calls('2026-08-08',[recent,twice])
        self.assertEqual([person['id'] for person in self.section('kohen')], [never,old,recent,twice])
        self.assertEqual([person['aliyahCount'] for person in self.section('kohen')], [0,1,1,2])

    def test_six_twelve_month_windows_anchor_to_selected_date_and_exclude_selected_service(self):
        kohen = self.person('kohen','kohen')
        israel = self.person('israel')
        self.calls('2026-04-25',[kohen,israel])
        self.calls('2026-10-17',[kohen,israel])
        self.calls('2026-10-24',[kohen,israel])  # Exact six-month lower boundary for April 24.
        with patch('server.validation.israel_today',return_value=date(2028,1,1)):
            self.calls('2027-04-17',[kohen,israel],cancelled=True)
            self.calls('2027-04-24',[kohen,israel])
            self.calls('2027-05-01',[kohen,israel])
            self.store.save_aliyah_service(self.gabbai,dict(date='2027-04-10',reading='בדיקה',service='shacharit',calls=[dict(position='כהן',guest=True)]))
        self.assertEqual(self.section('kohen','2027-04-24')[0]['aliyahCount'],1)
        target = next(row for row in self.section('israel_a','2027-04-24') if row['id']==israel)
        self.assertEqual(target['aliyahCount'],3)
        self.assertEqual(target['lastAliyahDate'],'2026-10-24')
        self.assertNotIn(kohen,[row['id'] for row in self.section('kohen','2026-10-31')])

    def test_events_include_day_zero_and_seven_but_not_day_eight_and_preserve_all_events(self):
        yahrzeits = [dict(id=f'y{i}',name=f'קרוב {i}',relationship=relation,day=20+i,month='cheshvan',year='')
                     for i,relation in [(0,'father'),(7,'mother'),(8,'brother')]]
        person = self.person('event',barMitzvahParasha='וירא',torahName='ישראל בן אברהם',wifePrayerName='שרה בת יצחק',yahrzeits=yahrzeits)
        rows = self.section('events')
        row = next(row for row in rows if row['id']==person)
        self.assertEqual([event['kind'] for event in row['events']], ['bar_mitzvah','yahrzeit','yahrzeit'])
        self.assertEqual([event['date'] for event in row['events']], ['2026-10-31','2026-10-31','2026-11-07'])
        self.assertIn('אב',row['events'][1]['description'])
        self.assertIn('אם',row['events'][2]['description'])
        self.assertEqual(row['events'][0]['description'],'בר מצווה')
        self.assertEqual(row['events'][1]['description'],'יארצייט - אב - כ׳ חשוון')
        self.assertEqual(row['events'][2]['description'],'יארצייט - אם - כ״ז חשוון')
        self.assertEqual(row['events'][1]['relativeName'],'קרוב 0')
        self.assertEqual(row['events'][1]['hebrewDate'],'כ׳ חשון תשפ״ז')
        self.assertEqual((row['torahName'],row['wifePrayerName']),('ישראל בן אברהם','שרה בת יצחק'))
        self.assertNotIn(person,[row['id'] for row in self.section('israel_a')])

    def test_combined_parasha_matching_and_spelling_aliases(self):
        self.assertTrue(parasha_matches('תזריע',['תזריע','מצורע']))
        self.assertTrue(parasha_matches('תזריע־מצורע',['תזריע','מצורע']))
        self.assertTrue(parasha_matches('פרשת תזריע-מצורע',['תזריע','מצורע']))
        self.assertTrue(parasha_matches('כי תבוא',['כי תבא']))
        self.assertTrue(parasha_matches('תזריע־מצורע',['מצורע']))
        for first,second in [('ויקהל','פקודי'),('תזריע','מצורע'),('אחרי מות','קדושים'),('בהר','בחוקותי'),('חקת','בלק'),('מטות','מסעי'),('נצבים','וילך')]:
            self.assertTrue(parasha_matches(first+'־'+second,[first]))
            self.assertTrue(parasha_matches(first+'־'+second,[second]))
            self.assertTrue(parasha_matches(first,[first,second]))
            self.assertTrue(parasha_matches(second,[first,second]))
        self.assertTrue(parasha_matches('בהר-בחקתי',['בחוקותי']))
        self.assertTrue(parasha_matches('תזריע-מצרע',['מצורע']))
        self.assertFalse(parasha_matches('וירא',['וארא']))

    def test_yearless_yahrzeits_cross_year_boundary_and_ambiguous_dates_are_flagged(self):
        person = self.person('new-year', yahrzeits=[dict(id='new',name='אם',relationship='mother',day=1,month='tishrei',year='')])
        selected = dates.HebrewDate(5787,6,25).to_pydate()
        while not service_day(selected): selected -= timedelta(days=1)
        report = self.report(selected.isoformat())
        event = next(row for row in report['sections'][0]['people'] if row['id']==person)['events'][0]
        self.assertEqual(event['date'],dates.HebrewDate(5788,7,1).to_pydate().isoformat())
        adar = dict(day=14,month='adar')
        occurrences = yahrzeit_occurrences(adar,5787)
        self.assertEqual([dates.HebrewDate.from_pydate(day).month for day,note in occurrences],[12,13])
        self.assertTrue(all(note for day,note in occurrences))
        short_year = next(year for year in range(5786,5800) if len(hebrewcal.Month(year,8))==29)
        missing = yahrzeit_occurrences(dict(day=30,month='cheshvan'),short_year)
        self.assertEqual([dates.HebrewDate.from_pydate(day).day for day,note in missing],[29,1])
        self.assertTrue(all(note for day,note in missing))

    def test_future_boy_eligibility_uses_permanent_id_without_changing_current_roster(self):
        child = self.family_child('permanent-future-boy',hebrewBirthDate=dict(day=1,month='tishrei',year=5780))
        self.store.save_profile(self.member,self.family_profile([child]))
        self.store.save_roster_person(self.gabbai,dict(classification='א'),self.member_id)
        with self.store.db() as db:
            people_before = [tuple(row) for row in db.execute('SELECT * FROM community_people ORDER BY id')]
            roster_before = [tuple(row) for row in db.execute('SELECT * FROM roster_people ORDER BY id')]
            self.assertIsNone(db.execute('SELECT 1 FROM roster_people WHERE id=?',(child['id'],)).fetchone())
        future = dates.HebrewDate(5793,7,1).to_pydate()
        while not service_day(future): future += timedelta(days=1)
        rows = self.section('israel_b',future.isoformat())
        self.assertIn(child['id'],[row['id'] for row in rows])
        with self.store.db() as db:
            self.assertEqual(people_before,[tuple(row) for row in db.execute('SELECT * FROM community_people ORDER BY id')])
            self.assertEqual(roster_before,[tuple(row) for row in db.execute('SELECT * FROM roster_people ORDER BY id')])
