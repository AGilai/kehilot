"""Family tree storage (UX-DESIGN 17.5): validation, versioned writes, gabbai read, children migration."""
from datetime import date, timedelta

from unittest.mock import patch

from moto import mock_aws

from server.cloud import export, tree_rules
from server.cloud.errors import ApiError
from server.tests.cloud import test_messages
from server.tests.cloud.test_groups import own_tests_only

TODAY = date(2026, 10, 28)
S, SP = 'S' * 26, 'P' * 26


def plain(people):
    return [{k: v for k, v in p.items() if k != 'userId'} for p in people]


def pid(n):
    return f'{n:026d}'


def person(n, relation, **extra):
    base = {'id': pid(n), 'relation': relation, 'gender': 'm'}
    return {**base, **extra}


def basic():
    return [{'id': S, 'relation': 'self', 'gender': 'm', 'hebrewFirst': 'ישראל', 'surname': 'ישראלי',
             'tribe': 'levi', 'birth': {'day': 5, 'month': 'sivan', 'year': 5750}},
            {'id': SP, 'relation': 'spouse', 'of': S, 'gender': 'f', 'hebrewFirst': 'דוגמה'},
            person(1, 'father', of=S, hebrewFirst='יוסף חיים', deceased=True,
                   death={'day': 3, 'month': 'adar_ii', 'year': 5784}),
            person(2, 'mother', of=S, gender='f', hebrewFirst='שרה'),
            person(3, 'child', hebrewFirst='נועם', barMitzvah={'date': '2026-06-13', 'parasha': 'בהעלותך', 'manual': False},
                   figure={'headCovering': 'none', 'kippah': 'knitted', 'beard': 'none', 'glasses': True, 'skin': 1,
                           'hair': '#aa8844'}),
            person(4, 'childSpouse', of=pid(3), gender='f', hebrewFirst='ניסיון'),
            person(5, 'grandchild', of=pid(3), hebrewFirst='ינון')]


def code(people, today=TODAY):
    try:
        tree_rules.validate_people(people, today)
    except ApiError as error:
        return error.status, error.code
    return None


