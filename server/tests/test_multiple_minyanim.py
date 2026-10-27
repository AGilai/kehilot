from datetime import date
import copy
import sqlite3
import unittest

import test_api as helpers
from server.gabbai import aliyah_template
from server.store import Store


class MultipleMinyanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls): helpers.CommunityTest.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls): helpers.CommunityTest.tearDownClass.__func__(cls)
    setUp = helpers.CommunityTest.setUp
    tearDown = helpers.CommunityTest.tearDown
    http = helpers.CommunityTest.http
    family_profile = helpers.CommunityTest.family_profile

    def calls(self, day='2026-10-24', service='shacharit'):
        return [dict(position=slot['position'],guest=True) for slot in aliyah_template(date.fromisoformat(day),service)['slots']]

    def test_two_minyanim_are_separate_and_both_count_without_duplicate_in_same_minyan(self):
        self.store.save_profile(self.member,self.family_profile([]))
        calls=self.calls();calls[2]=dict(position='ישראל 1',personId=self.member_id)
        body=dict(date='2026-10-24',reading='לך לך',calls=calls)
        first=self.http('POST','/api/admin/aliyah-records',body,'gabbai-token')
        second=self.http('POST','/api/admin/aliyah-records',{**body,'minyan':2},'gabbai-token')
        self.assertEqual((first[0],second[0]),(201,201))
        self.assertNotEqual(first[1]['id'],second[1]['id'])
        self.assertEqual((first[1]['minyan'],second[1]['minyan']),(1,2))
        self.assertEqual(self.http('POST','/api/admin/aliyah-records',body,'gabbai-token')[0],409)
        self.assertEqual(self.http('PUT','/api/admin/aliyah-records/'+second[1]['id'],body,'gabbai-token')[1]['minyan'],2)
        person=next(row for row in self.store.roster(self.gabbai) if row['id']==self.member_id)
        self.assertEqual(person['aliyahCount'],2)
        for value in [0,True,1.5,'2',1001]:
            self.assertEqual(self.http('POST','/api/admin/aliyah-records',{**body,'minyan':value},'gabbai-token')[0],400)

    def test_old_schema_upgrade_preserves_history_guests_people_and_foreign_keys(self):
        original=self.store.save_aliyah_service(self.gabbai,dict(date='2026-10-24',service='shacharit',reading='לך לך',calls=[dict(position='ישראל 1',personId=self.member_id),dict(position='מפטיר',guest=True)]))
        with sqlite3.connect(self.store.path) as db:
            services=db.execute('SELECT id,service_date,service,reading,cancelled,recorded_by,created_at,updated_at FROM aliyah_services').fetchall()
            calls=db.execute('SELECT * FROM aliyah_calls').fetchall()
            identities=db.execute('SELECT id,created_at FROM community_people ORDER BY id').fetchall()
            db.executescript('''DROP TABLE aliyah_calls; DROP TABLE aliyah_services;
                CREATE TABLE aliyah_services (id TEXT PRIMARY KEY, service_date TEXT NOT NULL,
                    service TEXT NOT NULL, reading TEXT NOT NULL, cancelled INTEGER NOT NULL,
                    recorded_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
                    UNIQUE(service_date,service));
                CREATE TABLE aliyah_calls (service_id TEXT NOT NULL REFERENCES aliyah_services(id),position TEXT NOT NULL,
                    person_id TEXT REFERENCES roster_people(id),person_name TEXT NOT NULL,PRIMARY KEY(service_id,position));''')
            db.executemany('INSERT INTO aliyah_services VALUES (?,?,?,?,?,?,?,?)',services)
            db.executemany('INSERT INTO aliyah_calls VALUES (?,?,?,?)',calls)
        upgraded=Store(self.store.path)
        self.assertEqual(upgraded.aliyah_services(self.gabbai)[0],original)
        with upgraded.db() as db:
            self.assertEqual([tuple(row) for row in db.execute('SELECT * FROM aliyah_calls')],calls)
            self.assertEqual([tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')],identities)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_eighth_and_later_slots_accept_kohen_or_levi_and_regular_slots_remain_restricted(self):
        profile=self.family_profile([])
        for tribe in ['kohen','levi']:
            profile['tribe']=tribe
            self.store.save_profile(self.member,profile)
            calls=self.calls()
            calls.insert(-1,dict(position='ישראל 6',personId=self.member_id))
            body=dict(date='2026-10-24',reading='לך לך',calls=calls,minyan=1 if tribe=='kohen' else 2)
            self.assertEqual(self.http('POST','/api/admin/aliyah-records',body,'gabbai-token')[0],201)
            wrong=copy.deepcopy(calls);wrong[2]=dict(position='ישראל 1',personId=self.member_id)
            self.assertEqual(self.http('POST','/api/admin/aliyah-records',{**body,'minyan':3,'calls':wrong},'gabbai-token')[0],400)

    def test_yom_kippur_mincha_has_three_calls_and_no_separate_maftir_or_extras(self):
        template=self.http('GET','/api/admin/aliyah-template?date=2026-09-21&service=mincha',token='gabbai-token')[1]
        self.assertEqual(template['reading'],'יום כיפור - מנחה')
        self.assertEqual([slot['position'] for slot in template['slots']],['כהן','לוי','ישראל 1'])
        self.assertFalse(template['allowExtra'])
        morning=dict(date='2026-09-21',reading='יום כיפור - שחרית',calls=self.calls('2026-09-21'))
        afternoon=dict(date='2026-09-21',service='mincha',reading='יום כיפור - מנחה',calls=self.calls('2026-09-21','mincha'))
        self.assertEqual(self.http('POST','/api/admin/aliyah-records',morning,'gabbai-token')[0],201)
        status,saved,_=self.http('POST','/api/admin/aliyah-records',afternoon,'gabbai-token')
        self.assertEqual(status,201,saved)
        self.assertEqual(saved['service'],'mincha')
        self.assertEqual(self.http('PUT','/api/admin/aliyah-records/'+saved['id'],{**afternoon,'calls':afternoon['calls']+[dict(position='מפטיר',guest=True)]},'gabbai-token')[0],400)
        self.assertEqual(self.http('GET','/api/admin/aliyah-template?date=2026-10-24&service=mincha',token='gabbai-token')[0],400)

    def test_mincha_recommendations_include_both_morning_minyanim_but_not_afternoon_calls(self):
        profile=self.family_profile([])
        profile['yahrzeits']=[dict(id='yk',name='אב לדוגמה',relationship='father',day=10,month='tishrei',year='')]
        self.store.save_profile(self.member,profile)
        for minyan in [1,2]:
            self.store.save_aliyah_service(self.gabbai,dict(date='2026-09-21',service='shacharit',minyan=minyan,reading='יום כיפור - שחרית',calls=[dict(position='ישראל 1',personId=self.member_id)]))
        self.store.save_aliyah_service(self.gabbai,dict(date='2026-09-21',service='mincha',reading='יום כיפור - מנחה',calls=[dict(position='ישראל 1',personId=self.member_id)]))
        self.store.save_roster_person(self.gabbai,dict(classification='א'),self.member_id)
        for prayer,expected in [('shacharit',0),('mincha',2)]:
            status,report,_=self.http('GET','/api/admin/aliyah-recommendations?date=2026-09-21&service='+prayer,token='gabbai-token')
            self.assertEqual(status,200,report)
            row=next(person for section in report['sections'] if section['id']=='events' for person in section['people'] if person['id']==self.member_id)
            self.assertEqual(row['aliyahCount'],expected)
            self.assertNotIn(self.member_id,[p['id'] for section in report['sections'][1:] for p in section['people']])
            self.assertEqual(report['service']['service'],prayer)
            self.assertIn('מנחה' if prayer=='mincha' else 'שחרית',report['service']['title'])
        self.assertEqual(self.http('GET','/api/admin/aliyah-recommendations?date=2026-10-24&service=mincha',token='gabbai-token')[0],400)

    def test_imported_unknown_and_extended_relationships_can_be_edited_and_reported(self):
        profile=self.family_profile([])
        profile['yahrzeits']=[dict(id=relationship,name='קרוב לדוגמה',relationship=relationship,day=20,month='cheshvan',year='') for relationship in ['father_in_law','mother_in_law','uncle','aunt','unknown']]
        self.assertEqual(self.http('PUT','/api/profile',profile,'member-token')[0],200)
        events=next(person['events'] for person in self.store.aliyah_recommendations(self.gabbai,'2026-10-31')['sections'][0]['people'] if person['id']==self.member_id)
        for label,event in zip(['חותן','חותנת','דוד','דודה','לא ידוע'],events):self.assertIn(label,event['description'])
