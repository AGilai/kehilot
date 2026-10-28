"""Family tree storage (UX-DESIGN 17.5): validation, versioned writes, gabbai read, children migration."""
from datetime import date, timedelta

from moto import mock_aws

from server.cloud import export, tree_rules
from server.cloud.errors import ApiError
from server.tests.cloud import test_messages
from server.tests.cloud.test_groups import own_tests_only

TODAY = date(2026, 10, 28)
S, SP = 'S' * 26, 'P' * 26


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

    def test_empty_tree_then_save_and_read(self):
        status, body = self.call('GET', self.tree(), sub='member-sub')
        self.assertEqual((status, body['people']), (200, []))
        status, saved = self.put(basic(), body['version'])
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved['version'], body['version'] + 1)
        self.assertEqual(self.call('GET', self.tree(), sub='member-sub'),
                         (200, {'people': basic(), 'version': saved['version']}))

    def test_stale_if_version_is_409_and_nothing_changes(self):
        _, first = self.call('GET', self.tree(), sub='member-sub')
        self.assertEqual(self.put(basic(), first['version'])[0], 200)
        other = basic()
        other[0]['hebrewFirst'] = 'אחר'
        self.assertEqual(self.put(other, first['version']), (409, {'error': 'version_conflict'}))
        self.assertEqual(self.call('GET', self.tree(), sub='member-sub')[1]['people'], basic())

    def test_two_adults_share_one_tree(self):
        self.repo.link(self.k, self.member, self.quiet)
        _, got = self.call('GET', self.tree(), sub='member-sub')
        self.assertEqual(self.put(basic(), got['version'])[0], 200)
        self.assertEqual(self.call('GET', self.tree(), sub='quiet-sub')[1]['people'], basic())

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
        self.assertEqual((status, body['people']), (200, basic()))
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

    def test_link_keeps_both_trees_children_and_unlink_copies_them(self):
        a = [{'id': S, 'relation': 'self', 'gender': 'm', 'hebrewFirst': 'ישראל'},
             person(1, 'father', of=S, hebrewFirst='יוסף'), person(3, 'child', hebrewFirst='נועם'),
             person(5, 'grandchild', of=pid(3), hebrewFirst='ינון')]
        b_self = 'B' * 26
        b = [{'id': b_self, 'relation': 'self', 'gender': 'f', 'hebrewFirst': 'דוגמה'},
             person(11, 'father', of=b_self, hebrewFirst='אברהם'), person(13, 'child', hebrewFirst='ניסיון'),
             {'id': 'X' * 26, 'relation': 'spouse', 'of': b_self, 'gender': 'm', 'hebrewFirst': 'לא'},
             person(21, 'father', of='X' * 26, hebrewFirst='לא-נשמר')]
        self.save_tree('member-sub', self.member, a)
        self.save_tree('quiet-sub', self.quiet, b)
        self.repo.link(self.k, self.member, self.quiet)
        _, merged = self.call('GET', self.tree(), sub='member-sub')
        people = {p['id']: p for p in merged['people']}
        self.assertEqual(set(people), {S, pid(1), pid(3), pid(5), b_self, pid(11), pid(13)})
        self.assertEqual((people[b_self]['relation'], people[b_self]['of']), ('spouse', S))
        self.assertIsNone(code(merged['people']))
        self.assertNotIn('children', self.repo.get_family(self.k, self.family_id(self.member)))
        self.repo.unlink(self.k, self.quiet)
        copy = self.call('GET', self.tree(), sub='quiet-sub')[1]['people']
        self.assertEqual({p['id'] for p in copy}, {pid(3), pid(5), pid(13)})
        self.assertEqual(len(self.call('GET', self.tree(), sub='member-sub')[1]['people']), 7)

    def test_link_of_legacy_families_still_merges_children(self):
        self.add_child('Noa')
        self.call('POST', f'{self.base()}/family/children', sub='quiet-sub', body={'firstName': 'Ben', 'gender': 'm'})
        self.repo.link(self.k, self.member, self.quiet)
        view = self.call('GET', f'{self.base()}/family', sub='member-sub')[1]
        self.assertEqual(sorted(c['firstName'] for c in view['children']), ['Ben', 'Noa'])

    def test_tree_leaves_with_the_last_adult_and_stays_with_the_other(self):
        self.repo.link(self.k, self.member, self.quiet)
        self.save_tree('member-sub', self.member, basic())
        self.repo.drop_adult(self.k, self.member)
        self.assertEqual(self.call('GET', self.tree(), sub='quiet-sub')[1]['people'], basic())
        self.repo.drop_adult(self.k, self.quiet)
        self.assertEqual(self.repo._query_prefix(self.k, 'F#'), [])

    def test_export_includes_the_tree(self):
        self.save_tree('member-sub', self.member, basic())
        out = export._family(self.repo, self.k, {**self.repo.get_membership(self.k, self.member), 'userId': self.member})
        self.assertEqual(out['tree'], basic())
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

    def merge(self, keep, moved):
        return tree_rules.merge_people(keep, moved, tree_rules.self_id_of(keep), tree_rules.self_id_of(moved))

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

    def test_existing_spouse_absorbs_the_moved_self(self):
        keep = self.side(self.A, {'id': pid(9), 'relation': 'spouse', 'of': self.A, 'gender': 'f', 'hebrewFirst': 'ב'},
                         person(1, 'mother', of=pid(9), gender='f', hebrewFirst='קיים'))
        moved = self.side(self.B, person(2, 'mother', of=self.B, gender='f', hebrewFirst='אחרת'),
                          person(3, 'father', of=self.B, hebrewFirst='אב'), person(4, 'father', of=pid(3)))
        out = self.merge(keep, moved)
        by = self.by_id(out)
        self.assertNotIn(self.B, by)
        self.assertEqual(by[pid(1)]['hebrewFirst'], 'קיים')  # ancestors are not merged
        self.assertNotIn(pid(2), by)
        self.assertEqual((by[pid(3)]['of'], by[pid(4)]['of']), (pid(9), pid(3)))
        self.assertIsNone(code(out))

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
