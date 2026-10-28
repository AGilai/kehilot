import copy
import json
from datetime import datetime
from unittest import mock
from zoneinfo import ZoneInfo

from moto import mock_aws

from server.cloud import routes_seatweek
from server.tests.cloud import test_messages
from server.tests.cloud.test_groups import own_tests_only
from server.tests.cloud.test_seating import friday

S, A, B, K, E = 'seat', 'aisle', 'bimah', 'ark', 'empty'
ROWS, COLS = 14, 7
CELLS = [[K] * COLS] + [[S, S, A, S, S, S, S] for _ in range(ROWS - 1)]
for _r in (6, 7):
    CELLS[_r][3] = CELLS[_r][4] = B
LAYOUT = {'rows': ROWS, 'cols': COLS, 'cells': CELLS,
          'blocks': [{'name': 'שמאל בדיוני', 'colStart': 0, 'colEnd': 1}, {'name': 'ימין בדיוני', 'colStart': 3, 'colEnd': 6}],
          'rowLabels': ['קדמית'] + [str(i) for i in range(1, ROWS)]}
HOLDER = 'בעל מקום דוגמה'
WEEK = friday(1)
IL = ZoneInfo('Asia/Jerusalem')


def at(hour, minute=0, week=WEEK):
    y, m, d = map(int, week.split('-'))
    return datetime(y, m, d, hour, minute, tzinfo=IL)


