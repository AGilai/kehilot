"""Upcoming simchas for gabbaim (UX-DESIGN 17.14): bar and bat mitzvahs from the family trees, grouped by week."""
import json
from datetime import date
from unittest.mock import patch

from moto import mock_aws
from pyluach import dates

from server.cloud import simchas, tree_rules
from server.tests.cloud import test_messages
from server.tests.cloud.test_groups import own_tests_only
from server.tests.cloud.test_tree import S, person, pid

TODAY = date(2026, 10, 28)  # a Wednesday; its week's Shabbat is 2026-10-31 (Vayera)


def born(target, years):
    """The Hebrew birth date whose `years`-th anniversary is the Hebrew date of `target`."""
    h = dates.HebrewDate.from_pydate(target)
    year = h.year - years
    return {'day': h.day, 'month': tree_rules.month_key(h.month, year), 'year': year}


def tree(*children, surname='דוגמה'):
    return [{'id': S, 'relation': 'self', 'gender': 'm', 'hebrewFirst': 'ישראל', 'surname': surname}, *children]


def boy(n, name, birth=None, **extra):
    return person(n, 'child', hebrewFirst=name, **({'birth': birth} if birth else {}), **extra)


def girl(n, name, birth=None, **extra):
    return person(n, 'child', gender='f', hebrewFirst=name, **({'birth': birth} if birth else {}), **extra)


def shabbat_on_or_after(day):
    return date.fromordinal(day.toordinal() + (5 - day.weekday()) % 7).isoformat()


def flat(weeks):
    return [(w['shabbat'], i['kind'], i['firstName'], i['date'], i['manual']) for w in weeks for i in w['items']]