@own_tests_only
@mock_aws
class TreeRulesTest(test_messages.MessagesTest):
    def test_valid_tree_round_trips(self):
        self.assertEqual(tree_rules.validate_people(basic(), TODAY), basic())
        self.assertEqual(tree_rules.validate_people([], TODAY), [])

    def test_shape_and_enums(self):
        def bad(index, **change):
            people = basic()
            people[index] = {**people[index], **change}
            return code(people)
        self.assertEqual(code({}), (400, 'invalid_people'))
        self.assertEqual(code(['x']), (400, 'invalid_people'))
        self.assertEqual(bad(0, relation='uncle'), (400, 'invalid_relation'))
        self.assertEqual(bad(0, gender='x'), (400, 'invalid_gender'))
        self.assertEqual(bad(0, extra=1), (400, 'invalid_people'))
        self.assertEqual(bad(0, id='bad id!'), (400, 'invalid_people'))
        self.assertEqual(bad(0, hebrewFirst='א' * 41), (400, 'invalid_name'))
        self.assertEqual(bad(0, surname=5), (400, 'invalid_name'))
        self.assertEqual(bad(0, tribe='x'), (400, 'invalid_tribe'))
        self.assertEqual(bad(1, tribe='kohen'), (400, 'invalid_tribe'))  # no tribe for women
        self.assertEqual(bad(0, deceased='yes'), (400, 'invalid_people'))
        self.assertEqual(bad(0, barMitzvah={'date': '2026-13-01', 'parasha': 'x', 'manual': False}),
                         (400, 'invalid_bar_mitzvah'))
        self.assertEqual(bad(1, barMitzvah={'date': '2026-06-13', 'parasha': 'x', 'manual': False}),
                         (400, 'invalid_bar_mitzvah'))
        self.assertEqual(bad(0, barMitzvah={'date': '2026-06-13', 'parasha': 'x'}), (400, 'invalid_bar_mitzvah'))
        dup = basic() + [person(1, 'child')]
        self.assertEqual(code(dup), (400, 'invalid_people'))

    def test_figure_is_strict(self):
        for figure in [{'headCovering': 'crown'}, {'kippah': 1}, {'beard': 'x'}, {'glasses': 'yes'}, {'skin': 3},
                       {'skin': True}, {'coverColor': 'red'}, {'coverColor': '#12345'}, {'hair': '#GGGGGG'},
                       {'unknown': 1}, 'x']:
            people = basic()
            people[0]['figure'] = figure
            self.assertEqual(code(people), (400, 'invalid_figure'), figure)
        people = basic()
        people[0]['figure'] = {'coverColor': '#A1b2C3', 'skin': 0, 'headCovering': 'wig'}
        self.assertIsNone(code(people))

    def test_relation_graph(self):
        self.assertEqual(code([x for x in basic() if x['id'] != S]), (400, 'invalid_people'))  # no self
        self.assertEqual(code(basic() + [person(9, 'self')]), (400, 'invalid_people'))
        self.assertEqual(code(basic() + [person(9, 'spouse', of=S)]), (400, 'invalid_relation'))
        orphan = basic()
        orphan[2]['of'] = pid(99)
        self.assertEqual(code(orphan), (400, 'invalid_relation'))
        no_of = basic()
        del no_of[2]['of']
        self.assertEqual(code(no_of), (400, 'invalid_relation'))
        self.assertEqual(code(basic() + [person(9, 'father', of=S)]), (400, 'invalid_relation'))  # second father
        self.assertEqual(code(basic() + [person(9, 'mother', of=S)]), (400, 'invalid_relation'))  # wrong gender
        self.assertEqual(code(basic() + [person(9, 'childSpouse', of=pid(3))]), (400, 'invalid_relation'))
        self.assertEqual(code(basic() + [person(9, 'childSpouse', of=S)]), (400, 'invalid_relation'))
        self.assertEqual(code(basic() + [person(9, 'grandchild', of=S)]), (400, 'invalid_relation'))
        self.assertEqual(code(basic() + [person(9, 'child', of=SP)]), (400, 'invalid_relation'))
        self.assertIsNone(code(basic() + [person(9, 'child', of=S)]))

    def test_parents_only_of_the_couple_and_their_ancestors(self):
        for n, of in ((9, pid(3)), (9, pid(4)), (9, pid(5))):
            self.assertEqual(code(basic() + [person(n, 'father', of=of)]), (400, 'invalid_relation'), of)
        self.assertIsNone(code(basic() + [person(9, 'father', of=SP)]))
        self.assertIsNone(code(basic() + [person(9, 'father', of=pid(1))]))
        former = {'id': pid(30), 'relation': 'formerSpouse', 'of': S, 'gender': 'f', 'hebrewFirst': 'רחל', 'deceased': True}
        self.assertIsNone(code(basic() + [former]))
        self.assertEqual(code(basic() + [former, dict(former, id=pid(31))]), (400, 'invalid_relation'))
        self.assertEqual(code(basic() + [dict(former, of=SP)]), (400, 'invalid_relation'))
        self.assertEqual(code(basic() + [former, person(9, 'father', of=pid(30))]), (400, 'invalid_relation'))

    def test_holiday_bar_mitzvah_has_an_empty_parasha_and_a_label(self):
        people = basic()
        people[4]['barMitzvah'] = {'date': '2026-10-03', 'parasha': '', 'manual': False, 'label': 'שבת חול המועד סוכות'}
        self.assertEqual(tree_rules.validate_people(people, TODAY), people)
        people[4]['barMitzvah']['label'] = 5
        self.assertEqual(code(people), (400, 'invalid_bar_mitzvah'))
        people[4]['barMitzvah'] = {'date': '2026-10-03', 'parasha': '', 'manual': False, 'x': 1}
        self.assertEqual(code(people), (400, 'invalid_bar_mitzvah'))

    def test_father_cycle_rejected(self):
        a, b = person(11, 'father', of=pid(12)), person(12, 'father', of=pid(11))
        self.assertEqual(code([basic()[0], a, b]), (400, 'invalid_relation'))

    def test_limits(self):
        kids = [person(100 + n, 'child') for n in range(20)]
        self.assertIsNone(code([basic()[0]] + kids))
        self.assertEqual(code([basic()[0]] + kids + [person(200, 'child')]), (400, 'children_limit'))
        grand = [person(300 + n, 'grandchild', of=pid(100)) for n in range(20)]
        self.assertIsNone(code([basic()[0]] + kids + grand))
        self.assertEqual(code([basic()[0]] + kids + grand + [person(400, 'grandchild', of=pid(100))]),
                         (400, 'grandchildren_limit'))
        chain = [basic()[0]]
        of = S
        for n in range(1, 7):
            chain.append(person(n, 'father', of=of))
            of = pid(n)
        self.assertIsNone(code(chain))
        self.assertEqual(code(chain + [person(7, 'father', of=pid(6))]), (400, 'generations_limit'))
        mother_line = chain + [person(8, 'mother', of=pid(6), gender='f')]
        self.assertEqual(code(mother_line), (400, 'generations_limit'))

    def test_adar_rule_both_ways(self):
        def with_birth(month, year, day=5):
            people = basic()
            people[0]['birth'] = {'day': day, 'month': month, 'year': year}
            return code(people)
        self.assertEqual(with_birth('adar', 5784), (400, 'invalid_adar'))     # 5784 is a leap year
        self.assertIsNone(with_birth('adar_i', 5784))
        self.assertIsNone(with_birth('adar_ii', 5784))
        self.assertEqual(with_birth('adar_i', 5785), (400, 'invalid_adar'))   # 5785 is a regular year
        self.assertEqual(with_birth('adar_ii', 5785), (400, 'invalid_adar'))
        self.assertIsNone(with_birth('adar', 5785))
        death = basic()
        death[2]['death'] = {'day': 3, 'month': 'adar', 'year': 5784}
        self.assertEqual(code(death), (400, 'invalid_adar'))

    def test_hebrew_date_shape(self):
        def with_birth(value):
            people = basic()
            people[0]['birth'] = value
            return code(people)
        for value in [{'day': 0, 'month': 'nisan'}, {'day': 31, 'month': 'nisan'}, {'day': 30, 'month': 'iyar'},
                      {'day': 1, 'month': 'march'}, {'day': True, 'month': 'nisan'}, {'month': 'nisan'},
                      {'day': 1, 'month': 'nisan', 'year': 'x'}, {'day': 1, 'month': 'nisan', 'year': 100},
                      {'day': 1, 'month': 'nisan', 'extra': 1}, 'x', {'day': 30, 'month': 'adar'}]:
            self.assertEqual(with_birth(value)[0], 400, value)
        self.assertIsNone(with_birth({'day': 30, 'month': 'adar_i'}))  # no year: any Adar is accepted as stored
        self.assertIsNone(with_birth({'day': 29, 'month': 'iyar'}))
        self.assertEqual(with_birth({'day': 30, 'month': 'cheshvan', 'year': 5781}), (400, 'invalid_hebrew_date'))  # 5781: Cheshvan has 29 days

    def test_dates_in_time(self):
        future = (TODAY + timedelta(days=400))
        from pyluach import dates
        h = dates.GregorianDate(future.year, future.month, future.day).to_heb()
        names = {v: k for k, v in __import__('server.hebrew_calendar', fromlist=['x']).MONTH_NUMBERS.items() if k not in ('adar_i', 'adar_ii', 'adar')}
        people = basic()
        people[0]['birth'] = {'day': h.day, 'month': names.get(h.month, 'adar'), 'year': h.year}
        self.assertEqual(code(people)[1], 'invalid_birth')
        people = basic()
        people[2]['death'] = {'day': 1, 'month': 'tishrei', 'year': 5700}  # before the self's... father has no birth: ok
        self.assertIsNone(code(people))
        people[2]['birth'] = {'day': 1, 'month': 'tishrei', 'year': 5701}
        self.assertEqual(code(people), (400, 'invalid_death'))
        people[2]['birth'] = {'day': 1, 'month': 'tishrei', 'year': 5700}  # same day is fine
        self.assertIsNone(code(people))
        people[2]['death'] = {'day': 1, 'month': 'tishrei', 'year': 5900}  # in the future
        self.assertEqual(code(people), (400, 'invalid_death'))
        alive = basic()
        alive[2]['deceased'] = False
        self.assertEqual(code(alive), (400, 'invalid_death'))  # a death date for someone not deceased

    def test_children_conversion_round_trip(self):
        children = [{'id': pid(1), 'firstName': 'נועה', 'gender': 'f', 'birthDate': '2015-12-31'},
                    {'id': pid(2), 'firstName': 'בן', 'gender': 'm'}]
        people = tree_rules.people_from_children(children)
        self.assertEqual([(p['id'], p['relation'], p['hebrewFirst'], p['gender']) for p in people],
                         [(pid(1), 'child', 'נועה', 'f'), (pid(2), 'child', 'בן', 'm')])
        self.assertEqual(people[0]['birth'], {'day': 19, 'month': 'tevet', 'year': 5776})
        self.assertNotIn('birth', people[1])
        self.assertEqual(tree_rules.children_view(people), children)


