# Ported from origin/main 6d74d0e server/tests/test_multiple_minyanim.py (aliyah-recommendation parts only)
import unittest

from aliyot_engine_helpers import EngineCase


class MultipleMinyanTest(EngineCase):
    def test_two_minyanim_are_separate_and_both_count_without_duplicate_in_same_minyan(self):
        # Only the counting rule is engine logic; uniqueness (409), minyan range (400) and ids are save-time plumbing.
        member=self.person('member')
        for minyan in [1,2]:
            self.service('2026-10-24',[dict(position='ישראל 1',personId=member)],reading='לך לך',minyan=minyan)
        row=next(row for row in self.section('israel_a','2026-12-05') if row['id']==member)
        self.assertEqual(row['aliyahCount'],2)

    def test_mincha_recommendations_include_both_morning_minyanim_but_not_afternoon_calls(self):
        member=self.person('member',yahrzeits=[dict(id='yk',name='אב לדוגמה',relationship='father',day=10,month='tishrei',year='')])
        for minyan in [1,2]:
            self.service('2026-09-21',[dict(position='ישראל 1',personId=member)],reading='יום כיפור - שחרית',minyan=minyan)
        self.service('2026-09-21',[dict(position='ישראל 1',personId=member)],reading='יום כיפור - מנחה',service='mincha')
        for prayer,expected in [('shacharit',0),('mincha',2)]:
            report=self.report('2026-09-21',prayer)
            row=next(person for section in report['sections'] if section['id']=='events' for person in section['people'] if person['id']==member)
            self.assertEqual(row['aliyahCount'],expected)
            self.assertNotIn(member,[p['id'] for section in report['sections'][1:] for p in section['people']])
            self.assertEqual(report['service']['service'],prayer)
            self.assertIn('מנחה' if prayer=='mincha' else 'שחרית',report['service']['title'])
        from server.validation import APIError
        with self.assertRaises(APIError) as caught:
            self.report('2026-10-24','mincha')
        self.assertEqual(caught.exception.status,400)

    def test_imported_unknown_and_extended_relationships_can_be_edited_and_reported(self):
        member=self.person('member',yahrzeits=[dict(id=relationship,name='קרוב לדוגמה',relationship=relationship,day=20,month='cheshvan',year='') for relationship in ['father_in_law','mother_in_law','uncle','aunt','unknown']])
        events=next(person['events'] for person in self.report('2026-10-31')['sections'][0]['people'] if person['id']==member)
        for label,event in zip(['חותן','חותנת','דוד','דודה','לא ידוע'],events):self.assertIn(label,event['description'])


if __name__ == '__main__':
    unittest.main()