class UpcomingSimchasTest(test_messages.unittest.TestCase):
    def up(self, families, today=TODAY, weeks=8):
        return simchas.upcoming_simchas(families, today, weeks)

    def test_eight_weeks_from_the_israel_week_of_today(self):
        result = self.up([])
        self.assertEqual(len(result), 8)
        self.assertEqual(result[0]['week'], '2026-10-25')  # Sunday
        self.assertEqual(result[0]['shabbat'], '2026-10-31')
        self.assertEqual(result[0]['parasha'], 'וירא')
        self.assertEqual(result[7]['shabbat'], '2026-12-19')
        self.assertTrue(all(w['items'] == [] for w in result))  # quiet weeks stay in the list, empty

    def test_stored_bar_mitzvah_manual_flag_and_parasha(self):
        kids = [boy(1, 'הלל', barMitzvah={'date': '2026-10-31', 'parasha': 'וירא', 'manual': True})]
        result = self.up([tree(*kids)])
        self.assertEqual(flat(result), [('2026-10-31', 'bar', 'הלל', '2026-10-31', True)])
        self.assertEqual(result[0]['items'][0]['surname'], 'דוגמה')

    def test_stored_wins_over_the_suggestion(self):
        birth = born(date(2026, 11, 7), 13)  # suggestion would be 2026-11-07
        kids = [boy(1, 'הלל', birth, barMitzvah={'date': '2026-11-21', 'parasha': 'ויצא', 'manual': True})]
        self.assertEqual(flat(self.up([tree(*kids)])), [('2026-11-21', 'bar', 'הלל', '2026-11-21', True)])

    def test_suggestion_when_nothing_stored_is_the_shabbat_on_or_after(self):
        birth = born(date(2026, 11, 9), 13)  # a Monday
        result = self.up([tree(boy(1, 'עמית', birth))])
        self.assertEqual(flat(result), [('2026-11-14', 'bar', 'עמית', '2026-11-14', False)])
        self.assertEqual(result[2]['parasha'], 'תולדות')

    def test_suggestion_matches_the_shared_birthday_function(self):
        from server.hebrew_calendar import bar_mitzvah_date
        birth = born(date(2026, 11, 14), 13)  # the birthday is itself Shabbat
        birthday = bar_mitzvah_date(birth, TODAY)
        self.assertEqual(birthday, date(2026, 11, 14))
        self.assertEqual(flat(self.up([tree(boy(1, 'עמית', birth))]))[0][3], '2026-11-14')

    def test_holiday_shabbat_has_a_label_and_no_parasha(self):
        result = self.up([tree(boy(1, 'עמית', barMitzvah={'date': '2026-12-05', 'parasha': '', 'label': 'שבת חנוכה', 'manual': False}))])
        item_week = [w for w in result if w['items']][0]
        self.assertEqual((item_week['shabbat'], item_week['parasha']), ('2026-12-05', 'וישב'))
        self.assertEqual(item_week['items'][0]['label'], 'שבת חנוכה')

    def test_bat_mitzvah_is_the_twelfth_hebrew_birthday_in_its_week(self):
        birth = born(date(2026, 11, 9), 12)
        result = self.up([tree(girl(1, 'נגה', birth))])
        self.assertEqual(flat(result), [('2026-11-14', 'bat', 'נגה', '2026-11-09', False)])
        self.assertEqual(result[2]['week'], '2026-11-08')

    def test_a_girl_on_shabbat_stays_on_her_day(self):
        birth = born(date(2026, 11, 14), 12)
        self.assertEqual(flat(self.up([tree(girl(1, 'נגה', birth))])), [('2026-11-14', 'bat', 'נגה', '2026-11-14', False)])

    def test_adar_births_in_leap_and_regular_years(self):
        # born in a regular year's Adar (5775); the 13th birthday is in 5788 (regular): stays Adar
        regular = {'day': 20, 'month': 'adar', 'year': 5775}
        day = dates.HebrewDate(5788, 12, 20).to_pydate()
        found = flat(self.up([tree(boy(1, 'אורי', regular))], today=date.fromordinal(day.toordinal() - 5)))
        self.assertEqual([(f[2], f[3]) for f in found], [('אורי', shabbat_on_or_after(day))])
        # born in a leap year's Adar II (5771); the 12th birthday is in 5783 (regular): it falls in Adar
        leap = {'day': 10, 'month': 'adar_ii', 'year': 5771}
        day = dates.HebrewDate(5783, 12, 10).to_pydate()
        found = flat(self.up([tree(girl(2, 'שירה', leap))], today=date.fromordinal(day.toordinal() - 3)))
        self.assertEqual([(f[1], f[3]) for f in found], [('bat', day.isoformat())])
        # a plain-Adar birth in a regular year whose 13th year is leap: it moves to Adar II
        moved = {'day': 7, 'month': 'adar', 'year': 5769}  # 5782 is leap
        day = dates.HebrewDate(5782, 13, 7).to_pydate()
        found = flat(self.up([tree(boy(3, 'דן', moved))], today=date.fromordinal(day.toordinal() - 5)))
        self.assertEqual([f[3] for f in found], [shabbat_on_or_after(day)])
        # an Adar I birth stays in Adar I when the year is leap: 5 Adar I 5784
        adar_one = {'day': 5, 'month': 'adar_i', 'year': 5771}
        day = dates.HebrewDate(5784, 12, 5).to_pydate()
        found = flat(self.up([tree(boy(4, 'גל', adar_one))], today=date.fromordinal(day.toordinal() - 4)))
        self.assertEqual([f[3] for f in found], [shabbat_on_or_after(day)])

    def test_deceased_are_skipped(self):
        birth = born(date(2026, 11, 9), 13)
        self.assertEqual(self.up([tree(boy(1, 'עמית', birth, deceased=True))]), self.up([]))

    def test_only_children_with_a_first_name_and_a_date(self):
        birth = born(date(2026, 11, 9), 13)
        people = tree(boy(1, 'ללא תאריך'), boy(2, '', birth),
                      person(3, 'grandchild', of=pid(1), hebrewFirst='נכד', birth=birth),
                      {'id': pid(4), 'relation': 'spouse', 'of': S, 'gender': 'f', 'hebrewFirst': 'דוגמה', 'birth': birth})
        self.assertEqual(flat(self.up([people])), [])

    def test_outside_the_window_and_past_days_are_left_out(self):
        past = born(date(2026, 10, 26), 12)  # Monday, before today
        later = born(date(2026, 12, 25), 12)  # after the 8th week
        edge = born(date(2026, 12, 19), 12)
        kids = [girl(1, 'א', past), girl(2, 'ב', later), girl(3, 'ג', edge)]
        self.assertEqual([f[2] for f in flat(self.up([tree(*kids)]))], ['ג'])

    def test_today_counts_and_surname_falls_back_to_the_parent(self):
        today_birth = born(TODAY, 12)
        result = self.up([tree(girl(1, 'נגה', today_birth), surname='ניסיון')])
        self.assertEqual(result[0]['items'][0]['surname'], 'ניסיון')
        self.assertEqual(result[0]['items'][0]['date'], '2026-10-28')

    def test_child_surname_wins_when_set(self):
        birth = born(date(2026, 11, 9), 13)
        result = self.up([tree(boy(1, 'עמית', birth, surname='אחר'))])
        self.assertEqual([i['surname'] for w in result for i in w['items']], ['אחר'])

    def test_item_has_only_the_allowed_keys_and_ordering(self):
        b1, b2 = born(date(2026, 11, 14), 13), born(date(2026, 11, 14), 13)
        result = self.up([tree(boy(1, 'ב', b1)), tree(girl(2, 'א', born(date(2026, 11, 9), 12)), boy(3, 'ג', b2))])
        items = [i for w in result for i in w['items']]
        self.assertEqual([i['firstName'] for i in items], ['א', 'ב', 'ג'])  # by date, then name
        for item in items:
            self.assertLessEqual(set(item), {'kind', 'firstName', 'surname', 'date', 'manual', 'label'})

    def test_an_invalid_birth_is_ignored(self):
        self.assertEqual(flat(self.up([tree(boy(1, 'עמית', {'day': 5, 'month': 'sivan'}))])), [])