@own_tests_only
@mock_aws
class SeatWeekTest(test_messages.MessagesTest):
    def setUp(self):
        super().setUp()
        self.owned = {}
        status, out = self.call('PUT', f'{self.base()}/admin/seating/layouts/{friday()}',
                                body={**copy.deepcopy(LAYOUT), 'ifUpdatedAt': None})
        self.assertEqual(status, 200, out)
        self.at = {(s['row'], s['col']): s['id'] for s in out['seats']}
        self.fam = self.call('GET', f'{self.base()}/family', sub='member-sub')[1]['familyId']
        self.other = self.call('GET', f'{self.base()}/family', sub='quiet-sub')[1]['familyId']
        self.holder = self.call('POST', f'{self.base()}/admin/seating/holders', body={'name': HOLDER})[1]['holderId']

    def give(self, ref, *positions):
        old = self.owned.get(ref, ())
        self.owned[ref] = positions
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/seating/layouts/{friday()}/assignments', body={
            'assignments': {**{self.at[p]: None for p in old}, **{self.at[p]: ref for p in positions}},
            'ifUpdatedAt': self.call('GET', f'{self.base()}/admin/seating/layouts/{friday()}/assignments')[1]['updatedAt']})[0], 200)

    def mine(self, *positions):
        self.give(f'family:{self.fam}', *positions)

    def now(self, when):
        return mock.patch.object(routes_seatweek, '_now', return_value=when)

    def me(self, sub='member-sub', week=WEEK):
        return self.call('GET', f'{self.base()}/seats/me', sub=sub, query={'week': week})

    def put_me(self, released, prayer='erev', week=WEEK, sub='member-sub', guard='auto'):
        if guard == 'auto':
            guard = (self.me(sub, week)[1].get('updatedAt') or {}).get(prayer)
        return self.call('PUT', f'{self.base()}/seats/me', sub=sub,
                         body={'week': week, 'prayer': prayer, 'released': released, 'ifUpdatedAt': guard})

    def admin_week(self):
        return self.call('GET', f'{self.base()}/admin/seats/week/{WEEK}')[1]

    def gput(self, released, prayer='erev', guard='auto', sub='gabbai-sub'):
        if guard == 'auto':
            guard = self.admin_week()['prayers'][prayer]['updatedAt']
        return self.call('PUT', f'{self.base()}/admin/seats/week/{WEEK}', sub=sub,
                         body={'prayer': prayer, 'released': released, 'ifUpdatedAt': guard})

    def respond(self, rows, event='erev'):
        return self.call('POST', f'{self.base()}/admin/seats/week/{WEEK}/responses', body={'event': event, 'rows': rows})

    def undo(self, event='erev'):
        return self.call('POST', f'{self.base()}/admin/seats/week/{WEEK}/responses/undo', body={'event': event})

    def cells(self, frame):
        return [c for r in frame['rows'] for c in r['cells']]

    # the member cut
    def test_cut_leaks_nothing_about_others(self):
        self.mine((5, 0), (5, 1))
        self.give(f'family:{self.other}', (4, 0), (5, 3))
        self.give(f'holder:{self.holder}', (6, 0))
        status, body = self.me()
        self.assertEqual(status, 200)
        self.assertEqual(body['seats'], 2)
        self.assertEqual(len(body['frames']), 1)
        frame = body['frames'][0]
        self.assertEqual([r['label'] for r in frame['rows']], ['3', '4', '5', '6', '7'])
        self.assertEqual(frame['blockName'], 'שמאל בדיוני')
        self.assertEqual(frame['cols'], 2)
        self.assertEqual(set(body), {'week', 'deadline', 'open', 'seats', 'answered', 'updatedByGabbai', 'updatedAt', 'frames'})
        raw = json.dumps(body, ensure_ascii=False)
        for secret in list(self.at.values()) + [self.other, self.holder, HOLDER, 'Quinn', 'ימין בדיוני', self.fam, 'holder:', 'family:',
                                                'assignments']:
            self.assertNotIn(secret, raw)
        kinds = {c['kind'] for c in self.cells(frame)}
        self.assertEqual(kinds, {'mine', 'other'})
        others = [c for c in self.cells(frame) if c['kind'] == 'other']
        self.assertTrue(all(c == {'kind': 'other'} for c in others))
        self.assertEqual(sorted(c['k'] for c in self.cells(frame) if c['kind'] == 'mine'), [1, 2])

    def test_other_family_and_holder_see_nothing_of_it(self):
        self.mine((5, 0))
        self.assertEqual(self.me('quiet-sub')[1]['seats'], 0)
        self.assertEqual(self.me('quiet-sub')[1].get('frames'), None)

    def test_edge_rows_are_clipped_to_the_block(self):
        self.mine((1, 0))
        frame = self.me()[1]['frames'][0]
        self.assertEqual([r['label'] for r in frame['rows']], ['1', '2', '3'])  # never the ark row
        self.mine((1, 0), (13, 1))
        frames = self.me()[1]['frames']
        self.assertEqual([[r['label'] for r in f['rows']] for f in frames], [['1', '2', '3'], ['11', '12', '13']])

    def test_bimah_rows_show_as_bimah_in_the_block(self):
        self.mine((5, 3))
        frame = self.me()[1]['frames'][0]
        rows = {r['label']: r for r in frame['rows']}
        self.assertTrue(rows['6']['bimah'] and rows['7']['bimah'])
        self.assertEqual([c['kind'] for c in rows['6']['cells']], ['bimah', 'bimah', 'other', 'other'])

    def test_split_frames_rule(self):
        self.mine((2, 0), (6, 0))  # four rows apart: one frame
        self.assertEqual(len(self.me()[1]['frames']), 1)
        self.mine((2, 0), (7, 0))  # five apart: two
        self.assertEqual(len(self.me()[1]['frames']), 2)
        self.mine((2, 0), (3, 3))  # another block: two, right block first
        names = [f['blockName'] for f in self.me()[1]['frames']]
        self.assertEqual(names, ['ימין בדיוני', 'שמאל בדיוני'])

    def test_family_order_is_right_block_first_then_row_then_right_to_left(self):
        self.mine((2, 0), (5, 3), (5, 6))
        frames = self.me()[1]['frames']
        right = [c['k'] for c in self.cells(frames[0]) if c['kind'] == 'mine']
        self.assertEqual(right, [2, 1])  # (5,3) reads before (5,6) in the row top to bottom, but order is right to left
        self.assertEqual([c['k'] for c in self.cells(frames[1]) if c['kind'] == 'mine'], [3])
        self.assertEqual({c['n'] for f in frames for c in self.cells(f) if c['kind'] == 'mine'}, {3})

    def test_member_without_seats_listener_and_week_input(self):
        status, body = self.me()
        self.assertEqual((status, body['seats']), (200, 0))
        self.assertEqual(self.me('listener-sub')[0], 403)
        self.assertEqual(self.me(week='2026-01-01')[0], 400)  # a Thursday
        self.assertEqual(self.put_me([1])[0], 404)

    def test_no_layout_yet_for_an_early_week(self):
        self.mine((5, 0))
        self.assertEqual(self.me(week=friday(-1))[1]['seats'], 0)

    # member changes and the deadline
    def test_member_releases_before_the_deadline(self):
        self.mine((5, 0), (5, 1), (6, 0))
        with self.now(at(11)):
            status, body = self.put_me([3, 2])
            self.assertEqual(status, 200, body)
            self.assertTrue(body['open'])
            self.assertFalse(body['updatedByGabbai'])
            state = {c['k']: c['state'] for c in self.cells(body['frames'][0]) if c['kind'] == 'mine'}
            self.assertEqual({k: v['erev'] for k, v in state.items()}, {1: 'kept', 2: 'released', 3: 'released'})
            self.assertEqual({v['day'] for v in state.values()}, {'kept'})
            self.assertEqual(self.put_me([], 'day')[0], 200)
            self.assertEqual(self.put_me([1], 'erev')[0], 200)  # replaces the erev set
            state = {c['k']: c['state']['erev'] for c in self.cells(self.me()[1]['frames'][0]) if c['kind'] == 'mine'}
            self.assertEqual(state, {1: 'released', 2: 'kept', 3: 'kept'})

    def test_answered_is_stored_per_household_week_and_prayer(self):
        self.mine((5, 0), (5, 1))
        self.give(f'holder:{self.holder}', (8, 0))
        ref = f'family:{self.fam}'
        with self.now(at(11)):
            self.assertEqual(self.me()[1]['answered'], {'erev': False, 'day': False})
            self.assertEqual(self.put_me([], 'erev')[0], 200)  # "yes, everyone's coming": no seat change, still an answer
            body = self.me()[1]
            self.assertEqual(body['answered'], {'erev': True, 'day': False})
            self.assertEqual(self.put_me([], 'erev', sub='member-sub')[0], 200)
            week = self.admin_week()
            self.assertIn(ref, week['prayers']['erev']['answered'])
            self.assertNotIn(ref, week['prayers']['day']['answered'])
            self.assertEqual(week['prayers']['erev']['answered'].keys() & {f'holder:{self.holder}'}, set())
            self.assertFalse(self.me(week=friday(2))[1].get('answered', {}).get('erev', False))
            # a responses file does not change it, in either direction
            self.assertEqual(self.respond([{'household': ref, 'released': 1, 'override': True},
                                           {'household': f'holder:{self.holder}', 'released': 1}], 'day')[0], 200)
            week = self.admin_week()
            self.assertNotIn(ref, week['prayers']['day']['answered'])
            self.assertIn(ref, week['prayers']['erev']['answered'])
            self.assertEqual(self.respond([{'household': ref, 'released': 0, 'override': True}], 'erev')[0], 200)
            self.assertEqual(self.undo('erev')[0], 200)
            self.assertIn(ref, self.admin_week()['prayers']['erev']['answered'])
        # gabbai on behalf marks the households of the seats it names, even past the deadline
        with self.now(at(15)):
            self.assertEqual(self.gput({self.at[(8, 0)]: False}, 'day')[0], 200)
            day = self.admin_week()['prayers']['day']['answered']
            self.assertIn(f'holder:{self.holder}', day)
            self.assertNotIn(ref, day)
            self.assertEqual(self.me()[1]['answered'], {'erev': True, 'day': False})

    def test_member_cannot_release_what_is_not_his(self):
        self.mine((5, 0))
        self.give(f'family:{self.other}', (5, 1))
        for bad in ([2], [0], ['nope'], [self.at[(5, 1)]], [True], 'x', [1, 1, 1]):
            self.assertEqual(self.put_me(bad)[0], 400, bad)
        self.assertEqual(self.put_me([self.at[(5, 0)]])[0], 200)  # his own id works too
        self.assertEqual(self.put_me([1], 'bogus')[0], 400)
        self.assertEqual(self.put_me([1], week='2026-01-01')[0], 400)

    def test_deadline_enforced_and_default_is_friday_noon_in_jerusalem(self):
        self.mine((5, 0))
        with self.now(at(12, 1)):
            self.assertEqual(self.put_me([1]), (403, {'error': 'deadline_passed'}))
            body = self.me()[1]
            self.assertFalse(body['open'])
            self.assertTrue(body['deadline'].startswith(f'{WEEK}T12:00:00+0'))
        with self.now(at(12, 0)):
            self.assertEqual(self.put_me([1])[0], 200)

    def test_deadline_setting(self):
        self.mine((5, 0))
        for bad in ('25:00', '9:00', 5, None, '12:60'):
            self.assertEqual(self.call('PUT', f'{self.base()}/admin/settings', body={'seatDeadline': bad})[0], 400, bad)
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/settings', sub='member-sub', body={'seatDeadline': '18:00'})[0], 403)
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/settings', body={'seatDeadline': '18:00'})[0], 200)
        with self.now(at(17, 59)):
            self.assertEqual(self.put_me([1])[0], 200)
        with self.now(at(18, 1)):
            self.assertEqual(self.put_me([1])[0], 403)

    # the gabbai
    def test_gabbai_on_behalf_after_the_deadline_marks_the_member_page(self):
        self.mine((5, 0), (5, 1))
        self.give(f'holder:{self.holder}', (8, 0))
        with self.now(at(15)):
            status, out = self.gput({self.at[(5, 1)]: True, self.at[(8, 0)]: True})
            self.assertEqual(status, 200, out)
            body = self.me()[1]
            self.assertTrue(body['updatedByGabbai'])
            self.assertFalse(body['open'])
            self.assertEqual(self.put_me([])[0], 403)
            week = self.admin_week()
            seat = week['prayers']['erev']['seats'][self.at[(8, 0)]]
            self.assertEqual((seat['released'], seat['by']), (True, 'gabbai'))
            self.assertEqual(week['households'][f'holder:{self.holder}'], HOLDER)
            self.assertEqual(week['households'][f'family:{self.fam}'], 'Mia Member')

    def test_member_change_after_gabbai_is_marked_member_again(self):
        self.mine((5, 0))
        self.assertEqual(self.gput({self.at[(5, 0)]: True})[0], 200)
        self.assertTrue(self.me()[1]['updatedByGabbai'])
        with self.now(at(10)):
            self.assertEqual(self.put_me([])[0], 200)
        self.assertFalse(self.me()[1]['updatedByGabbai'])

    def test_gabbai_put_rules(self):
        self.mine((5, 0))
        seat = self.at[(5, 0)]
        self.assertEqual(self.gput({seat: True}, guard=7)[0], 409)  # stale
        self.assertEqual(self.gput({self.at[(9, 0)]: True})[0], 400)  # nobody holds it
        self.assertEqual(self.gput({'zz': True})[0], 400)
        self.assertEqual(self.gput({seat: 'yes'})[0], 400)
        self.assertEqual(self.gput({seat: True}, sub='member-sub')[0], 403)
        self.assertEqual(self.gput({seat: True}, sub='listener-sub')[0], 403)
        first = self.gput({seat: True})
        self.assertEqual(first[0], 200)
        self.assertEqual(self.gput({seat: False}, guard=None)[0], 409)

    def test_cross_kehila(self):
        self.mine((5, 0))
        other = self.repo.create_kehila('Other', {})
        for method, path in (('GET', f'/v1/kehilot/{other}/seats/me'), ('GET', f'/v1/kehilot/{other}/admin/seats/week/{WEEK}'),
                             ('PUT', f'/v1/kehilot/{other}/admin/seats/week/{WEEK}')):
            self.assertIn(self.call(method, path, sub='member-sub', body={})[0], (403, 404))
            self.assertIn(self.call(method, path, body={})[0], (403, 404))
        fam = 'H' * 26
        self.repo.table.put_item(Item={'pk': f'K#{other}', 'sk': f'F#{fam}', 'familyId': fam, 'adults': [self.member],
                                       'children': [], 'version': 1})
        status, body = self.respond([{'household': f'family:{fam}', 'released': 1}])
        self.assertEqual((status, body['error']), (400, 'unknown_household'))

    # responses
    def three(self):
        self.mine((5, 0), (5, 1), (6, 0))
        return self.at[(5, 0)], self.at[(5, 1)], self.at[(6, 0)]

    def released(self, prayer='erev'):
        seats = self.admin_week()['prayers'][prayer]['seats']
        return {s for s, v in seats.items() if v['released']}

    def test_apply_frees_highest_order_first_and_clamps(self):
        a, b, c = self.three()  # order: row 5 right to left (b then a), then row 6 (c)
        status, out = self.respond([{'household': f'family:{self.fam}', 'released': 1}])
        self.assertEqual(status, 200, out)
        self.assertEqual((out['released'], out['kept'], out['warnings']), (1, 2, []))
        self.assertEqual(self.released(), {c})
        status, out = self.respond([{'household': f'family:{self.fam}', 'released': 5}])
        self.assertEqual(out['warnings'], [{'household': f'family:{self.fam}', 'code': 'above_seats'}])
        self.assertEqual(self.released(), {a, b, c})
        self.assertEqual(self.respond([{'household': f'family:{self.fam}', 'released': 0}])[0], 200)
        self.assertEqual(self.released(), set())
        self.assertEqual(self.released('day'), set())

    def test_apply_holders_and_marks_gabbai(self):
        self.give(f'holder:{self.holder}', (8, 0), (8, 1))
        status, out = self.respond([{'household': f'holder:{self.holder}', 'released': 1}], 'day')
        self.assertEqual(status, 200, out)
        self.assertEqual(self.released('day'), {self.at[(8, 0)]})  # order runs right to left in a row
        self.assertEqual(self.released('erev'), set())
        self.assertEqual({v['by'] for v in self.admin_week()['prayers']['day']['seats'].values()}, {'gabbai'})

    def test_latest_answer_wins(self):
        self.three()
        ref = f'family:{self.fam}'
        status, out = self.respond([{'household': ref, 'released': 3}, {'household': ref, 'released': 2}])
        self.assertEqual((status, out['duplicates'], out['released']), (200, 1, 2))
        self.assertEqual(len(self.released()), 2)
        self.respond([{'household': ref, 'released': 1}])  # a later upload also wins
        self.assertEqual(len(self.released()), 1)

    def test_household_without_seats_warns_and_unknown_is_rejected(self):
        self.three()
        status, out = self.respond([{'household': f'family:{self.other}', 'released': 1}])
        self.assertEqual((status, out['warnings'], out['released']), (200, [{'household': f'family:{self.other}', 'code': 'no_seats'}], 0))
        for rows in ([{'household': 'family:' + 'Z' * 26, 'released': 1}], [{'household': 'holder:' + 'Z' * 26, 'released': 1}]):
            status, body = self.respond(rows)
            self.assertEqual((status, body['error']), (400, 'unknown_household'))
        self.assertEqual(self.released(), set())

    def test_apply_validation_and_permissions(self):
        self.three()
        ref = f'family:{self.fam}'
        for rows in ([{'household': ref}], [{'household': ref, 'released': -1}], [{'household': ref, 'released': 'x'}],
                     [{'household': 'x', 'released': 1}], [{'household': ref, 'released': 1, 'extra': 1}], 'x',
                     [{'household': ref, 'released': 1, 'requests': {'a' * 30: 1}}],
                     [{'household': ref, 'released': 1, 'requests': {'x': -1}}]):
            self.assertEqual(self.respond(rows)[0], 400, rows)
        self.assertEqual(self.respond([], 'bogus')[0], 400)
        for sub in ('member-sub', 'listener-sub'):
            self.assertEqual(self.call('POST', f'{self.base()}/admin/seats/week/{WEEK}/responses', sub=sub,
                                       body={'event': 'erev', 'rows': []})[0], 403)

    def test_requests_are_stored_per_week_and_event(self):
        self.three()
        ref = f'family:{self.fam}'
        status, out = self.respond([{'household': ref, 'released': 1, 'requests': {'ימין': 2, 'מרכז': 1}}])
        self.assertEqual((status, out['requestTotals']), (200, {'ימין': 2, 'מרכז': 1}))
        week = self.admin_week()
        self.assertEqual(week['prayers']['erev']['requests'], {ref: {'ימין': 2, 'מרכז': 1}})
        self.assertEqual(week['prayers']['day']['requests'], {})
        self.respond([{'household': ref, 'released': 1, 'requests': {'ימין': 1}}])
        self.assertEqual(self.admin_week()['prayers']['erev']['requests'], {ref: {'ימין': 1}})
        self.assertNotIn('ימין', json.dumps(self.me()[1], ensure_ascii=False))

    def test_undo_restores_the_state_before_the_apply(self):
        a, b, c = self.three()
        ref = f'family:{self.fam}'
        self.assertEqual(self.undo(), (404, {'error': 'nothing_to_undo'}))
        self.assertEqual(self.gput({a: True})[0], 200)  # before: a released by hand
        self.respond([{'household': ref, 'released': 1, 'requests': {'ימין': 2}}])
        self.assertEqual(self.released(), {c})
        status, out = self.undo()
        self.assertEqual((status, out['skipped']), (200, 0))
        self.assertEqual(self.released(), {a})
        self.assertEqual(self.admin_week()['prayers']['erev']['requests'], {})
        self.assertEqual(self.undo()[0], 404)  # one level only
        self.assertFalse(self.admin_week()['prayers']['erev']['canUndo'])

    def test_undo_keeps_changes_made_after_the_apply(self):
        a, b, c = self.three()
        self.respond([{'household': f'family:{self.fam}', 'released': 3}])
        with self.now(at(9)):
            self.put_me([1])  # the member changes it back after the upload (order 1 = b released only)
        status, out = self.undo()
        self.assertEqual(status, 200)
        self.assertEqual(out['skipped'], 2)  # a and c were changed by the member; b is as the apply left it
        self.assertEqual(self.released(), set())

    def test_undo_is_per_event(self):
        self.three()
        ref = f'family:{self.fam}'
        self.respond([{'household': ref, 'released': 1}], 'erev')
        self.respond([{'household': ref, 'released': 2}], 'day')
        self.assertEqual(self.undo('erev')[0], 200)
        self.assertEqual((len(self.released('erev')), len(self.released('day'))), (0, 2))

    def test_shabbat_state_is_per_week(self):
        self.mine((5, 0))
        self.assertEqual(self.respond([{'household': f'family:{self.fam}', 'released': 1}])[0], 200)
        other_week = self.call('GET', f'{self.base()}/seats/me', sub='member-sub', query={'week': friday(2)})[1]
        self.assertEqual(other_week['frames'][0]['rows'][2]['cells'][0]['state']['erev'], 'kept')

    def test_layout_for_future_shabbat_keeps_current_answers(self):
        self.mine((5, 0))
        self.respond([{'household': f'family:{self.fam}', 'released': 1}])
        cells = copy.deepcopy(CELLS)
        cells[13][1] = E
        status, out = self.call('PUT', f'{self.base()}/admin/seating/layouts/{friday(2)}',
                                body={**copy.deepcopy(LAYOUT), 'cells': cells, 'ifUpdatedAt': None})
        self.assertEqual(status, 200, out)
        self.assertEqual(len(self.released()), 1)

    def test_holder_deleted_leaves_state_harmless(self):
        self.give(f'holder:{self.holder}', (8, 0))
        self.respond([{'household': f'holder:{self.holder}', 'released': 1}])
        self.assertEqual(self.call('DELETE', f'{self.base()}/admin/seating/holders/{self.holder}')[0], 204)
        week = self.admin_week()
        self.assertEqual(week['assignments'], {})
        status, body = self.respond([{'household': f'holder:{self.holder}', 'released': 1}])
        self.assertEqual((status, body['error']), (400, 'unknown_household'))

    # fix round 1
    def test_app_answer_wins_unless_override(self):
        a, b, c = self.three()
        ref = f'family:{self.fam}'
        with self.now(at(9)):
            self.put_me([1])  # b released by the member
        status, out = self.respond([{'household': ref, 'released': 3}])
        self.assertEqual((status, out['warnings'], out['households']), (200, [{'household': ref, 'code': 'app_answer_kept'}], 0))
        self.assertEqual(self.released(), {b})
        self.assertEqual(self.released('day'), set())  # the other prayer has no member answer
        status, out = self.respond([{'household': ref, 'released': 3}], 'day')
        self.assertEqual(out['warnings'], [])
        status, out = self.respond([{'household': ref, 'released': 3, 'override': True}])
        self.assertEqual((out['warnings'], len(self.released())), ([], 3))
        self.assertEqual(self.respond([{'household': ref, 'released': 1, 'override': 'yes'}])[0], 400)

    def test_apply_touches_only_seats_that_change(self):
        a, b, c = self.three()
        self.assertEqual(self.gput({c: True})[0], 200)
        before = self.admin_week()['prayers']['erev']['seats'][c]
        self.respond([{'household': f'family:{self.fam}', 'released': 1}])  # c is already the one released
        self.assertEqual(self.admin_week()['prayers']['erev']['seats'][c], before)
        self.assertEqual(self.repo.get_week(self.k, WEEK, 'erev')['undo']['seats'], {})
        with self.now(at(9)):
            self.put_me([1, 2, 3])
        member = self.admin_week()['prayers']['erev']['seats']
        self.respond([{'household': f'family:{self.fam}', 'released': 3, 'override': True}])
        after = self.admin_week()['prayers']['erev']['seats']
        self.assertEqual({s: v['at'] for s, v in after.items()}, {s: v['at'] for s, v in member.items()})  # nothing changed

    def test_record_for_a_previous_holder_is_no_answer(self):
        a, b, c = self.three()
        self.assertEqual(self.gput({a: True})[0], 200)
        self.assertTrue(self.me()[1]['updatedByGabbai'])
        self.give(f'family:{self.fam}', (5, 1), (6, 0))  # a leaves the family
        self.give(f'family:{self.other}', (5, 0))
        self.assertFalse(self.me()[1]['updatedByGabbai'])
        self.assertFalse(self.admin_week()['prayers']['erev']['seats'].get(a, {}).get('released', False))
        self.assertEqual(self.me('quiet-sub')[1]['frames'][0]['rows'][2]['cells'][0]['state']['erev'], 'kept')
        self.assertEqual(self.gput({a: False}, guard=self.admin_week()['prayers']['erev']['updatedAt'])[0], 200)
        self.assertEqual(self.released(), set())
        # a member answer for the old holder is not an answer for the new one: the file may apply
        with self.now(at(9)):
            self.put_me([1])
        self.give(f'family:{self.fam}', (6, 0))
        self.give(f'family:{self.other}', (5, 0), (5, 1))
        status, out = self.respond([{'household': f'family:{self.other}', 'released': 1}])
        self.assertEqual(out['warnings'], [])

    def test_member_put_requires_if_updated_at_and_conflicts(self):
        self.mine((5, 0))
        with self.now(at(9)):
            self.assertEqual(self.call('PUT', f'{self.base()}/seats/me', sub='member-sub',
                                       body={'week': WEEK, 'prayer': 'erev', 'released': []})[0], 400)
            seen = self.me()[1]['updatedAt']['erev']
            self.assertIsNone(seen)
            self.assertEqual(self.gput({self.at[(5, 0)]: True})[0], 200)  # a gabbai changes it after the member's read
            self.assertEqual(self.put_me([], guard=seen), (409, {'error': 'week_changed'}))
            self.assertTrue(self.me()[1]['updatedByGabbai'])
            self.assertEqual(self.put_me([])[0], 200)  # after a fresh read

    def test_member_call_reads_only_his_own_family(self):
        self.mine((5, 0))
        self.give(f'family:{self.other}', (6, 0))
        seen = []
        real = self.repo.get_family
        self.repo.get_family = lambda k, fid: (seen.append(fid), real(k, fid))[1]
        self.me()
        self.assertEqual(set(seen), {self.fam})

    def test_week_item_stays_small_for_the_biggest_hall(self):
        cells = [[S] * 60 for _ in range(40)]
        layout = {'rows': 40, 'cols': 60, 'cells': cells, 'blocks': [{'name': 'כל האולם', 'colStart': 0, 'colEnd': 59}],
                  'rowLabels': [str(i) for i in range(40)]}
        status, out = self.call('PUT', f'{self.base()}/admin/seating/layouts/{WEEK}', body={**layout, 'ifUpdatedAt': None})
        self.assertEqual(status, 200, out)
        seats = {x['id']: f'family:{self.fam}' for x in out['seats']}
        status, body = self.call('PUT', f'{self.base()}/admin/seating/layouts/{WEEK}/assignments',
                                 body={'assignments': seats, 'ifUpdatedAt': None})
        self.assertEqual(status, 200, body)
        status, res = self.respond([{'household': f'family:{self.fam}', 'released': 2400, 'requests': {'x': 1}}])
        self.assertEqual((status, res['released']), (200, 2400))
        item = self.repo.table.get_item(Key={'pk': f'K#{self.k}', 'sk': f'SEATWK#{WEEK}#erev'}, ConsistentRead=True)['Item']
        self.assertLess(len(json.dumps(item, default=str)), 300 * 1024)
        self.assertEqual(self.undo()[0], 200)
