import json
from unittest import mock

from moto import mock_aws

from server.cloud import seating_link
from server.cloud.errors import ApiError
from server.cloud.ids import new_id

from server.tests.cloud import test_seatweek as sw
from server.tests.cloud.test_groups import own_tests_only
from server.tests.cloud.test_seatweek import WEEK, at, friday

PHONE = '+972501234567'


@own_tests_only
@mock_aws
class SeatLinkTest(sw.SeatWeekTest):
    """Link a seat holder (no account) to a registered family. Names are invented."""

    def setUp(self):
        super().setUp()
        self.profile(self.member, 'מיכל', 'בדיוני', PHONE)
        self.profile(self.quiet, 'נועם', 'ניסיון')
        self.call('PUT', f'{self.base()}/admin/seating/holders/{self.holder}', body={'name': 'חסר קשר'})

    def profile(self, user_id, first, last, phone=None):
        self.repo.put_profile(user_id, first, last, 'he')
        if phone:
            self.repo.set_phone(user_id, phone)

    def holder_named(self, name, **extra):
        status, body = self.call('POST', f'{self.base()}/admin/seating/holders', body={'name': name, **extra})
        self.assertEqual(status, 201, body)
        return body['holderId']

    def suggestions(self, sub='gabbai-sub'):
        return self.call('GET', f'{self.base()}/admin/seating/link-suggestions', sub=sub)

    def link(self, holder, family=None, sub='gabbai-sub', **extra):
        return self.call('POST', f'{self.base()}/admin/seating/holders/{holder}/link', sub=sub,
                         body={'familyId': family or self.fam, **extra})

    def of(self, holder):
        return [s for s in self.suggestions()[1]['suggestions'] if s['holderId'] == holder]

    def holders(self):
        return self.call('GET', f'{self.base()}/admin/seating/holders')[1]

    def cards(self, sub):
        return self.call('GET', self.base(), sub=sub)[1]['cards']

    def asg(self):
        return self.call('GET', f'{self.base()}/admin/seating/layouts/{friday()}/assignments')[1]['assignments']

    # suggestions
    def test_no_suggestion_for_an_unrelated_holder(self):
        self.assertEqual(self.suggestions(), (200, {'count': 0, 'suggestions': []}))

    def test_by_phone(self):
        h = self.holder_named('אלמוני אחר', phone=PHONE)
        (s,) = self.of(h)
        self.assertEqual((s['why'], s['level'], s['familyId'], s['holderName']), ('phone', 'likely', self.fam, 'אלמוני אחר'))
        self.assertEqual(s['familyName'], 'Mia Member')
        h2 = self.holder_named('בדיוני', phone='050-123-4567')  # same number written differently + same surname
        self.assertEqual([x['why'] for x in self.of(h2)], ['phone-surname'])

    def test_by_surname_and_initial(self):
        same = self.holder_named('בדיוני מ.')
        other = self.holder_named('בדיוני ש.')
        none = self.holder_named('בדיוני')
        self.assertEqual([(x['why'], x['level']) for x in self.of(same)], [('surname-initial', 'exact')])
        self.assertEqual([(x['why'], x['level']) for x in self.of(other)], [('surname-other-initial', 'likely')])
        self.assertEqual([(x['why'], x['level']) for x in self.of(none)], [('surname-only', 'likely')])
        order = [x['holderId'] for x in self.suggestions()[1]['suggestions']]
        self.assertEqual(order[0], same)  # the strongest first

    def test_a_deleted_holder_leaves_the_suggestions(self):
        h = self.holder_named('בדיוני מ.')
        self.assertEqual(len(self.of(h)), 1)
        self.assertEqual(self.call('DELETE', f'{self.base()}/admin/seating/holders/{h}'), (204, None))
        self.assertEqual(self.of(h), [])
        self.assertNotIn(h, [x['holderId'] for x in self.holders()])

    def test_initial_with_or_without_a_dot_and_prefix(self):
        for name in ('בדיוני מ', 'בדיוני מ.', "בדיוני מ'", 'משפחת בדיוני מ.', 'בית בדיוני מ.'):
            h = self.holder_named(name)
            self.assertEqual([x['why'] for x in self.of(h)], ['surname-initial'], name)

    def test_spelling_variants(self):
        self.profile(self.quiet, 'נועם', 'שטרנבורג')
        h = self.holder_named('שטרנברג')
        (s,) = self.of(h)
        self.assertEqual((s['why'], s['familyId']), ('spelling', self.other))
        self.profile(self.quiet, 'נועם', 'דוגמה')
        h2 = self.holder_named('דוגמא')
        self.assertEqual([x['why'] for x in self.of(h2)], ['spelling'])

    def test_spouse_initial_and_phone_match_either_adult(self):
        self.call('POST', f'{self.base()}/admin/families/link', body={'userIds': [self.member, self.quiet]})
        h = self.holder_named('בדיוני נ.')  # the spouse's initial
        self.assertEqual([x['why'] for x in self.of(h)], ['surname-initial'])

    def test_suggestion_marks_families_that_already_hold_seats(self):
        self.mine((5, 0))
        h = self.holder_named('בדיוני מ.')
        self.assertTrue(self.of(h)[0]['familyHoldsSeats'])

    def test_nothing_across_kehilot(self):
        k2 = self.repo.create_kehila('Beit Other', {})
        stranger = self.call('GET', '/v1/me', sub='stranger-sub')[1]['userId']
        self.repo.put_membership(k2, stranger, 'member')
        self.repo.ensure_family(k2, stranger)
        self.profile(stranger, 'מיכל', 'זרוני', '+972509999999')
        h = self.holder_named('זרוני מ.', phone='+972509999999')
        self.assertEqual(self.of(h), [])
        family = self.repo.ensure_family(k2, stranger)
        self.assertEqual(self.link(h, family), (404, {'error': 'family_not_found'}))
        self.assertEqual(len(self.holders()), 2)  # the holder is untouched

    def test_listeners_are_never_suggested(self):
        self.profile(self.listener, 'לאה', 'מאזין', '+972508888888')
        h = self.holder_named('מאזין ל.', phone='+972508888888')
        self.assertEqual(self.of(h), [])

    def test_approval_card_carries_count_and_top_items(self):
        for i in range(5):
            self.holder_named('מאזין ל.', phone='+972508888888' if i == 0 else None)
        self.profile(self.listener, 'לאה', 'מאזין', '+972508888888')
        self.assertEqual(self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')[0], 202)
        (row,) = self.call('GET', f'{self.base()}/admin/requests')[1]
        card = row['seatSuggestions']
        self.assertEqual(card['count'], 5)
        self.assertEqual(len(card['items']), 3)
        self.assertEqual(card['items'][0]['why'], 'phone-surname')
        self.assertEqual(set(card['items'][0]), {'holderId', 'holderName', 'why', 'level'})

    def test_approval_card_without_a_match_has_no_field(self):
        self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')
        (row,) = self.call('GET', f'{self.base()}/admin/requests')[1]
        self.assertNotIn('seatSuggestions', row)

    def test_gabbai_only(self):
        h = self.holder_named('בדיוני מ.')
        for sub in ('member-sub', 'quiet-sub', 'listener-sub'):
            self.assertEqual(self.suggestions(sub), (403, {'error': 'forbidden'}))
            self.assertEqual(self.link(h, sub=sub), (403, {'error': 'forbidden'}))
        self.assertEqual(len(self.holders()), 2)

    # link
    def test_link_unions_with_the_family_seats_and_deletes_the_holder(self):
        self.mine((3, 0))
        self.give(f'holder:{self.holder}', (4, 0), (5, 0))
        status, out = self.link(self.holder)
        self.assertEqual((status, out), (200, {'familyId': self.fam, 'seats': 2}))
        held = self.asg()
        self.assertEqual({s for s, r in held.items() if r == f'family:{self.fam}'},
                         {self.at[(3, 0)], self.at[(4, 0)], self.at[(5, 0)]})
        self.assertFalse(any(r.startswith('holder:') for r in held.values()))
        self.assertNotIn(self.holder, [h['holderId'] for h in self.holders()])
        self.assertIsNone(self.repo.get_holder(self.k, self.holder))
        self.assertEqual(self.me()[1]['seats'], 3)
        self.assertEqual(self.link(self.holder), (404, {'error': 'holder_not_found'}))

    def test_link_moves_future_versions_too(self):
        self.give(f'holder:{self.holder}', (4, 0))
        later = friday(2)
        status, out = self.call('PUT', f'{self.base()}/admin/seating/layouts/{later}', body={**sw.LAYOUT, 'ifUpdatedAt': None})
        self.assertEqual(status, 200)
        seat = {(s['row'], s['col']): s['id'] for s in out['seats']}[(4, 0)]
        self.call('PUT', f'{self.base()}/admin/seating/layouts/{later}/assignments',
                  body={'assignments': {seat: f'holder:{self.holder}'}, 'ifUpdatedAt': None})
        self.assertEqual(self.link(self.holder)[0], 200)
        got = self.call('GET', f'{self.base()}/admin/seating/layouts/{later}/assignments')[1]['assignments']
        self.assertEqual(got, {seat: f'family:{self.fam}'})

    def test_two_holders_one_family(self):
        second = self.holder_named('בדיוני מ.')
        self.mine((3, 0))
        self.give(f'holder:{self.holder}', (4, 0))
        self.give(f'holder:{second}', (6, 0), (7, 0))
        self.assertEqual(self.link(self.holder)[1]['seats'], 1)
        self.assertEqual(self.link(second)[1]['seats'], 2)
        self.assertEqual(sorted(set(self.asg().values())), [f'family:{self.fam}'])
        self.assertEqual(len(self.asg()), 4)
        self.assertEqual(self.holders(), [])
        self.assertEqual(self.me()[1]['seats'], 4)
        self.assertEqual(self.cards('member-sub')['seatLink']['seats'], 3)  # adds up until dismissed

    def test_open_week_answers_carry_over(self):
        self.give(f'holder:{self.holder}', (4, 0), (4, 1))
        self.assertEqual(self.gput({self.at[(4, 1)]: True})[0], 200)
        self.assertEqual(self.respond([{'household': f'holder:{self.holder}', 'released': 1,
                                        'requests': {'ברחבה': 2}}], 'day')[0], 200)
        before = self.admin_week()
        self.assertEqual(self.link(self.holder)[0], 200)
        week = self.admin_week()
        self.assertEqual({s: v['released'] for s, v in week['prayers']['erev']['seats'].items()},
                         {s: v['released'] for s, v in before['prayers']['erev']['seats'].items()})
        self.assertEqual(week['prayers']['day']['requests'], {f'family:{self.fam}': {'ברחבה': 2}})
        self.assertEqual(week['prayers']['erev']['seats'][self.at[(4, 1)]]['by'], 'gabbai')
        self.assertEqual(self.released(), {self.at[(4, 1)]})  # still counted: the record follows the family
        with self.now(at(9)):
            state = {c['state']['erev'] for f in self.me()[1]['frames'] for c in self.cells(f) if c['kind'] == 'mine'}
        self.assertEqual(state, {'kept', 'released'})
        self.assertTrue(self.admin_week()['prayers']['day']['canUndo'])
        self.assertEqual(self.undo('day')[0], 200)  # undo data follows too
        self.assertEqual(self.admin_week()['prayers']['day']['requests'], {})

    def test_notice_once_per_adult_and_dismissable(self):
        self.call('POST', f'{self.base()}/admin/families/link', body={'userIds': [self.member, self.quiet]})
        self.give(f'holder:{self.holder}', (4, 0), (4, 1))
        self.assertIsNone(self.cards('member-sub')['seatLink'])
        self.link(self.holder)
        for sub in ('member-sub', 'quiet-sub'):
            card = self.cards(sub)['seatLink']
            self.assertEqual(card['seats'], 2, sub)
        dismiss = f'{self.base()}/me/cards/seat_link/dismiss'
        self.assertEqual(self.call('POST', dismiss, sub='member-sub'), (204, None))
        self.assertIsNone(self.cards('member-sub')['seatLink'])
        self.assertEqual(self.cards('quiet-sub')['seatLink']['seats'], 2)  # each adult once
        self.assertEqual(self.call('POST', dismiss, sub='member-sub'), (204, None))  # idempotent
        self.assertEqual(self.call('POST', dismiss, sub='quiet-sub'), (204, None))
        self.assertIsNone(self.cards('quiet-sub')['seatLink'])
        self.assertEqual(self.call('POST', dismiss, sub='listener-sub')[0], 403)

    def test_gabbai_family_gets_the_card_too_and_others_do_not(self):
        self.give(f'holder:{self.holder}', (4, 0))
        self.link(self.holder)
        self.assertIsNone(self.cards('quiet-sub')['seatLink'])
        self.assertIsNone(self.cards('gabbai-sub')['seatLink'])

    def test_guard_and_validation(self):
        h = self.holder_named('בדיוני מ.')
        stored = self.repo.get_holder(self.k, h)['updatedAt']
        self.assertEqual(self.link(h, ifUpdatedAt=int(stored) - 1), (409, {'error': 'holder_changed'}))
        for body in ({}, {'familyId': 5}, {'familyId': 'nope'}, {'familyId': self.fam, 'x': 1},
                     {'familyId': self.fam, 'ifUpdatedAt': 'x'}, {'familyId': self.fam, 'ifUpdatedAt': True}):
            status, out = self.call('POST', f'{self.base()}/admin/seating/holders/{h}/link', body=body)
            self.assertEqual((status, out['error']), (400, 'invalid_body'), body)
        self.assertEqual(self.link(h, 'A' * 26), (404, {'error': 'family_not_found'}))
        self.assertEqual(self.link('B' * 26), (404, {'error': 'holder_not_found'}))
        self.assertEqual(self.link(h, ifUpdatedAt=int(stored))[0], 200)

    def test_nothing_is_linked_by_suggesting(self):
        h = self.holder_named('בדיוני מ.', phone=PHONE)
        self.suggestions()
        self.assertIsNotNone(self.repo.get_holder(self.k, h))
        self.assertEqual(self.cards('member-sub')['seatLink'], None)

    # carry-over from task 3
    def test_requests_are_stored_for_a_household_whose_answer_was_kept(self):
        self.three()
        ref = f'family:{self.fam}'
        with self.now(at(9)):
            self.put_me([1])
        status, out = self.respond([{'household': ref, 'released': 3, 'requests': {'ברחבה': 2, 'עזרת נשים': 1}}])
        self.assertEqual((status, out['warnings'], out['households']), (200, [{'household': ref, 'code': 'app_answer_kept'}], 0))
        self.assertEqual(out['requestTotals'], {'ברחבה': 2, 'עזרת נשים': 1})
        self.assertEqual(self.admin_week()['prayers']['erev']['requests'], {ref: {'ברחבה': 2, 'עזרת נשים': 1}})
        self.assertEqual(len(self.released()), 1)  # the seats stayed as the member left them
        self.assertEqual(self.undo()[0], 200)
        self.assertEqual(self.admin_week()['prayers']['erev']['requests'], {})

    # fix round 1
    def test_a_failed_rewrite_raises_and_keeps_the_holder(self):
        self.give(f'holder:{self.holder}', (4, 0))
        with mock.patch.object(self.repo, 'put_assignments', side_effect=ApiError(409, 'assignments_changed')):
            self.assertEqual(self.link(self.holder), (409, {'error': 'try_again'}))
        self.assertIsNotNone(self.repo.get_holder(self.k, self.holder))
        self.assertEqual(self.link(self.holder)[0], 200)  # a retry finishes
        self.assertEqual(self.asg(), {self.at[(4, 0)]: f'family:{self.fam}'})

    def test_holder_is_kept_while_a_ref_remains(self):
        self.give(f'holder:{self.holder}', (4, 0))
        with mock.patch.object(self.repo, 'move_holder_seats'):
            self.assertEqual(self.link(self.holder), (409, {'error': 'try_again'}))
        self.assertIsNotNone(self.repo.get_holder(self.k, self.holder))

    def test_notice_is_written_before_the_move_and_not_counted_twice(self):
        self.give(f'holder:{self.holder}', (4, 0), (4, 1))
        with mock.patch.object(self.repo, 'move_holder_seats', side_effect=ApiError(409, 'try_again')):
            self.assertEqual(self.link(self.holder)[0], 409)
        self.assertEqual(self.cards('member-sub')['seatLink']['seats'], 2)
        self.assertEqual(self.link(self.holder)[1]['seats'], 2)
        self.assertEqual(self.cards('member-sub')['seatLink']['seats'], 2)

    def test_no_notice_for_a_holder_without_seats(self):
        self.assertEqual(self.link(self.holder)[0], 200)
        self.assertIsNone(self.cards('member-sub')['seatLink'])

    def test_notice_counts_future_versions(self):
        later = friday(2)
        status, out = self.call('PUT', f'{self.base()}/admin/seating/layouts/{later}', body={**sw.LAYOUT, 'ifUpdatedAt': None})
        ids = {(s['row'], s['col']): s['id'] for s in out['seats']}
        self.call('PUT', f'{self.base()}/admin/seating/layouts/{later}/assignments', body={
            'assignments': {ids[(4, 0)]: f'holder:{self.holder}', ids[(4, 1)]: f'holder:{self.holder}',
                            ids[(5, 0)]: f'holder:{self.holder}'}, 'ifUpdatedAt': None})
        self.give(f'holder:{self.holder}', (4, 0))
        self.assertEqual(self.link(self.holder)[1]['seats'], 3)
        self.assertEqual(self.cards('member-sub')['seatLink']['seats'], 3)

    def test_holder_updated_at_is_ms_and_always_moves(self):
        h = self.holder_named('בדיוני מ.')
        first = self.repo.get_holder(self.k, h)['updatedAt']
        self.assertGreater(first, 10 ** 12)
        out = self.call('PUT', f'{self.base()}/admin/seating/holders/{h}', body={'name': 'בדיוני מ.'})[1]
        self.assertGreater(out['updatedAt'], first)
        self.assertEqual(self.link(h, ifUpdatedAt=first), (409, {'error': 'holder_changed'}))
        self.assertEqual(self.link(h, ifUpdatedAt=out['updatedAt'])[0], 200)

    def test_phone_digits_are_ascii_only(self):
        self.assertEqual(seating_link.digits('+972-50-1234567'), '501234567')
        self.assertEqual(seating_link.digits('٠٥٠١٢٣٤٥٦٧'), '')
        self.assertIsNone(seating_link.match({'name': 'אחר', 'phone': '٠٥٠١٢٣٤٥٦٧'}, {'lastName': 'x', 'phones': ['٠٥٠١٢٣٤٥٦٧']}))

    # review fixes
    def test_family_merge_keeps_the_weekly_records(self):
        seat = self.at[(4, 0)]
        self.mine((4, 0))
        old, new = f'family:{self.fam}', f'family:{self.other}'
        self.repo.change_week(self.k, WEEK, 'erev', lambda _: {
            'seats': {seat: {'r': 1, 'by': 'm', 'at': 5, 'h': old}}, 'requests': {old: {'ברחבה': 2}},
            'answered': {old: 7}})
        self.assertEqual(self.repo.link(self.k, self.quiet, self.member), self.other)
        item = self.repo.get_week(self.k, WEEK, 'erev')
        self.assertEqual(item['seats'][seat]['h'], new)
        self.assertEqual(item['requests'], {new: {'ברחבה': 2}})
        self.assertEqual(item['answered'], {new: 7})

    def test_rename_week_ref_moves_answered(self):
        self.repo.change_week(self.k, WEEK, 'day', lambda _: {'answered': {'holder:a': 3, 'family:z': 4}})
        self.repo.rename_week_ref(self.k, 'holder:a', 'family:b')
        self.assertEqual(self.repo.get_week(self.k, WEEK, 'day')['answered'], {'family:b': 3, 'family:z': 4})

    def test_delete_holder_keeps_the_holder_until_assignments_are_rewritten(self):
        self.give(f'holder:{self.holder}', (4, 0))
        with mock.patch.object(self.repo, '_rewrite_assignments', side_effect=ApiError(409, 'try_again')):
            self.assertEqual(self.call('DELETE', f'{self.base()}/admin/seating/holders/{self.holder}')[0], 409)
        self.assertIsNotNone(self.repo.get_holder(self.k, self.holder))
        self.assertEqual(self.call('DELETE', f'{self.base()}/admin/seating/holders/{self.holder}')[0], 204)
        self.assertEqual(self.asg(), {})

    def test_held_ignores_refs_to_vanished_holders(self):
        from types import SimpleNamespace
        from server.cloud import routes_seatweek
        self.give(f'holder:{self.holder}', (4, 0))
        self.mine((5, 0))
        self.repo.delete_holder_record(self.k, self.holder)
        layout = self.repo.layout_for(self.k, friday())
        held = routes_seatweek._held(SimpleNamespace(repo=self.repo), self.k, layout)
        self.assertEqual(held, {self.at[(5, 0)]: f'family:{self.fam}'})

    def test_clear_notice_makes_no_phantom_membership(self):
        self.repo.clear_seat_link_notice(self.k, 'ghost-user')
        self.assertIsNone(self.repo.get_membership(self.k, 'ghost-user'))

    def test_concurrent_notices_do_not_undercount(self):
        stale = self.repo.get_membership(self.k, self.member)
        with mock.patch.object(self.repo, 'get_membership', return_value=stale):
            self.repo.add_seat_link_notice(self.k, self.member, 'h1', 2, 100)
            self.repo.add_seat_link_notice(self.k, self.member, 'h2', 3, 101)
            self.repo.add_seat_link_notice(self.k, self.member, 'h2', 3, 102)  # retried: once
        self.assertEqual(self.cards('member-sub')['seatLink'], {'seats': 5, 'at': 101})
        self.repo.clear_seat_link_notice(self.k, self.member)
        self.assertIsNone(self.cards('member-sub')['seatLink'])
        self.repo.add_seat_link_notice(self.k, self.member, 'h1', 1, 103)
        self.assertEqual(self.cards('member-sub')['seatLink']['seats'], 1)

    def test_holder_update_cannot_resurrect_a_deleted_holder(self):
        item = self.repo.get_holder(self.k, self.holder)
        self.repo.delete_holder_record(self.k, self.holder)
        with self.assertRaises(ApiError) as caught:
            self.repo.put_holder(self.k, self.holder, 'x', None, item['createdAt'], item['updatedAt'])
        self.assertEqual(caught.exception.status, 404)
        self.assertIsNone(self.repo.get_holder(self.k, self.holder))

    def test_full_apply_stays_small(self):
        from server.cloud.seating_rules import MAX_COLS, MAX_ROWS
        cells = [['seat'] * MAX_COLS for _ in range(MAX_ROWS)]
        out = self.call('PUT', f'{self.base()}/admin/seating/layouts/{friday(3)}', body={
            'rows': MAX_ROWS, 'cols': MAX_COLS, 'cells': cells, 'blocks': [{'name': 'כל', 'colStart': 0, 'colEnd': MAX_COLS - 1}],
            'rowLabels': [str(i) for i in range(MAX_ROWS)], 'ifUpdatedAt': None})[1]
        ids = [s['id'] for s in out['seats']]
        self.assertEqual(len(ids), 2400)
        week = friday(3)
        holders = [self.repo.put_holder(self.k, new_id(), f'בעל {i}', None)['holderId'] for i in range(600)]
        asg = {sid: f'holder:{holders[i // 4]}' for i, sid in enumerate(ids)}
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/seating/layouts/{week}/assignments',
                                   body={'assignments': asg, 'ifUpdatedAt': None})[0], 200)
        for count in (4, 0):  # release everything, then keep everything: the undo holds the whole previous state
            rows = [{'household': f'holder:{h}', 'released': count} for h in holders]
            with self.now(at(9, week=week)):
                status, body = self.call('POST', f'{self.base()}/admin/seats/week/{week}/responses',
                                         body={'event': 'erev', 'rows': rows})
            self.assertEqual(status, 200, body)
        item = self.repo.get_week(self.k, week, 'erev')
        size = len(json.dumps(item, ensure_ascii=False).encode())
        self.assertLess(size, 350 * 1024, size)