@own_tests_only
@mock_aws
class SimchasRouteTest(test_messages.MessagesTest):
    def setUp(self):
        super().setUp()
        patcher = patch('server.cloud.repo_messages.local_date', return_value=TODAY.isoformat())
        patcher.start()
        self.addCleanup(patcher.stop)

    def path(self, query=''):
        return f'{self.base()}/admin/simchas{query}'

    def save(self, sub, people):
        tree_path = f'{self.base()}/family/tree'
        _, got = self.call('GET', tree_path, sub=sub)
        self.assertEqual(self.call('PUT', tree_path, sub=sub, body={'people': people, 'ifVersion': got['version']})[0], 200)

    def test_gabbai_gets_the_weeks_with_minimal_items(self):
        self.save('member-sub', tree(girl(1, 'נגה', born(date(2026, 11, 9), 12)),
                                     boy(2, 'הלל', barMitzvah={'date': '2026-10-31', 'parasha': 'וירא', 'manual': True})))
        status, body = self.call('GET', self.path(), sub='gabbai-sub')
        self.assertEqual(status, 200)
        self.assertEqual(len(body['weeks']), 8)
        items = [i for w in body['weeks'] for i in w['items']]
        self.assertEqual(items, [{'kind': 'bar', 'firstName': 'הלל', 'surname': 'דוגמה', 'date': '2026-10-31', 'manual': True},
                                 {'kind': 'bat', 'firstName': 'נגה', 'surname': 'דוגמה', 'date': '2026-11-09', 'manual': False}])
        text = json.dumps(body, ensure_ascii=False)
        self.assertNotIn(self.member, text)
        self.assertNotIn(pid(1), text)

    def test_weeks_query(self):
        self.assertEqual(len(self.call('GET', self.path(), sub='gabbai-sub', query={'weeks': '4'})[1]['weeks']), 4)
        for bad in ('0', '13', 'x', '-1', '2.5'):
            self.assertEqual(self.call('GET', self.path(), sub='gabbai-sub', query={'weeks': bad}),
                             (400, {'error': 'invalid_weeks'}), bad)

    def test_roles(self):
        self.assertEqual(self.call('GET', self.path(), sub='member-sub')[0], 403)
        self.assertEqual(self.call('GET', self.path(), sub='quiet-sub')[0], 403)
        self.assertEqual(self.call('GET', self.path(), sub='listener-sub')[0], 403)
        self.assertEqual(self.call('GET', self.path(), sub='stranger-sub')[0], 404)
        for method in ('PUT', 'POST', 'DELETE'):
            self.assertEqual(self.call(method, self.path(), sub='gabbai-sub', body={})[0], 405)

    def test_other_kehila_gabbai_and_other_kehila_families(self):
        self.save('member-sub', tree(girl(1, 'נגה', born(date(2026, 11, 9), 12))))
        k2 = self.repo.create_kehila('Beit Other', {})
        other = self.call('GET', '/v1/me', sub='other-gabbai-sub')[1]['userId']
        self.repo.put_membership(k2, other, 'gabbai')
        body = self.call('GET', f'/v1/kehilot/{k2}/admin/simchas', sub='other-gabbai-sub')[1]
        self.assertEqual([i for w in body['weeks'] for i in w['items']], [])
        self.assertEqual(self.call('GET', self.path(), sub='other-gabbai-sub')[0], 404)

    def test_family_without_a_live_adult_is_left_out(self):
        self.save('member-sub', tree(girl(1, 'נגה', born(date(2026, 11, 9), 12))))
        self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.member}'})
        body = self.call('GET', self.path(), sub='gabbai-sub')[1]
        self.assertEqual([i for w in body['weeks'] for i in w['items']], [])

    def test_children_only_family_without_people_is_used(self):
        fid = self.repo.ensure_family(self.k, self.member)
        child = {'id': 'C' * 26, 'firstName': 'נגה', 'gender': 'f', 'birthDate': '2014-11-10'}
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'F#{fid}'}, UpdateExpression='SET children = :c',
                                    ExpressionAttributeValues={':c': [child]})
        body = self.call('GET', self.path(), sub='gabbai-sub')[1]
        self.assertEqual([(i['firstName'], i['kind']) for w in body['weeks'] for i in w['items']], [('נגה', 'bat')])