@own_tests_only
@mock_aws
class TreeRoutesTest(test_messages.MessagesTest):
    def tree(self, path='/family/tree'):
        return f'{self.base()}{path}'

    def put(self, people, version, sub='member-sub'):
        return self.call('PUT', self.tree(), sub=sub, body={'people': people, 'ifVersion': version})

    def family_id(self, user_id):
        return self.repo.ensure_family(self.k, user_id)

    def read(self, sub='member-sub'):
        status, body = self.call('GET', self.tree(), sub=sub)
        body = {k: v for k, v in body.items() if k != 'updatedAt'}
        return status, {**body, 'people': plain(body['people'])}

    def test_empty_tree_then_save_and_read(self):
        status, body = self.call('GET', self.tree(), sub='member-sub')
        self.assertEqual((status, body['people']), (200, []))
        status, saved = self.put(basic(), body['version'])
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['version'], body['version'] + 1)
        self.assertEqual(self.read(), (200, {'people': basic(), 'version': saved['version']}))

    def test_stale_if_version_is_409_and_nothing_changes(self):
        _, first = self.call('GET', self.tree(), sub='member-sub')
        self.assertEqual(self.put(basic(), first['version'])[0], 200)
        other = basic()
        other[0]['hebrewFirst'] = 'אחר'
        self.assertEqual(self.put(other, first['version']), (409, {'error': 'version_conflict'}))
        self.assertEqual(self.read()[1]['people'], basic())

    def test_two_adults_share_one_tree(self):
        self.repo.link(self.k, self.member, self.quiet)
        _, got = self.call('GET', self.tree(), sub='member-sub')
        self.assertEqual(self.put(basic(), got['version'])[0], 200)
        self.assertEqual(self.read('quiet-sub')[1]['people'], basic())

    def test_validation_error_is_400_and_ifversion_required(self):
        _, got = self.call('GET', self.tree(), sub='member-sub')
        bad = basic()
        bad[0]['relation'] = 'uncle'
        self.assertEqual(self.put(bad, got['version']), (400, {'error': 'invalid_relation'}))
        for body in [{'people': basic()}, {'people': basic(), 'ifVersion': 'x'}, {'ifVersion': 1},
                     {'people': basic(), 'ifVersion': True}]:
            self.assertEqual(self.call('PUT', self.tree(), sub='member-sub', body=body)[0], 400, body)

    def test_roles(self):
        self.assertEqual(self.call('GET', self.tree(), sub='listener-sub')[0], 403)
        self.assertEqual(self.call('PUT', self.tree(), sub='listener-sub', body={'people': [], 'ifVersion': 1})[0], 403)
        self.assertEqual(self.call('GET', self.tree(), sub='stranger-sub')[0], 404)
        self.call('GET', '/v1/me', sub='stranger-sub')
        self.assertEqual(self.call('GET', self.tree(), sub='stranger-sub')[0], 404)

    def test_other_kehila_is_404(self):
        k2 = self.repo.create_kehila('Beit Other', {})
        self.assertEqual(self.call('GET', f'/v1/kehilot/{k2}/family/tree', sub='member-sub')[0], 404)
        self.assertEqual(self.call('GET', f'/v1/kehilot/{k2}/admin/families/{self.family_id(self.member)}/tree',
                                   sub='gabbai-sub')[0], 404)

    def test_gabbai_reads_read_only(self):
        _, got = self.call('GET', self.tree(), sub='member-sub')
        self.put(basic(), got['version'])
        fid = self.family_id(self.member)
        path = self.tree(f'/admin/families/{fid}/tree')
        status, body = self.call('GET', path, sub='gabbai-sub')
        self.assertEqual((status, plain(body['people'])), (200, basic()))
        self.assertEqual(body['version'], got['version'] + 1)
        self.assertEqual(self.call('GET', path, sub='member-sub')[0], 403)
        self.assertEqual(self.call('GET', path, sub='listener-sub')[0], 403)
        for method in ('PUT', 'POST', 'DELETE'):
            self.assertEqual(self.call(method, path, sub='gabbai-sub', body={'people': []})[0], 405)
        self.assertEqual(self.call('GET', self.tree('/admin/families/nope/tree'), sub='gabbai-sub')[0], 404)
        self.assertEqual(self.call('GET', self.tree('/admin/families/' + 'Z' * 26 + '/tree'), sub='gabbai-sub')[0], 404)

    def test_gabbai_of_another_kehila_cannot_read(self):
        k2 = self.repo.create_kehila('Beit Other', {})
        other = self.call('GET', '/v1/me', sub='other-gabbai-sub')[1]['userId']
        self.repo.put_membership(k2, other, 'gabbai')
        fid = self.family_id(self.member)
        self.assertEqual(self.call('GET', f'/v1/kehilot/{k2}/admin/families/{fid}/tree', sub='other-gabbai-sub')[0], 404)
        self.assertEqual(self.call('GET', f'/v1/kehilot/{self.k}/admin/families/{fid}/tree', sub='other-gabbai-sub')[0], 404)

    # lazy migration and the children routes
    def add_child(self, name='Noa', **extra):
        return self.call('POST', f'{self.base()}/family/children', sub='member-sub',
                         body={'firstName': name, 'gender': 'f', 'birthDate': '2015-12-31', **extra})

    def test_children_migrate_lazily_with_same_ids(self):
        fid = self.family_id(self.member)
        child = {'id': 'C' * 26, 'firstName': 'Noa', 'gender': 'f', 'birthDate': '2015-12-31'}
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'F#{fid}'}, UpdateExpression='SET children = :c',
                                    ExpressionAttributeValues={':c': [child]})
        status, body = self.call('GET', self.tree(), sub='member-sub')
        (entry,) = body['people']
        self.assertEqual((status, entry['id'], entry['relation'], entry['hebrewFirst'], entry['gender']),
                         (200, child['id'], 'child', 'Noa', 'f'))
        self.assertEqual(entry['birth'], {'day': 19, 'month': 'tevet', 'year': 5776})
        self.assertEqual(self.call('GET', f'{self.base()}/family', sub='member-sub')[1]['children'], [child])

    def test_children_routes_edit_people_once_it_exists(self):
        _, got = self.call('GET', self.tree(), sub='member-sub')
        people = basic()
        self.put(people, got['version'])
        status, child = self.add_child('Dina')
        self.assertEqual(status, 201)
        family = self.repo.get_family(self.k, self.family_id(self.member))
        self.assertNotIn('children', family)
        by_id = {p['id']: p for p in family['people']}
        self.assertEqual((by_id[child['id']]['relation'], by_id[child['id']]['hebrewFirst']), ('child', 'Dina'))
        view = self.call('GET', f'{self.base()}/family', sub='member-sub')[1]
        self.assertEqual(sorted(c['firstName'] for c in view['children']), ['Dina', 'נועם'])
        # edit keeps the figure, spouse and grandchild of the existing child
        self.assertEqual(self.call('PUT', f'{self.base()}/family/children/{pid(3)}', sub='member-sub',
                                   body={'firstName': 'Nadav', 'gender': 'm'})[0], 200)
        after = {p['id']: p for p in self.repo.get_family(self.k, self.family_id(self.member))['people']}
        self.assertEqual((after[pid(3)]['hebrewFirst'], after[pid(3)]['figure']['kippah']), ('Nadav', 'knitted'))
        self.assertEqual(after[pid(3)]['barMitzvah']['parasha'], 'בהעלותך')
        self.assertIn(pid(5), after)
        # delete takes the child's spouse and grandchildren with it
        self.assertEqual(self.call('DELETE', f'{self.base()}/family/children/{pid(3)}', sub='member-sub')[0], 204)
        left = {p['id'] for p in self.repo.get_family(self.k, self.family_id(self.member))['people']}
        self.assertEqual(left, {S, SP, pid(1), pid(2), child['id']})
        self.assertEqual(self.call('DELETE', f'{self.base()}/family/children/{pid(3)}', sub='member-sub')[0], 404)

    def test_children_limit_counts_tree_children(self):
        _, got = self.call('GET', self.tree(), sub='member-sub')
        kids = [person(100 + n, 'child') for n in range(20)]
        self.put([basic()[0]] + kids, got['version'])
        self.assertEqual(self.add_child(), (409, {'error': 'children_limit'}))

    def test_old_child_routes_without_tree_still_use_children(self):
        self.add_child()
        family = self.repo.get_family(self.k, self.family_id(self.member))
        self.assertNotIn('people', family)
        self.assertEqual(len(family['children']), 1)

    def test_unchanged_birth_date_is_not_rewritten(self):
        _, got = self.call('GET', self.tree(), sub='member-sub')
        _, child = self.add_child()
        _, tree = self.call('GET', self.tree(), sub='member-sub')
        people = tree['people'] + [{'id': S, 'relation': 'self', 'gender': 'm'}]
        people[0]['birth'] = {'day': 1, 'month': 'nisan'}  # a yearless Hebrew birthday
        self.assertEqual(self.put(people, tree['version'])[0], 200)
        # an old client sends the child back without a birth date: the yearless Hebrew birthday survives
        self.call('PUT', f'{self.base()}/family/children/{child["id"]}', sub='member-sub',
                  body={'firstName': 'Noa2', 'gender': 'f'})
        entry = next(p for p in self.repo.get_family(self.k, self.family_id(self.member))['people']
                     if p['id'] == child['id'])
        self.assertEqual((entry['hebrewFirst'], entry['birth']), ('Noa2', {'day': 1, 'month': 'nisan'}))

    # link, unlink, deletion, export
    def save_tree(self, sub, user, people):
        _, got = self.call('GET', self.tree(), sub=sub)
        self.assertEqual(self.put(people, got['version'], sub=sub)[0], 200)

    def linked_pair(self):
        a = [{'id': S, 'relation': 'self', 'gender': 'm', 'hebrewFirst': 'ישראל', 'surname': 'ישראלי', 'tribe': 'levi'},
             person(1, 'father', of=S, hebrewFirst='יוסף'), person(2, 'mother', of=S, gender='f', hebrewFirst='שרה'),
             person(3, 'child', hebrewFirst='נועם'), person(5, 'grandchild', of=pid(3), hebrewFirst='ינון')]
        b_self = 'B' * 26
        b = [{'id': b_self, 'relation': 'self', 'gender': 'f', 'hebrewFirst': 'דוגמה'},
             person(11, 'father', of=b_self, hebrewFirst='אברהם'), person(13, 'child', hebrewFirst='ניסיון'),
             {'id': 'X' * 26, 'relation': 'spouse', 'of': b_self, 'gender': 'm', 'hebrewFirst': 'ישראל', 'surname': 'מילוי'},
             person(21, 'father', of='X' * 26, hebrewFirst='לא-נשמר')]
        self.save_tree('member-sub', self.member, a)
        self.save_tree('quiet-sub', self.quiet, b)
        self.repo.link(self.k, self.member, self.quiet)
        return b_self

    def test_user_ids_are_server_managed(self):
        _, got = self.call('GET', self.tree(), sub='member-sub')
        forged = basic()
        forged[0]['userId'] = self.quiet
        forged[1]['userId'] = self.member
        self.assertEqual(self.put(forged, got['version'])[0], 200)
        people = self.call('GET', self.tree(), sub='member-sub')[1]['people']
        self.assertEqual([(p['relation'], p.get('userId')) for p in people if p['relation'] in ('self', 'spouse')],
                         [('self', self.member), ('spouse', None)])
        _, got = self.call('GET', self.tree(), sub='member-sub')
        self.assertEqual(self.put(basic(), got['version'])[0], 200)  # a client that omits them does not erase them
        self.assertEqual(self.call('GET', self.tree(), sub='member-sub')[1]['people'][0]['userId'], self.member)

    def test_second_adult_takes_the_spouse_slot(self):
        self.repo.link(self.k, self.member, self.quiet)
        self.save_tree('member-sub', self.member, basic())
        ids = {p['relation']: p.get('userId') for p in self.call('GET', self.tree(), sub='quiet-sub')[1]['people']
               if p['relation'] in ('self', 'spouse')}
        self.assertEqual(ids, {'self': self.member, 'spouse': self.quiet})
        _, got = self.call('GET', self.tree(), sub='quiet-sub')
        self.assertEqual(self.put(basic(), got['version'], sub='quiet-sub')[0], 200)
        ids = {p['relation']: p.get('userId') for p in self.call('GET', self.tree(), sub='quiet-sub')[1]['people']
               if p['relation'] in ('self', 'spouse')}
        self.assertEqual(ids, {'self': self.member, 'spouse': self.quiet})

    def test_link_merges_the_trees_and_unlink_gives_each_their_own_lineage(self):
        b_self = self.linked_pair()
        merged = self.call('GET', self.tree(), sub='member-sub')[1]['people']
        by = {p['id']: p for p in merged}
        self.assertEqual(set(by), {S, pid(1), pid(2), pid(3), pid(5), b_self, pid(11), pid(13)})
        self.assertEqual((by[S]['userId'], by[S]['surname'], by[b_self]['relation'], by[b_self]['userId']),
                         (S and self.member, 'ישראלי', 'spouse', self.quiet))
        self.assertEqual(by[pid(1)]['hebrewFirst'], 'יוסף')
        self.assertIsNone(code(merged))
        self.assertNotIn('children', self.repo.get_family(self.k, self.family_id(self.member)))
        self.repo.unlink(self.k, self.quiet)
        mine = {p['id']: p for p in self.call('GET', self.tree(), sub='quiet-sub')[1]['people']}
        self.assertEqual(set(mine), {b_self, S, pid(11), pid(3), pid(5), pid(13)})
        self.assertEqual((mine[b_self]['relation'], mine[S]['relation'], mine[S]['of']), ('self', 'spouse', b_self))
        self.assertEqual((mine[S]['fatherName'], mine[S]['motherName'], mine[S]['surname']), ('יוסף', 'שרה', 'ישראלי'))
        self.assertNotIn('userId', mine[S])
        theirs = {p['id']: p for p in self.call('GET', self.tree(), sub='member-sub')[1]['people']}
        self.assertEqual(set(theirs), {S, b_self, pid(1), pid(2), pid(3), pid(5), pid(13)})
        self.assertEqual((theirs[b_self]['relation'], theirs[b_self]['fatherName']), ('spouse', 'אברהם'))
        self.assertIsNone(code(list(mine.values())))
        self.assertIsNone(code(list(theirs.values())))

    def test_leaving_adult_takes_their_lineage_and_leaves_names_only(self):
        self.linked_pair()
        self.repo.drop_adult(self.k, self.member)  # leaves the Kehila or deletes the account
        remaining = self.call('GET', self.tree(), sub='quiet-sub')[1]['people']
        by = {p['relation'] if p['relation'] not in ('child', 'father') else p['id']: p for p in remaining}
        self.assertEqual(by['self']['hebrewFirst'], 'דוגמה')
        self.assertEqual((by['spouse']['hebrewFirst'], by['spouse']['fatherName']), ('ישראל', 'יוסף'))
        self.assertEqual({p['hebrewFirst'] for p in remaining if p['relation'] == 'father'}, {'אברהם'})
        self.assertNotIn('יוסף', [p.get('hebrewFirst') for p in remaining])
        self.assertIsNone(code(remaining))

    def test_removed_member_is_404_and_big_trees_are_refused(self):
        _, got = self.call('GET', self.tree(), sub='member-sub')
        big = [basic()[0]] + [person(100 + n, 'child', hebrewFirst='א' * 40, surname='ב' * 40, fatherName='ג' * 40,
                                    motherName='ד' * 40) for n in range(20)]
        self.assertEqual(self.put(big, got['version'])[0], 200)
        huge = {'people': [{**basic()[0], 'surname': 'x' * 400_000}], 'ifVersion': 1}
        self.assertEqual(self.call('PUT', self.tree(), sub='member-sub', body=huge), (400, {'error': 'invalid_body'}))
        self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.member}'})
        self.assertEqual(self.call('GET', self.tree(), sub='member-sub')[0], 404)

    def test_link_of_legacy_families_still_merges_children(self):
        self.add_child('Noa')
        self.call('POST', f'{self.base()}/family/children', sub='quiet-sub', body={'firstName': 'Ben', 'gender': 'm'})
        self.repo.link(self.k, self.member, self.quiet)
        view = self.call('GET', f'{self.base()}/family', sub='member-sub')[1]
        self.assertEqual(sorted(c['firstName'] for c in view['children']), ['Ben', 'Noa'])

    def test_tree_leaves_with_the_last_adult(self):
        self.save_tree('member-sub', self.member, basic())
        self.repo.drop_adult(self.k, self.member)
        self.assertEqual(self.repo._query_prefix(self.k, 'F#'), [])

    def test_export_includes_the_tree(self):
        self.save_tree('member-sub', self.member, basic())
        out = export._family(self.repo, self.k, {**self.repo.get_membership(self.k, self.member), 'userId': self.member})
        self.assertEqual(plain(out['tree']), basic())
        self.repo.ensure_family(self.k, self.quiet)
        legacy = export._family(self.repo, self.k, {**self.repo.get_membership(self.k, self.quiet), 'userId': self.quiet})
        self.assertEqual(legacy['tree'], [])

    def test_admin_families_children_come_from_the_tree(self):
        self.save_tree('member-sub', self.member, basic())
        rows = self.call('GET', f'{self.base()}/admin/families', sub='gabbai-sub')[1]
        (row,) = [r for r in rows if r['adults'][0]['userId'] == self.member]
        self.assertEqual(row['children'], [{'firstName': 'נועם', 'gender': 'm'}])


