from datetime import date, timedelta
import unittest
from unittest.mock import patch

from pyluach import dates

import test_api as helpers
import test_recommendations as report_helpers
from server.hebrew_calendar import hebrew_label
from server.recommendations import year_readings


class RecommendationFiltersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls): helpers.CommunityTest.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls): helpers.CommunityTest.tearDownClass.__func__(cls)
    setUp = helpers.CommunityTest.setUp
    tearDown = helpers.CommunityTest.tearDown
    person = report_helpers.RecommendationsTest.person
    calls = report_helpers.RecommendationsTest.calls
    report = report_helpers.RecommendationsTest.report
    section = report_helpers.RecommendationsTest.section

    def yahrzeit(self, day):
        hebrew = dates.HebrewDate.from_pydate(day)
        keys = {7:'tishrei',8:'cheshvan',9:'kislev',10:'tevet',11:'shevat',12:'adar',13:'adar_ii',1:'nisan',2:'iyar',3:'sivan',4:'tamuz',5:'av',6:'elul'}
        return dict(id='relative',name='אב לדוגמה',relationship='father',day=hebrew.day,month=keys[hebrew.month],year='')

    def event_ids(self, day):
        return {person['id'] for person in self.section('events',day)}

    def test_all_ranked_groups_exclude_upcoming_and_recent_people_before_applying_caps(self):
        selected=date(2026,10,31)
        groups=[('kohen','kohen','קבוע',15),('levi','levi','חתן',15),('israel_a','yisrael','א',25),
                ('israel_b','yisrael','דור ב',35),('israel_regular','yisrael','קבוע',10)]
        for minyan,(section,tribe,classification,cap) in enumerate(groups,1):
            blocked=[self.person(section+'-recent',tribe,classification),
                     self.person(section+'-event',tribe,classification,yahrzeits=[self.yahrzeit(selected)]),
                     self.person(section+'-future',tribe,classification,yahrzeits=[self.yahrzeit(selected+timedelta(days=30))]),
                     self.person(section+'-parasha',tribe,classification,barMitzvahParasha='חיי שרה')]
            self.store.save_aliyah_service(self.gabbai,dict(date='2026-10-24',service='shacharit',minyan=minyan,reading='לך לך',calls=[dict(position='ישראל '+str(index),personId=person) for index,person in enumerate(blocked[:2],1)]))
            with self.store.db() as db:
                for i in range(cap):
                    identifier=f'{section}-eligible-{i}'
                    db.execute('''INSERT INTO roster_people (id,first_name,last_name,display_name,tribe,classification,created_at,updated_at)
                        VALUES (?,?,?,?,?,?,?,?)''',(identifier,identifier,'בדיקה',identifier,tribe,classification,'2026-01-01','2026-01-01'))
            rows=self.section(section)
            self.assertEqual(len(rows),cap)
            self.assertTrue(set(blocked).isdisjoint(person['id'] for person in rows))
            # Recent aliyot never suppress a due event; only ranked tables filter.
            self.assertIn(blocked[1],self.event_ids(selected.isoformat()))

    def test_thirty_day_recent_boundary_and_cancelled_selected_future_calls(self):
        for gap,selected,previous in [(29,'2026-06-20','2026-05-22'),(30,'2026-05-02','2026-04-02'),(31,'2026-05-09','2026-04-08')]:
            person=self.person('boundary-'+str(gap),'kohen')
            self.calls(previous,[person])
            self.assertEqual(person in {row['id'] for row in self.section('kohen',selected)},gap>30)
        person=self.person('ignored-calls','levi')
        self.calls('2026-10-24',[person],cancelled=True)
        with patch('server.validation.israel_today',return_value=date(2027,1,1)):
            self.calls('2026-10-31',[person])
            self.calls('2026-11-07',[person])
        row=next(row for row in self.section('levi') if row['id']==person)
        self.assertEqual(row['aliyahCount'],0)
        self.assertEqual(row['lastAliyah'],'לא נמצא')

    def test_upcoming_thirty_day_yahrzeit_boundaries_and_year_transition(self):
        selected=date(2026,10,31)
        for gap in [0,7,8,29,30,31]:
            person=self.person('future-'+str(gap),yahrzeits=[self.yahrzeit(selected+timedelta(days=gap))])
            self.assertEqual(person in {row['id'] for row in self.section('israel_a')},gap>30)
            self.assertEqual(person in self.event_ids(selected.isoformat()),gap<=7)
        # Last Shabbat of the Hebrew year: a next-year Tishrei yahrzeit is reserved.
        person=self.person('new-year',yahrzeits=[dict(id='rh',name='אם',relationship='mother',day=10,month='tishrei',year='')])
        self.assertNotIn(person,{row['id'] for row in self.section('israel_a','2026-09-05')})

    def test_upcoming_parasha_and_explicit_ceremony_use_selected_date(self):
        # The reading on day 28 is within the horizon; day 35 is outside it.
        inside=self.person('parasha-28',barMitzvahParasha='וישלח')
        outside=self.person('parasha-35',barMitzvahParasha='וישב')
        explicit=self.person('ceremony',barMitzvahDate='2026-11-21')
        rows={row['id'] for row in self.section('israel_a')}
        self.assertTrue({inside,explicit}.isdisjoint(rows))
        self.assertIn(outside,rows)
        # A later report moves the same horizon; it is not anchored to today.
        self.assertNotIn(outside,{row['id'] for row in self.section('israel_a','2026-11-07')})

    def test_last_aliyah_has_hebrew_date_and_reading_from_the_same_latest_record(self):
        person=self.person('last-reading','kohen')
        self.store.save_aliyah_service(self.gabbai,dict(date='2026-08-01',service='shacharit',reading='עקב',calls=[dict(position='כהן',personId=person)]))
        self.store.save_aliyah_service(self.gabbai,dict(date='2026-09-21',service='shacharit',reading='יום כיפור - שחרית',calls=[dict(position='כהן',personId=person)]))
        self.store.save_aliyah_service(self.gabbai,dict(date='2026-09-21',service='mincha',reading='יום כיפור - מנחה',calls=[dict(position='כהן',personId=person)]))
        rows=self.section('kohen')
        row=next(row for row in rows if row['id']==person)
        self.assertEqual(row['lastAliyahDate'],'2026-09-21')
        self.assertEqual(row['lastAliyah'],f"{hebrew_label(date(2026,9,21))} · יום כיפור - מנחה")
        never=self.person('never','levi')
        self.assertEqual(next(row for row in self.section('levi') if row['id']==never)['lastAliyah'],'לא נמצא')

    def test_combined_and_single_birth_parashot_match_combined_reading(self):
        for saved in ['אחרי מות','קדושים','אחרי מות-קדושים']:
            person=self.person(saved,barMitzvahParasha=saved)
            event=next(row for row in self.section('events','2026-04-25') if row['id']==person)['events'][0]
            self.assertNotIn('ניתן להעלות',event['description'])

    def test_split_birth_parasha_first_note_and_second_only_without_first_aliyah(self):
        person=self.person('split',barMitzvahParasha='תזריע-מצורע')
        with patch('server.validation.israel_today',return_value=date(2028,1,1)):
            first=self.section('events','2027-04-10')
            event=next(row for row in first if row['id']==person)['events'][0]
            self.assertIn('ניתן להעלות גם בשבת הבאה',event['description'])
            self.assertIn(person,self.event_ids('2027-04-17'))
            # Any position, prayer or minyan on the first Shabbat satisfies it.
            record=self.store.save_aliyah_service(self.gabbai,dict(date='2027-04-10',service='mincha',minyan=2,reading='תזריע',calls=[dict(position='מפטיר',personId=person)]))
            self.assertNotIn(person,self.event_ids('2027-04-17'))
            # Later history does not retrospectively remove the first reminder.
            self.assertIn(person,self.event_ids('2027-04-10'))
            self.store.save_aliyah_service(self.gabbai,dict(date='2027-04-10',service='mincha',minyan=2,reading='תזריע',cancelled=True,calls=[dict(position='מפטיר',personId=person)]),record['id'])
            self.assertIn(person,self.event_ids('2027-04-17'))

    def test_second_split_shabbat_keeps_a_yahrzeit_after_bar_mitzvah_obligation_is_satisfied(self):
        second=date(2027,4,17)
        person=self.person('split-and-yahrzeit',barMitzvahParasha='אחרי מות-קדושים')
        # A recent aliyah on another Shabbat must not remove the split obligation.
        with patch('server.validation.israel_today',return_value=date(2028,1,1)):
            self.calls('2027-04-24',[person])
        self.assertIn(person,self.event_ids('2027-05-08'))
        self.store.save_roster_person(self.gabbai,dict(barMitzvahParasha='תזריע-מצורע',yahrzeits=[self.yahrzeit(second)]),person)
        with patch('server.validation.israel_today',return_value=date(2028,1,1)):
            self.calls('2027-04-10',[person])
        row=next(row for row in self.section('events',second.isoformat()) if row['id']==person)
        self.assertEqual([event['kind'] for event in row['events']],['yahrzeit'])

    def test_split_pair_across_rosh_hashanah_uses_actual_first_shabbat_not_prior_year(self):
        # Nitzavim is in 5789 and Vayelech in 5790; still one split pair.
        first=next(day for day,parts in year_readings(5789) if parts==('נצבים',))
        second=next(day for day,parts in year_readings(5790) if parts==('וילך',))
        self.assertEqual((second-first).days,7)
        person=self.person('split-new-year',barMitzvahParasha='נצבים־וילך')
        self.assertIn(person,self.event_ids(second.isoformat()))
        with patch('server.validation.israel_today',return_value=date(2030,1,1)):
            self.calls(first.isoformat(),[person])
        self.assertNotIn(person,self.event_ids(second.isoformat()))

    def test_yahrzeit_reservation_uses_selected_community_custom(self):
        # On 13 Adar I 5787, regular Adar day 14 is tomorrow for Ashkenaz,
        # but 31 days ahead in Adar II for Sephardi, outside the reserved horizon.
        selected=dates.HebrewDate(5787,12,13).to_pydate()
        self.assertEqual(selected.weekday(),5)
        person=self.person('custom-reservation',yahrzeits=[dict(id='adar',name='אב',relationship='father',day=14,month='adar',year='')])
        for custom,expected in [('ashkenaz',False),('sephardi',True)]:
            self.store.save_community_settings(self.gabbai,dict(yahrzeitCustom=custom))
            self.assertEqual(person in {row['id'] for row in self.section('israel_a',selected.isoformat())},expected)

    def test_future_filtered_reports_do_not_modify_profiles_roster_or_history(self):
        self.person('unchanged',barMitzvahParasha='תזריע-מצורע',yahrzeits=[self.yahrzeit(date(2027,4,18))])
        with self.store.db() as db:
            before={table:[tuple(row) for row in db.execute('SELECT * FROM '+table+' ORDER BY 1')] for table in ['users','community_people','roster_people','aliyah_services','aliyah_calls']}
        self.report('2027-04-10')
        self.report('2027-04-17')
        with self.store.db() as db:
            for table,rows in before.items():self.assertEqual(rows,[tuple(row) for row in db.execute('SELECT * FROM '+table+' ORDER BY 1')])
