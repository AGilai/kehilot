import copy
import io
import json
import logging
import time
import zipfile
from datetime import date, timedelta
from unittest import mock

from moto import mock_aws

from server.cloud import export
from server.tests.cloud import test_messages
from server.tests.cloud.test_groups import own_tests_only

S, A, B, K, E = 'seat', 'aisle', 'bimah', 'ark', 'empty'
CELLS = [[K, K, E, E, E, E],
         [S, S, A, S, S, E],
         [S, S, A, S, S, B],
         [S, S, A, S, S, B]]
LAYOUT = {'rows': 4, 'cols': 6, 'cells': CELLS,
          'blocks': [{'name': 'ימין', 'colStart': 0, 'colEnd': 1}, {'name': 'מרכז', 'colStart': 3, 'colEnd': 5}],
          'rowLabels': ['קדמית', '1', '2', '3']}
NAME = 'בדיוני ש.'


def friday(weeks=0):
    today = date.today()
    return (today + timedelta(days=(4 - today.weekday()) % 7) + timedelta(weeks=weeks)).isoformat()


@own_tests_only
@mock_aws
class SeatingTest(test_messages.MessagesTest):
    def lay(self, frm=None, tail=''):
        return f'{self.base()}/admin/seating/layouts' + (f'/{frm}' if frm else '') + tail

    def put(self, frm=None, sub='gabbai-sub', guard=None, **over):
        body = {**copy.deepcopy(LAYOUT), 'ifUpdatedAt': guard, **over}
        return self.call('PUT', self.lay(frm or friday()), sub=sub, body=body)

    def saved(self, frm=None, **kw):
        status, body = self.put(frm, **kw)
        self.assertEqual(status, 200, body)
        return body

    def holders(self, tail=''):
        return f'{self.base()}/admin/seating/holders' + (f'/{tail}' if tail else '')

    def holder(self, name=NAME, **extra):
        status, body = self.call('POST', self.holders(), body={'name': name, **extra})
        self.assertEqual(status, 201, body)
        return body['holderId']

    def family(self):
        return self.call('GET', f'{self.base()}/family', sub='member-sub')[1]['familyId']

    def asg(self, frm, body, sub='gabbai-sub'):
        return self.call('PUT', self.lay(frm, '/assignments'), sub=sub, body=body)

    # layouts
    def test_save_read_roundtrip_assigns_stable_seat_ids(self):
        out = self.saved()
        self.assertEqual(len(out['seats']), 12)
        ids = [s['id'] for s in out['seats']]
        self.assertEqual(len(set(ids)), 12)
        self.assertEqual(out['seats'][0]['row'], 1)
        self.assertEqual(out['seats'][0]['col'], 0)
        status, got = self.call('GET', self.lay(friday()))
        self.assertEqual(status, 200)
        for key in ('rows', 'cols', 'cells', 'blocks', 'rowLabels'):
            self.assertEqual(got[key], LAYOUT[key])
        self.assertEqual(got['seats'], out['seats'])
        self.assertEqual(got['effectiveFrom'], friday())
        # an edit keeps the ids of seats that stay in place
        cells = copy.deepcopy(CELLS)
        cells[3][0] = E
        again = self.saved(guard=out['updatedAt'], cells=cells)
        self.assertEqual(len(again['seats']), 11)
        self.assertTrue({s['id'] for s in again['seats']} < set(ids))

    def test_new_version_inherits_ids_by_position(self):
        first = self.saved(friday())
        second = self.saved(friday(1))
        self.assertEqual(first['seats'], second['seats'])

    def test_gabbai_only(self):
        for sub in ('member-sub', 'listener-sub', 'quiet-sub'):
            self.assertEqual(self.put(sub=sub), (403, {'error': 'forbidden'}))
            self.assertEqual(self.call('GET', self.lay(), sub=sub), (403, {'error': 'forbidden'}))
            self.assertEqual(self.call('GET', self.lay(friday()), sub=sub), (403, {'error': 'forbidden'}))
            self.assertEqual(self.call('GET', self.holders(), sub=sub), (403, {'error': 'forbidden'}))
            self.assertEqual(self.call('POST', self.holders(), sub=sub, body={'name': 'x'}), (403, {'error': 'forbidden'}))
            self.assertEqual(self.call('GET', self.lay(friday(), '/assignments'), sub=sub), (403, {'error': 'forbidden'}))
            self.assertEqual(self.asg(friday(), {'assignments': {}, 'ifUpdatedAt': None}, sub=sub),
                             (403, {'error': 'forbidden'}))

    def test_other_kehila_404(self):
        other = self.repo.create_kehila('Other', {})
        status, body = self.call('GET', f'/v1/kehilot/{other}/admin/seating/layouts')
        self.assertEqual(status, 404)

    def test_effective_from_must_be_a_friday_in_range(self):
        monday = (date.fromisoformat(friday()) + timedelta(days=3)).isoformat()
        for bad in (monday, '2026-13-01', 'x', '2026-1-1', '2019-01-04', friday(60)):
            self.assertEqual(self.put(bad), (400, {'error': 'invalid_effective_from'}), bad)

    def test_if_updated_at_conflicts(self):
        first = self.saved()
        self.assertEqual(self.put(guard=None), (409, {'error': 'layout_changed'}))  # expected none, one exists
        second = self.saved(guard=first['updatedAt'])
        self.assertGreater(second['updatedAt'], first['updatedAt'])
        self.assertEqual(self.put(guard=first['updatedAt']), (409, {'error': 'layout_changed'}))
        body = {**LAYOUT}
        self.assertEqual(self.call('PUT', self.lay(friday()), body=body), (400, {'error': 'invalid_layout', 'field': 'ifUpdatedAt'}))
        self.assertEqual(self.put(guard='x')[0], 400)
        self.assertEqual(self.put(friday(2), guard=5), (409, {'error': 'layout_changed'}))

    def test_validation(self):
        def bad(**over):
            status, body = self.put(**over)
            self.assertEqual((status, body['error']), (400, 'invalid_layout'), over)
        bad(rows=3)
        bad(cols=7)
        bad(cells=[row[:5] for row in CELLS])
        bad(cells=[['wall'] * 6] * 4)
        bad(cells=[[S] * 6] * 4, blocks=[{'name': 'x', 'colStart': 0, 'colEnd': 4}])  # seats outside blocks
        bad(cells=[[E] * 6] * 4)  # no seats
        bad(blocks=[{'name': 'x' * 25, 'colStart': 0, 'colEnd': 1}, {'name': 'מרכז', 'colStart': 3, 'colEnd': 5}])
        bad(blocks=[{'name': '', 'colStart': 0, 'colEnd': 1}, {'name': 'מרכז', 'colStart': 3, 'colEnd': 5}])
        bad(blocks=[{'name': 'a\nb', 'colStart': 0, 'colEnd': 1}, {'name': 'מרכז', 'colStart': 3, 'colEnd': 5}])
        bad(blocks=[{'name': 'a', 'colStart': 0, 'colEnd': 3}, {'name': 'b', 'colStart': 3, 'colEnd': 5}])  # overlap
        bad(blocks=[{'name': 'a', 'colStart': 3, 'colEnd': 5}, {'name': 'b', 'colStart': 0, 'colEnd': 1}])  # order
        bad(blocks=[{'name': 'a', 'colStart': 0, 'colEnd': 6}])  # out of the grid
        bad(blocks=[{'name': 'a', 'colStart': 1, 'colEnd': 0}])
        bad(blocks=[{'name': 'a', 'colStart': 0, 'colEnd': 5, 'x': 1}])
        bad(blocks=[{'name': 'a', 'colStart': True, 'colEnd': 5}])
        bad(blocks=[])
        bad(rowLabels=['a', 'b'])
        bad(rowLabels=['a', 'b', 'c', 1])
        bad(rowLabels=['a', 'b', 'c', 'x' * 9])
        bad(extra=1)
        bad(rows=True)
        bad(cells='nope')

    def test_grid_caps(self):
        big = {'rows': 41, 'cols': 6, 'cells': [[S] * 6] * 41, 'rowLabels': [None] * 41,
               'blocks': [{'name': 'a', 'colStart': 0, 'colEnd': 5}]}
        self.assertEqual(self.put(**big)[1]['error'], 'invalid_layout')
        wide = {'rows': 2, 'cols': 61, 'cells': [[S] * 61] * 2, 'rowLabels': [None] * 2,
                'blocks': [{'name': 'a', 'colStart': 0, 'colEnd': 60}]}
        self.assertEqual(self.put(**wide)[1]['error'], 'invalid_layout')
        full = {'rows': 40, 'cols': 60, 'cells': [[S] * 60] * 40, 'rowLabels': [None] * 40,
                'blocks': [{'name': 'a', 'colStart': 0, 'colEnd': 59}]}
        out = self.saved(**full)
        self.assertEqual(len(out['seats']), 2400)
        self.assertEqual(self.call('GET', self.lay(friday()))[0], 200)

    def test_history_list(self):
        self.assertEqual(self.call('GET', self.lay()), (200, {'layouts': []}))
        self.saved(friday())
        self.saved(friday(2))
        past = self.saved(friday(-3))
        status, body = self.call('GET', self.lay())
        self.assertEqual(status, 200)
        self.assertEqual([x['effectiveFrom'] for x in body['layouts']], [friday(2), friday(), friday(-3)])
        self.assertEqual(body['layouts'][2]['seats'], 12)
        self.assertEqual(body['layouts'][2]['updatedAt'], past['updatedAt'])
        self.assertEqual(sum(x['current'] for x in body['layouts']), 1)
        today = date.today().isoformat()
        self.assertEqual(next(x['effectiveFrom'] for x in body['layouts'] if x['current']),
                         max(x['effectiveFrom'] for x in body['layouts'] if x['effectiveFrom'] <= today))
        self.assertEqual(self.call('GET', self.lay(friday(7)))[0], 404)

    # holders
    def test_holder_crud(self):
        hid = self.holder(' ' + NAME + ' ', phone='050-123 4567')
        status, rows = self.call('GET', self.holders())
        self.assertEqual(status, 200)
        self.assertEqual(rows[0]['name'], NAME)
        self.assertEqual(rows[0]['phone'], '+972501234567')
        self.assertEqual(rows[0]['holderId'], hid)
        status, upd = self.call('PUT', self.holders(hid), body={'name': 'דוגמה א.', 'phone': None})
        self.assertEqual((status, upd['name'], upd['phone']), (200, 'דוגמה א.', None))
        self.assertEqual(self.call('PUT', self.holders('X' * 26), body={'name': 'a'}), (404, {'error': 'holder_not_found'}))
        self.assertEqual(self.call('PUT', self.holders('bad id'), body={'name': 'a'})[0], 404)
        self.assertEqual(self.call('DELETE', self.holders(hid)), (204, None))
        self.assertEqual(self.call('DELETE', self.holders(hid)), (404, {'error': 'holder_not_found'}))
        self.assertEqual(self.call('GET', self.holders()), (200, []))

    def test_holder_validation(self):
        for bad in ('', '  ', 'x' * 61, 'a\nb', 5, None):
            self.assertEqual(self.call('POST', self.holders(), body={'name': bad}), (400, {'error': 'invalid_name'}), repr(bad))
        self.holder('x' * 60)
        for phone in ('12', 'abc', 5, '+' + '9' * 40):
            self.assertEqual(self.call('POST', self.holders(), body={'name': 'a', 'phone': phone}),
                             (400, {'error': 'invalid_phone'}), repr(phone))
        self.assertEqual(self.call('POST', self.holders(), body={'name': 'a', 'x': 1})[0], 400)
        self.assertEqual(self.call('POST', self.holders(), body={'name': 'a', 'phone': ''})[0], 201)

    def test_holder_cap(self):
        from server.cloud import seating_rules
        with mock.patch.object(seating_rules, 'MAX_HOLDERS', 2):
            self.holder('a')
            self.holder('b')
            self.assertEqual(self.call('POST', self.holders(), body={'name': 'c'}), (409, {'error': 'too_many_holders'}))

    # assignments
    def test_assignments_family_and_holder(self):
        out = self.saved()
        seats = [s['id'] for s in out['seats']]
        fam, hid = self.family(), self.holder()
        status, got = self.call('GET', self.lay(friday(), '/assignments'))
        self.assertEqual((status, got['assignments'], got['updatedAt']), (200, {}, None))
        status, res = self.asg(friday(), {'assignments': {seats[0]: f'family:{fam}', seats[1]: f'family:{fam}',
                                                          seats[2]: f'holder:{hid}'}, 'ifUpdatedAt': None})
        self.assertEqual(status, 200, res)
        status, got = self.call('GET', self.lay(friday(), '/assignments'))
        self.assertEqual(got['assignments'], {seats[0]: f'family:{fam}', seats[1]: f'family:{fam}', seats[2]: f'holder:{hid}'})
        self.assertEqual(got['updatedAt'], res['updatedAt'])
        # null clears; others stay (merge)
        status, res2 = self.asg(friday(), {'assignments': {seats[0]: None}, 'ifUpdatedAt': res['updatedAt']})
        self.assertEqual(status, 200)
        got = self.call('GET', self.lay(friday(), '/assignments'))[1]
        self.assertEqual(set(got['assignments']), {seats[1], seats[2]})
        # stale guard
        self.assertEqual(self.asg(friday(), {'assignments': {}, 'ifUpdatedAt': res['updatedAt']}),
                         (409, {'error': 'assignments_changed'}))
        # the list shows the count
        listed = self.call('GET', self.lay())[1]['layouts'][0]
        self.assertEqual(listed['assigned'], 2)

    def test_assignment_validation(self):
        out = self.saved()
        seats = [s['id'] for s in out['seats']]
        fam, hid = self.family(), self.holder()
        other = self.repo.create_kehila('Other', {})
        foreign = 'F' * 26

        def bad(entries, code):
            status, body = self.asg(friday(), {'assignments': entries, 'ifUpdatedAt': None})
            self.assertEqual((status, body['error']), (400, code), entries)
        bad({'nope': f'family:{fam}'}, 'invalid_assignments')
        bad({seats[0]: 'family:' + foreign}, 'invalid_assignments')
        bad({seats[0]: 'holder:' + foreign}, 'invalid_assignments')
        bad({seats[0]: 'x:1'}, 'invalid_assignments')
        bad({seats[0]: 5}, 'invalid_assignments')
        bad({seats[0]: f'family:{fam}x'}, 'invalid_assignments')
        bad([], 'invalid_assignments')
        self.assertEqual(self.asg(friday(), {'assignments': {seats[0]: f'family:{fam}'}})[1]['error'], 'invalid_assignments')
        # a family of another Kehila
        other_fam = 'G' * 26
        self.repo.table.put_item(Item={'pk': f'K#{other}', 'sk': f'F#{other_fam}', 'familyId': other_fam, 'adults': ['u'],
                                       'children': [], 'version': 1})
        bad({seats[0]: f'family:{other_fam}'}, 'invalid_assignments')
        self.assertEqual(self.asg(friday(7), {'assignments': {}, 'ifUpdatedAt': None}), (404, {'error': 'layout_not_found'}))
        # nothing was written by the failed calls
        self.assertEqual(self.call('GET', self.lay(friday(), '/assignments'))[1]['assignments'], {})

    def test_layouts_keep_separate_assignments(self):
        a = self.saved(friday())
        b = self.saved(friday(1))
        hid = self.holder()
        sid = a['seats'][0]['id']
        self.assertEqual(sid, b['seats'][0]['id'])
        self.asg(friday(), {'assignments': {sid: f'holder:{hid}'}, 'ifUpdatedAt': None})
        self.assertEqual(self.call('GET', self.lay(friday(1), '/assignments'))[1]['assignments'], {})
        self.assertEqual(len(self.call('GET', self.lay(friday(), '/assignments'))[1]['assignments']), 1)

    def test_removed_seats_drop_their_assignments(self):
        out = self.saved()
        hid = self.holder()
        gone = next(s for s in out['seats'] if (s['row'], s['col']) == (3, 0))
        keep = next(s for s in out['seats'] if (s['row'], s['col']) == (1, 0))
        self.asg(friday(), {'assignments': {gone['id']: f'holder:{hid}', keep['id']: f'holder:{hid}'}, 'ifUpdatedAt': None})
        cells = copy.deepcopy(CELLS)
        cells[3][0] = E
        self.saved(guard=out['updatedAt'], cells=cells)
        got = self.call('GET', self.lay(friday(), '/assignments'))[1]['assignments']
        self.assertEqual(got, {keep['id']: f'holder:{hid}'})

    def test_deleting_a_holder_clears_its_assignments_everywhere(self):
        a = self.saved(friday())
        self.saved(friday(1))
        h1, h2 = self.holder('א'), self.holder('ב')
        fam = self.family()
        s = [x['id'] for x in a['seats']]
        for frm in (friday(), friday(1)):
            self.asg(frm, {'assignments': {s[0]: f'holder:{h1}', s[1]: f'holder:{h2}', s[2]: f'family:{fam}'},
                           'ifUpdatedAt': None})
        self.assertEqual(self.call('DELETE', self.holders(h1)), (204, None))
        for frm in (friday(), friday(1)):
            self.assertEqual(self.call('GET', self.lay(frm, '/assignments'))[1]['assignments'],
                             {s[1]: f'holder:{h2}', s[2]: f'family:{fam}'})

    # privacy
    def test_no_names_or_phones_in_logs(self):
        with self.assertLogs('server', level='DEBUG') as logs:
            logging.getLogger('server').info('probe')
            hid = self.holder('סודי בדיוני', phone='0501234567')
            self.call('PUT', self.holders(hid), body={'name': 'סודי אחר', 'phone': '0527654321'})
            self.call('POST', self.holders(), body={'name': 'x', 'phone': 'bad'})
            self.call('DELETE', self.holders(hid))
        text = '\n'.join(logs.output)
        for needle in ('סודי', '501234567', '527654321'):
            self.assertNotIn(needle, text)

    def test_personal_export_has_no_holders_or_seat_data(self):
        self.saved()
        self.holder('סודי בדיוני', phone='0501234567')
        with mock.patch('server.cloud.media.s3_client'), mock.patch('server.cloud.media.bucket', return_value='b'):
            path = export.build(self.repo, self.gabbai, 'g@example.test')
        try:
            with zipfile.ZipFile(path) as archive:
                data = b''.join(archive.read(n) for n in archive.namelist()).decode('utf-8')
        finally:
            import os
            os.remove(path)
        self.assertNotIn('סודי', data)
        self.assertNotIn('501234567', data)
        self.assertNotIn('seat', data.lower().replace('seating', ''))

    def test_items_live_in_the_kehila_partition(self):
        self.saved()
        hid = self.holder()
        sks = {i['sk'] for i in self.repo._query_prefix(self.k, 'SEAT')}
        self.assertTrue(any(sk.startswith('SEATLAY#') for sk in sks))
        self.assertIn(f'SEATHOLDER#{hid}', sks)