class MergeTest(test_messages.unittest.TestCase):
    A, B = 'A' * 26, 'B' * 26

    def merge(self, keep, moved, keep_user=None, moved_user=None):
        return tree_rules.merge_people(keep, moved, keep_user, moved_user)

    def side(self, who, *rest):
        return [{'id': who, 'relation': 'self', 'gender': 'm' if who == self.A else 'f', 'hebrewFirst': who[0]}, *rest]

    def by_id(self, people):
        return {p['id']: p for p in people}

    def test_moved_self_becomes_spouse_with_its_parents(self):
        keep = self.side(self.A, person(1, 'father', of=self.A, hebrewFirst='אב'))
        moved = self.side(self.B, person(2, 'mother', of=self.B, gender='f', hebrewFirst='אם'),
                          {'id': pid(3), 'relation': 'spouse', 'of': self.B, 'gender': 'm'},
                          person(4, 'father', of=pid(3)))
        out = self.by_id(self.merge(keep, moved))
        self.assertEqual(set(out), {self.A, self.B, pid(1), pid(2)})
        self.assertEqual((out[self.B]['relation'], out[self.B]['of'], out[pid(2)]['of']), ('spouse', self.A, self.B))
        self.assertIsNone(code(list(out.values())))

    def test_compatible_spouse_figure_absorbs_the_moved_self(self):
        keep = self.side(self.A, {'id': pid(9), 'relation': 'spouse', 'of': self.A, 'gender': 'f', 'hebrewFirst': 'B',
                                  'surname': 'הוקלד'},
                         person(1, 'mother', of=pid(9), gender='f', hebrewFirst='קיים'))
        moved = self.side(self.B, person(2, 'mother', of=self.B, gender='f', hebrewFirst='אחרת'),
                          person(3, 'father', of=self.B, hebrewFirst='אב'), person(4, 'father', of=pid(3)))
        out = self.merge(keep, moved)
        by = self.by_id(out)
        self.assertNotIn(self.B, by)
        self.assertEqual(by[pid(9)]['surname'], 'הוקלד')   # filled by the partner, kept
        self.assertEqual((by[pid(1)]['hebrewFirst'], pid(2) in by), ('אחרת', False))  # same slot: the moved user's own mother wins
        self.assertEqual((by[pid(3)]['of'], by[pid(4)]['of']), (pid(9), pid(3)))
        self.assertIsNone(code(out))

    def test_moved_users_own_values_win_for_their_figure(self):
        keep = self.side(self.A, {'id': pid(9), 'relation': 'spouse', 'of': self.A, 'gender': 'f', 'hebrewFirst': 'ב',
                                  'surname': 'שגוי'})
        moved = self.side(self.B, person(2, 'mother', of=self.B, gender='f', hebrewFirst='אם'))
        moved[0].update(hebrewFirst='ב', surname='נכון')
        out = self.by_id(self.merge(keep, moved))
        self.assertEqual((out[pid(9)]['surname'], out[pid(2)]['of']), ('נכון', pid(9)))

    def test_contradicting_or_deceased_spouse_becomes_former_spouse(self):
        for spouse in ({'hebrewFirst': 'רחל', 'deceased': True}, {'hebrewFirst': 'רחל'}, {'hebrewFirst': 'B', 'deceased': True},
                       {'hebrewFirst': 'B', 'gender': 'm'}):
            keep = self.side(self.A, {'id': pid(9), 'relation': 'spouse', 'of': self.A, 'gender': 'f', **spouse},
                             person(1, 'mother', of=pid(9), gender='f', hebrewFirst='אמה'))
            moved = self.side(self.B, person(2, 'mother', of=self.B, gender='f', hebrewFirst='אחרת'))
            out = self.merge(keep, moved)
            by = self.by_id(out)
            self.assertEqual((by[pid(9)]['relation'], by[pid(9)]['of'], by[pid(9)]['motherName']), ('formerSpouse', self.A, 'אמה'), spouse)
            self.assertNotIn(pid(1), by)  # a former spouse's lineage is kept as text only
            self.assertEqual((by[self.B]['relation'], by[pid(2)]['of']), ('spouse', self.B))
            self.assertNotIn('userId', by[pid(9)])
            self.assertIsNone(code(out))

    def test_moved_figure_of_the_kept_user_merges_into_kept_self(self):
        keep = self.side(self.A, person(1, 'father', of=self.A, hebrewFirst='אביו'))
        moved = self.side(self.B, {'id': pid(3), 'relation': 'spouse', 'of': self.B, 'gender': 'm', 'hebrewFirst': 'A',
                                   'surname': 'מילוי'},
                          person(4, 'father', of=pid(3), hebrewFirst='אחר'), person(5, 'mother', of=pid(3), gender='f', hebrewFirst='אמו'))
        out = self.by_id(self.merge(keep, moved, 'ka', 'mb'))
        self.assertEqual((out[self.A]['surname'], out[self.A]['userId'], out[self.B]['userId']), ('מילוי', 'ka', 'mb'))
        self.assertEqual((out[pid(1)]['hebrewFirst'], out[pid(5)]['of']), ('אביו', self.A))
        self.assertNotIn(pid(3), out)

    def widow_moved(self, **spouse):
        late = {'id': pid(3), 'relation': 'spouse', 'of': self.B, 'gender': 'm', 'hebrewFirst': 'משה', 'surname': 'כהן',
                'tribe': 'kohen', 'deceased': True, 'death': {'day': 3, 'month': 'adar_ii', 'year': 5784}, **spouse}
        return self.side(self.B, late, person(4, 'father', of=pid(3), hebrewFirst='אביו'),
                         person(5, 'mother', of=pid(3), gender='f', hebrewFirst='אמו'))

    def test_late_partner_of_the_moved_user_does_not_become_the_kept_user(self):
        keep = self.side(self.A, person(1, 'father', of=self.A, hebrewFirst='יוסף'))
        keep[0].update(hebrewFirst='ישראל')
        out = self.merge(keep, self.widow_moved(), 'ka', 'mb')
        by = self.by_id(out)
        me = by[self.A]
        self.assertEqual((me['hebrewFirst'], me.get('deceased'), me.get('death'), me.get('tribe'), me.get('surname')),
                         ('ישראל', None, None, None, None))
        self.assertEqual(by[pid(1)]['hebrewFirst'], 'יוסף')
        self.assertNotIn(pid(4), by)  # no ancestors of a figure that did not match
        self.assertNotIn(pid(5), by)
        former = by[pid(3)]
        self.assertEqual((former['relation'], former['of'], former['deceased'], former['fatherName'], former['motherName']),
                         ('formerSpouse', self.A, True, 'אביו', 'אמו'))
        self.assertNotIn('death', former)
        self.assertIsNone(code(out))

    def test_gender_mismatch_carries_no_lineage_into_the_kept_self(self):
        keep = self.side(self.A)
        moved = self.side(self.B, {'id': pid(3), 'relation': 'spouse', 'of': self.B, 'gender': 'f', 'hebrewFirst': 'A'},
                          person(4, 'father', of=pid(3), hebrewFirst='אביה'),
                          person(5, 'mother', of=pid(3), gender='f', hebrewFirst='אמה'))
        by = self.by_id(self.merge(keep, moved))
        self.assertEqual({p['relation'] for p in by.values() if p.get('of') == self.A}, {'formerSpouse', 'spouse'})
        self.assertNotIn(pid(4), by)
        self.assertNotIn(pid(5), by)

    def test_matching_figure_still_merges_when_it_passes_the_test(self):
        keep = self.side(self.A)
        moved = self.side(self.B, {'id': pid(3), 'relation': 'spouse', 'of': self.B, 'gender': 'm', 'surname': 'מילוי'},
                          person(4, 'father', of=pid(3), hebrewFirst='אביו'))
        by = self.by_id(self.merge(keep, moved))
        self.assertEqual((by[self.A]['surname'], by[pid(4)]['of']), ('מילוי', self.A))

    def test_failed_figure_is_dropped_when_the_former_slot_is_taken(self):
        keep = self.side(self.A, {'id': pid(20), 'relation': 'formerSpouse', 'of': self.A, 'gender': 'f',
                                  'hebrewFirst': 'דינה', 'surname': 'לוי'})
        by = self.by_id(self.merge(keep, self.widow_moved()))
        self.assertEqual([p['hebrewFirst'] for p in by.values() if p['relation'] == 'formerSpouse'], ['דינה'])
        self.assertNotIn(pid(3), by)
        self.assertNotIn(pid(4), by)

    def test_two_different_former_spouses_are_never_folded(self):
        keep = self.side(self.A, {'id': pid(20), 'relation': 'formerSpouse', 'of': self.A, 'gender': 'f',
                                  'hebrewFirst': 'רחל', 'deceased': True},
                         {'id': pid(9), 'relation': 'spouse', 'of': self.A, 'gender': 'f', 'hebrewFirst': 'דינה', 'surname': 'לוי'})
        moved = self.side(self.B, person(2, 'mother', of=self.B, gender='f', hebrewFirst='אחרת'))
        out = self.merge(keep, moved)
        (former,) = [p for p in out if p['relation'] == 'formerSpouse']
        self.assertEqual((former['hebrewFirst'], former.get('surname'), former['deceased']), ('רחל', None, True))
        self.assertNotIn(pid(9), {p['id'] for p in out})
        self.assertIsNone(code(out))

    def test_moved_former_spouse_is_carried_when_the_slot_is_free(self):
        keep = self.side(self.A)
        moved = self.side(self.B, {'id': pid(20), 'relation': 'formerSpouse', 'of': self.B, 'gender': 'm',
                                   'hebrewFirst': 'אחר', 'birth': {'day': 1, 'month': 'nisan'}})
        out = self.merge(keep, moved)
        (former,) = [p for p in out if p['relation'] == 'formerSpouse']
        self.assertEqual((former['hebrewFirst'], former['of']), ('אחר', self.A))
        self.assertNotIn('birth', former)
        self.assertIsNone(code(out))
        taken = self.side(self.A, {'id': pid(21), 'relation': 'formerSpouse', 'of': self.A, 'gender': 'f', 'hebrewFirst': 'קיימת'})
        (former,) = [p for p in self.merge(taken, moved) if p['relation'] == 'formerSpouse']
        self.assertEqual(former['hebrewFirst'], 'קיימת')

    def test_colliding_ids_are_replaced(self):
        keep = self.side(self.A, person(1, 'father', of=self.A), person(2, 'child', hebrewFirst='נועם'))
        moved = [{'id': self.A, 'relation': 'self', 'gender': 'f', 'hebrewFirst': 'ב'},
                 person(1, 'father', of=self.A, hebrewFirst='אב'), person(2, 'child', hebrewFirst='אחר'),
                 person(3, 'grandchild', of=pid(2), hebrewFirst='נכד')]
        out = self.merge(keep, moved)
        self.assertEqual(len({p['id'] for p in out}), len(out))
        self.assertIsNone(code(out))
        grand = next(p for p in out if p['relation'] == 'grandchild')
        self.assertEqual(next(p for p in out if p['id'] == grand['of'])['hebrewFirst'], 'אחר')
        spouse = next(p for p in out if p['relation'] == 'spouse')
        self.assertEqual(next(p for p in out if p['relation'] == 'father' and p['of'] == spouse['id'])['hebrewFirst'], 'אב')

    def test_two_child_spouses_are_folded(self):
        keep = self.side(self.A, person(1, 'child', hebrewFirst='נועם'),
                         person(2, 'childSpouse', of=pid(1), gender='f', hebrewFirst='שרה'))
        moved = self.side(self.B, person(11, 'child', hebrewFirst='נועם'),
                          person(12, 'childSpouse', of=pid(11), gender='f', hebrewFirst='שָׂרָה'),
                          person(13, 'childSpouse', of=pid(11), gender='f'))
        out = self.merge(keep, moved)
        self.assertEqual(len([p for p in out if p['relation'] == 'childSpouse']), 1)
        self.assertIsNone(code(out))

    def test_deceased_and_dates_never_contradict_after_a_merge(self):
        keep = self.side(self.A, person(1, 'father', of=self.A, birth={'day': 1, 'month': 'tishrei', 'year': 5700}))
        moved = self.side(self.B, person(2, 'father', of=self.B, deceased=True, death={'day': 1, 'month': 'tishrei', 'year': 5650}))
        spouse_moved = moved
        keep.append({'id': pid(9), 'relation': 'spouse', 'of': self.A, 'gender': 'f', 'hebrewFirst': 'B',
                     'birth': {'day': 1, 'month': 'tishrei', 'year': 5700}})
        moved[0].update(deceased=True, death={'day': 1, 'month': 'tishrei', 'year': 5650})
        self.assertIsNone(code(self.merge(keep, spouse_moved)))

    def test_same_children_merge_field_by_field(self):
        keep = self.side(self.A, person(1, 'child', hebrewFirst='נוֹעַם', birth={'day': 5, 'month': 'sivan'},
                                        barMitzvah={'date': '2026-06-13', 'parasha': 'א', 'manual': False}),
                         person(2, 'grandchild', of=pid(1), hebrewFirst='ינון'))
        moved = self.side(self.B, person(11, 'child', hebrewFirst='נועם', surname='ניסיון',
                                         birth={'day': 5, 'month': 'sivan', 'year': 5780}, tribe='yisrael',
                                         barMitzvah={'date': '2026-06-20', 'parasha': 'ב', 'manual': True}),
                          person(12, 'grandchild', of=pid(11), hebrewFirst='ינון', surname='דוגמה'),
                          person(13, 'grandchild', of=pid(11), hebrewFirst='אחר'),
                          person(14, 'childSpouse', of=pid(11), gender='f', hebrewFirst='ניסיון'))
        out = self.merge(keep, moved)
        by = self.by_id(out)
        kids = [p for p in out if p['relation'] == 'child']
        self.assertEqual(len(kids), 1)
        kid = kids[0]
        self.assertEqual((kid['id'], kid['hebrewFirst'], kid['surname'], kid['tribe']), (pid(1), 'נוֹעַם', 'ניסיון', 'yisrael'))
        self.assertEqual(kid['birth'], {'day': 5, 'month': 'sivan', 'year': 5780})  # the dated one
        self.assertTrue(kid['barMitzvah']['manual'])
        grands = sorted((p['id'], p['of'], p.get('surname')) for p in out if p['relation'] == 'grandchild')
        self.assertEqual(grands, [(pid(2), pid(1), 'דוגמה'), (pid(13), pid(1), None)])
        self.assertEqual([p['of'] for p in out if p['relation'] == 'childSpouse'], [pid(1)])
        self.assertIsNone(code(out))

    def test_both_filled_keeps_the_kept_users_value(self):
        keep = self.side(self.A, person(1, 'child', hebrewFirst='נועם', surname='ראשון', deceased=False))
        moved = self.side(self.B, person(11, 'child', hebrewFirst='נועם', surname='שני'))
        (kid,) = [p for p in self.merge(keep, moved) if p['relation'] == 'child']
        self.assertEqual(kid['surname'], 'ראשון')

    def test_same_name_contradicting_births_stay_separate(self):
        keep = self.side(self.A, person(1, 'child', hebrewFirst='נועם', birth={'day': 5, 'month': 'sivan', 'year': 5780}))
        moved = self.side(self.B, person(11, 'child', hebrewFirst='נועם', birth={'day': 5, 'month': 'sivan', 'year': 5783}),
                          person(12, 'child', hebrewFirst='נועם', gender='f'),
                          person(13, 'child', hebrewFirst='נועם', birth={'day': 6, 'month': 'sivan'}))
        out = self.merge(keep, moved)
        self.assertEqual(len([p for p in out if p['relation'] == 'child']), 4)

    def test_name_normalization(self):
        self.assertEqual(tree_rules.normalize_name('יוֹסֵף חַיִּים'), tree_rules.normalize_name('יוסף-חיים'))
        self.assertEqual(tree_rules.normalize_name('אברהם'), tree_rules.normalize_name('אברהמ'))
        self.assertEqual(tree_rules.normalize_name("ג'ו"), tree_rules.normalize_name('גו'))

    def test_over_a_limit_keeps_everything(self):
        keep = self.side(self.A, *[person(100 + n, 'child', hebrewFirst=f'א{"ב" * n}') for n in range(15)])
        moved = self.side(self.B, *[person(200 + n, 'child', hebrewFirst=f'ג{"ד" * n}') for n in range(15)])
        out = self.merge(keep, moved)
        self.assertEqual(len([p for p in out if p['relation'] == 'child']), 30)

    def test_legacy_children_on_either_side(self):
        kept = tree_rules.people_from_children([{'id': pid(1), 'firstName': 'נועה', 'gender': 'f', 'birthDate': '2015-12-31'}])
        moved = self.side(self.B, person(11, 'child', gender='f', hebrewFirst='נועה', figure={'skin': 1}),
                          person(12, 'child', hebrewFirst='בן'))
        out = self.merge(kept, moved)  # kept side has no self: the moved tree is the base
        self.assertEqual(self.by_id(out)[self.B]['relation'], 'self')
        kids = [p for p in out if p['relation'] == 'child']
        self.assertEqual(len(kids), 2)
        girl = next(p for p in kids if p['gender'] == 'f')
        self.assertEqual((girl['figure'], girl['birth']['year']), ({'skin': 1}, 5776))
        both = self.merge(kept, tree_rules.people_from_children(
            [{'id': pid(5), 'firstName': 'נועה', 'gender': 'f'}]))
        self.assertEqual(len(both), 1)


class PropertyTest(test_messages.unittest.TestCase):
    """Random pairs of valid trees: merge and split results are valid and lose nothing but by the documented rules."""
    NAMES = ['נועם', 'נוֹעַם', 'דן', 'שרה', 'שָׂרָה', 'יוסף חיים', 'יוסף-חיים', 'אברהם', 'אברהמ', 'רות', '']
    IDS = [f'id{n}' for n in range(8)]

    def hdate(self, rnd):
        if rnd.random() < 0.3:
            return None
        date_ = {'day': rnd.randint(1, 29), 'month': rnd.choice(['nisan', 'sivan', 'elul', 'tishrei', 'shevat'])}
        if rnd.random() < 0.7:
            date_['year'] = rnd.choice([5700, 5750, 5780])
        return date_

    def entry(self, rnd, ids, relation, gender, of=None):
        p = {'id': next(ids), 'relation': relation, 'gender': gender}
        if of:
            p['of'] = of
        name = rnd.choice(self.NAMES)
        if name:
            p['hebrewFirst'] = name
        if rnd.random() < 0.3:
            p['surname'] = rnd.choice(['ישראלי', 'דוגמה'])
        if gender == 'm' and rnd.random() < 0.3:
            p['tribe'] = rnd.choice(['kohen', 'levi', 'yisrael'])
        birth = self.hdate(rnd)
        if birth:
            p['birth'] = birth
        if relation in ('father', 'mother', 'spouse', 'formerSpouse') and rnd.random() < 0.3:
            p['deceased'] = True
            if rnd.random() < 0.5:
                p['death'] = {'day': 3, 'month': 'adar_ii', 'year': 5784}
        return p

    def tree(self, rnd, user, widowed=False):
        # ids come from a small shared pool so that two trees collide
        pool = iter(rnd.sample(self.IDS, len(self.IDS)) + [f'z{rnd.random()}'.replace('.', '') for _ in range(80)])
        me = self.entry(rnd, pool, 'self', rnd.choice('mf'))
        me['userId'] = user
        out = [me]

        def lineage(root, depth=0):
            for relation, gender in (('father', 'm'), ('mother', 'f')):
                if rnd.random() < (0.6 if depth < 2 else 0):
                    parent = self.entry(rnd, pool, relation, gender, root['id'])
                    out.append(parent)
                    lineage(parent, depth + 1)
        lineage(me)
        if rnd.random() < 0.8:
            spouse = self.entry(rnd, pool, 'spouse', rnd.choice('mf'), me['id'])
            if widowed and rnd.random() < 0.6:
                spouse.update(deceased=True, gender='m', tribe='kohen', surname='כהן')
            if rnd.random() < 0.6:
                spouse['userId'] = 'other-' + user
            out.append(spouse)
            lineage(spouse)
        if rnd.random() < 0.2:
            out.append(self.entry(rnd, pool, 'formerSpouse', rnd.choice('mf'), me['id']))
        for _ in range(rnd.randint(0, 4)):
            kid = self.entry(rnd, pool, 'child', rnd.choice('mf'))
            kid.pop('deceased', None)
            kid.pop('death', None)
            out.append(kid)
            if rnd.random() < 0.5:
                out.append(self.entry(rnd, pool, 'childSpouse', rnd.choice('mf'), kid['id']))
            for _ in range(rnd.randint(0, 2)):
                out.append(self.entry(rnd, pool, 'grandchild', rnd.choice('mf'), kid['id']))
        return out

    def valid(self, people):
        return tree_rules.validate_people(people, date(2026, 10, 28))

    def test_merge_and_split_stay_valid_and_keep_the_moved_users_data(self):
        import random
        for seed in range(400):
            rnd = random.Random(seed)
            keep, moved = self.tree(rnd, 'ka'), self.tree(rnd, 'mb', widowed=True)
            self.valid(keep)
            self.valid(moved)
            merged = tree_rules.merge_people(keep, moved, 'ka', 'mb')
            self.valid(merged)
            self.assertEqual(len({p['id'] for p in merged}), len(merged), seed)
            names = {tree_rules.normalize_name(p.get('hebrewFirst')) for p in merged}
            ms = next(p for p in moved if p['relation'] == 'self')
            if ms.get('hebrewFirst'):
                self.assertIn(tree_rules.normalize_name(ms['hebrewFirst']), names, seed)
            for p in moved:
                if p['relation'] in ('child',) and p.get('hebrewFirst'):
                    self.assertIn(tree_rules.normalize_name(p['hebrewFirst']), names, seed)
            for p in tree_rules._ancestors(moved, ms['id']):
                if p.get('hebrewFirst'):
                    self.assertIn(tree_rules.normalize_name(p['hebrewFirst']), names, seed)
            self.assertEqual(sum(1 for p in merged if p['relation'] == 'self'), 1)
            kept_self = next(p for p in keep if p['relation'] == 'self')
            me = next(p for p in merged if p['relation'] == 'self')
            for field in ('deceased', 'death'):  # a late partner of the moved user never becomes the kept user
                self.assertEqual(me.get(field), kept_self.get(field), seed)
            self.assertEqual(sum(1 for p in merged if p['relation'] == 'formerSpouse') <= 1, True)
            # now one of them leaves
            for leaver, stays in (('ka', 'mb'), ('mb', 'ka')):
                left, rest = tree_rules.split_people(merged, leaver, stays)
                self.valid(left)
                self.valid(rest)
                mine = next(p for p in left if p['relation'] == 'self')
                self.assertEqual(mine.get('userId'), leaver)
                self.assertNotIn('userId', next((p for p in left if p['relation'] == 'spouse'), {}))
                # the leaver's ancestors do not stay behind as figures
                gone = {p['id'] for p in tree_rules._ancestors(merged, mine['id'])}
                self.assertFalse(gone & {p['id'] for p in rest}, seed)
                kids = {p['id'] for p in merged if p['relation'] in tree_rules.CHILD_SIDE}
                self.assertEqual({p['id'] for p in left if p['relation'] in tree_rules.CHILD_SIDE}, kids)
                self.assertEqual({p['id'] for p in rest if p['relation'] in tree_rules.CHILD_SIDE}, kids)


@own_tests_only
@mock_aws
class TreeUpdatedAtTest(TreeRoutesTest):
    """`updatedAt` (Unix seconds) moves on every tree write and comes back from GET (the Me row's "updated d.m")."""
    def stamp(self, sub='member-sub'):
        return self.call('GET', self.tree(), sub=sub)[1]['updatedAt']

    def at(self, seconds):
        return patch('server.cloud.repo_families.time.time', return_value=seconds)

    def test_null_until_the_first_write_then_every_write_moves_it(self):
        self.assertIsNone(self.stamp())
        with self.at(1000):
            _, got = self.call('GET', self.tree(), sub='member-sub')
            self.assertEqual(self.put(basic(), got['version'])[0], 200)
        self.assertEqual(self.stamp(), 1000)
        with self.at(2000):
            self.assertEqual(self.add_child()[0], 201)
        self.assertEqual(self.stamp(), 2000)
        with self.at(3000):
            self.assertEqual(self.call('DELETE', f'{self.base()}/family/children/{pid(3)}', sub='member-sub')[0], 204)
        self.assertEqual(self.stamp(), 3000)

    def test_a_failed_save_does_not_move_it(self):
        with self.at(1000):
            _, got = self.call('GET', self.tree(), sub='member-sub')
            self.put(basic(), got['version'])
        with self.at(2000):
            self.assertEqual(self.put(basic(), got['version'])[0], 409)
        self.assertEqual(self.stamp(), 1000)

    def test_link_merge_and_unlink_move_it_and_the_gabbai_read_has_it(self):
        self.save_tree('member-sub', self.member, basic())
        self.save_tree('quiet-sub', self.quiet, [basic()[0]])
        with self.at(5000):
            self.repo.link(self.k, self.member, self.quiet)
        self.assertEqual(self.stamp(), 5000)
        with self.at(6000):
            self.repo.unlink(self.k, self.quiet)
        self.assertEqual(self.stamp('member-sub'), 6000)
        self.assertEqual(self.stamp('quiet-sub'), 6000)
        status, body = self.call('GET', f'{self.base()}/admin/families/{self.family_id(self.member)}/tree', sub='gabbai-sub')
        self.assertEqual((status, body['updatedAt']), (200, 6000))
