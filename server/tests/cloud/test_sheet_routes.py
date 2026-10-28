import time
from datetime import datetime, timezone
from unittest import mock
from zoneinfo import ZoneInfo

from moto import mock_aws

from server.cloud import push, routes_sheet, sheet_items
from server.cloud.errors import ApiError
from server.tests.cloud import test_messages

J = ZoneInfo('Asia/Jerusalem')
FRIDAY = '2026-10-30'
MAZAL = {'occasion': 'other', 'occasionOther': 'ברית', 'whose': 'other', 'whoseOther': 'חברים', 'surname': 'דוגמה'}


def at(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm, tzinfo=J).astimezone(timezone.utc)


@mock_aws
class SheetRoutesTest(test_messages.MessagesTest):
    def setUp(self):
        super().setUp()
        for module in (sheet_items, routes_sheet):
            patcher = mock.patch.object(module, '_now', return_value=at(2026, 10, 28, 9, 0))
            patcher.start()
            self.addCleanup(patcher.stop)
        enqueue = mock.patch.object(push, 'enqueue')
        enqueue.start()
        self.addCleanup(enqueue.stop)

    def sheet(self, sub='gabbai-sub', week=FRIDAY):
        return self.call('GET', f'{self.base()}/sheet/{week}', sub=sub)

    def admin(self, method, suffix='', sub='gabbai-sub', body=None, week=FRIDAY):
        return self.call(method, f'{self.base()}/admin/sheet/{week}/items{suffix}', sub=sub, body=body)

    def mazal(self, sub='gabbai-sub', channel='simchas'):
        return self.post(channel, sub=sub, type='celebration', templateId='mazal', fields=MAZAL)[1]['messageId']

    def free(self, text='שלום', type='notice', **extra):
        status, body = self.admin('POST', body={'type': type, 'text': text, **extra})
        self.assertEqual(status, 201, body)
        return body['itemId']

    def ids(self, sub='gabbai-sub'):
        status, body = self.sheet(sub)
        self.assertEqual(status, 200)
        return [i['itemId'] for i in body['items']]

    def test_member_sees_only_in_items(self):
        pending = self.mazal('member-sub')
        done = self.mazal()
        self.assertEqual(self.ids('member-sub'), [done])
        self.assertEqual(sorted(self.ids()), sorted([pending, done]))
        item = next(i for i in self.sheet()[1]['items'] if i['itemId'] == pending)
        self.assertEqual((item['state'], item['source'], item['wasPending'], item['postedBy'], item['approvedBy']),
                         ('pending', 'member', True, 'Mia Member', ''))
        self.assertEqual(item['message']['messageId'], pending)
        member_item = self.sheet('member-sub')[1]['items'][0]
        for key in ('wasPending', 'postedBy', 'approvedBy'):
            self.assertNotIn(key, member_item)
        self.assertEqual(self.sheet('member-sub')[1]['week'], FRIDAY)

    def test_listener_without_celebrations_sees_events_only(self):    # Review Focus 4
        self.call('PUT', f'{self.base()}/admin/settings',
                  body={'typeRules': {'celebration': {'post': 'broadcasters', 'listeners': False}}})
        self.mazal(channel='announcements')
        self.free('מזל טוב חופשי', 'celebration')
        event = self.post('announcements', type='event')[1]['messageId']
        notice = self.free('הודעה')
        self.assertEqual(sorted(self.ids('listener-sub')), sorted([event, notice]))
        self.assertEqual(len(self.ids()), 4)
        self.call('PUT', f'{self.base()}/admin/settings',
                  body={'typeRules': {'celebration': {'post': 'broadcasters', 'listeners': True}}})
        self.assertEqual(len(self.ids('listener-sub')), 4)

    def test_approve_appends_and_records_approver(self):
        auto = self.mazal()
        first, second = self.mazal('member-sub'), self.mazal('member-sub')
        for item_id in (second, first):
            status, item = self.admin('PUT', f'/{item_id}', body={'state': 'in'})
            self.assertEqual((status, item['state'], item['source'], item['approvedBy']),
                             (200, 'in', 'approved', 'Gabi Gabbai'))
        self.assertEqual(self.ids(), [auto, second, first])
        self.assertEqual(self.ids('member-sub'), [auto, second, first])

    def test_undo_approve_back_to_pending_only_if_was_pending(self):
        auto = self.mazal()
        self.assertEqual(self.admin('PUT', f'/{auto}', body={'state': 'pending'}), (400, {'error': 'invalid_state'}))
        pending = self.mazal('member-sub')
        self.admin('PUT', f'/{pending}', body={'state': 'in'})
        status, item = self.admin('PUT', f'/{pending}', body={'state': 'pending'})
        self.assertEqual((status, item['state'], item['source']), (200, 'pending', 'member'))
        self.assertNotIn(pending, self.ids('member-sub'))

    def test_pending_dropped_after_shabbat(self):
        kept, pending = self.mazal(), self.mazal('member-sub')
        with mock.patch.object(routes_sheet, '_now', return_value=at(2026, 11, 1, 0, 0)):
            self.assertEqual(self.ids(), [kept])
        with mock.patch.object(routes_sheet, '_now', return_value=at(2026, 10, 31, 23, 0)):
            self.assertEqual(sorted(self.ids()), sorted([kept, pending]))

    def test_move_up_down_and_edges(self):
        a, b, c = (self.free(t) for t in 'abc')
        move = lambda item, direction: self.admin('POST', f'/{item}/move', body={'direction': direction})
        status, body = move(c, 'up')
        self.assertEqual((status, [i['itemId'] for i in body['items']]), (200, [a, c, b]))
        self.assertEqual(move(a, 'up'), (409, {'error': 'cannot_move'}))
        self.assertEqual(move(b, 'down'), (409, {'error': 'cannot_move'}))
        self.assertEqual([i['itemId'] for i in move(a, 'down')[1]['items']], [c, a, b])
        self.assertEqual(move(a, 'left'), (400, {'error': 'invalid_direction'}))

    def test_move_skips_removed(self):
        a, b, c = (self.free(t) for t in 'abc')
        self.admin('PUT', f'/{b}', body={'state': 'removed'})
        status, body = self.admin('POST', f'/{c}/move', body={'direction': 'up'})
        self.assertEqual([i['itemId'] for i in body['items'] if i['state'] != 'removed'], [c, a])

    def test_line_override_and_clear(self):
        item_id = self.mazal()
        status, item = self.admin('PUT', f'/{item_id}', body={'line': {'text': 'שורה', 'bold': 'מזל'}})
        self.assertEqual((status, item['line']), (200, {'text': 'שורה', 'bold': 'מזל'}))
        self.assertEqual(self.sheet('member-sub')[1]['items'][0]['line']['text'], 'שורה')
        status, item = self.admin('PUT', f'/{item_id}', body={'line': None})
        self.assertEqual(status, 200)
        self.assertNotIn('line', item)
        self.assertNotIn('line', self.sheet()[1]['items'][0])
        free = self.free()
        self.assertEqual(self.admin('PUT', f'/{free}', body={'line': None}), (400, {'error': 'invalid_line'}))
        self.assertEqual(self.admin('PUT', f'/{item_id}', body={'line': {'text': ''}}), (400, {'error': 'invalid_line'}))
        self.assertEqual(self.admin('PUT', f'/{item_id}', body={}), (400, {'error': 'invalid_body'}))
        self.assertEqual(self.admin('PUT', f'/{item_id}', body={'state': 'x'}), (400, {'error': 'invalid_state'}))

    def test_free_item_line_edit(self):
        item_id = self.admin('POST', body={'type': 'celebration', 'text': 'טעות', 'bold': 'מזל'})[1]['itemId']
        status, item = self.admin('PUT', f'/{item_id}', body={'line': {'text': 'תוקן', 'bold': 'טוב'}})
        self.assertEqual((status, item['line'], item['kind']), (200, {'text': 'תוקן', 'bold': 'טוב'}, 'free'))
        self.assertEqual(self.sheet()[1]['items'][0]['line'], {'text': 'תוקן', 'bold': 'טוב'})
        item = self.admin('PUT', f'/{item_id}', body={'line': {'text': 'רק טקסט', 'bold': ''}})[1]
        self.assertEqual(item['line'], {'text': 'רק טקסט', 'bold': ''})
        self.assertEqual(self.admin('PUT', f'/{item_id}', body={'line': {'text': ''}}), (400, {'error': 'invalid_line'}))
        notice = self.free()
        self.assertEqual(self.admin('PUT', f'/{notice}', body={'line': {'text': 'x', 'bold': 'b'}}),
                         (400, {'error': 'invalid_line'}))
        self.assertEqual(self.admin('PUT', f'/{notice}', body={'line': {'text': 'חדש'}})[1]['line']['text'], 'חדש')
        self.assertEqual(self.admin('PUT', f'/{notice}', body={'line': None}), (400, {'error': 'invalid_line'}))

    def test_stale_move_is_try_again(self):
        a, b = self.free('a'), self.free('b')
        stale = self.repo.list_sheet_items(self.k, FRIDAY, int(time.time()))
        self.assertEqual(self.admin('POST', f'/{b}/move', body={'direction': 'up'})[0], 200)
        with self.assertRaises(ApiError) as caught:
            self.repo.swap_sheet_order(self.k, FRIDAY, stale[0], stale[1])
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'try_again'))
        self.assertEqual([i['itemId'] for i in self.sheet()[1]['items']], [b, a])

    def test_free_item_json(self):
        status, item = self.admin('POST', body={'type': 'celebration', 'text': 'א\nב', 'bold': 'מזל טוב',
                                                'source': 'byGabbai'})
        self.assertEqual((status, item['kind'], item['type'], item['group'], item['state'], item['source'],
                          item['line'], item['week']),
                         (201, 'free', 'celebration', 'mazal', 'in', 'byGabbai', {'text': 'א\nב', 'bold': 'מזל טוב'},
                          FRIDAY))
        self.assertEqual(item['postedBy'], 'Gabi Gabbai')
        self.assertNotIn('message', item)
        notice = self.admin('POST', body={'type': 'notice', 'text': 'x'})[1]
        self.assertEqual((notice['group'], notice['source']), ('events', 'free'))

    def test_free_item_validation_and_limit(self):
        bad = lambda body: self.admin('POST', body=body)
        self.assertEqual(bad({'type': 'event', 'text': 'x', 'bold': 'y'}), (400, {'error': 'invalid_bold'}))
        self.assertEqual(bad({'type': 'celebration', 'text': 'x', 'bold': 'y' * 61}), (400, {'error': 'invalid_bold'}))
        self.assertEqual(bad({'type': 'condolence', 'text': 'x'}), (400, {'error': 'invalid_type'}))
        self.assertEqual(bad({'type': 'event', 'text': ''}), (400, {'error': 'invalid_text'}))
        self.assertEqual(bad({'type': 'event', 'text': 'x' * 301}), (400, {'error': 'invalid_text'}))
        self.assertEqual(bad({'type': 'event', 'text': 'a\nb\nc'}), (400, {'error': 'invalid_text'}))
        self.assertEqual(bad({'type': 'event', 'text': 'x', 'source': 'member'}), (400, {'error': 'invalid_source'}))
        self.assertEqual(bad({'type': 'event', 'text': 'x', 'junk': 1}), (400, {'error': 'invalid_body'}))
        for _ in range(40):
            self.free()
        self.assertEqual(bad({'type': 'event', 'text': 'x'}), (409, {'error': 'too_many_items'}))

    def test_week_validation(self):
        self.assertEqual(self.sheet(week='2026-10-29'), (400, {'error': 'invalid_week_start'}))
        self.assertEqual(self.sheet(week='junk'), (400, {'error': 'invalid_week_start'}))
        body = {'type': 'event', 'text': 'x'}
        self.assertEqual(self.admin('POST', body=body, week='2026-10-30')[0], 201)
        self.assertEqual(self.admin('POST', body=body, week='2027-01-01')[0], 400)   # more than 63 days ahead
        self.assertEqual(self.admin('POST', body=body, week='2026-12-25')[0], 201)   # 58 days ahead
        self.assertEqual(self.admin('POST', body=body, week='2026-09-04')[0], 400)   # week expired
        self.assertEqual(self.sheet(week='2026-11-06')[1], {'week': '2026-11-06', 'items': []})

    def test_member_cannot_use_admin_routes(self):
        item = self.free()
        for sub in ('member-sub', 'listener-sub'):
            self.assertEqual(self.admin('POST', sub=sub, body={'type': 'event', 'text': 'x'}), (403, {'error': 'forbidden'}))
            self.assertEqual(self.admin('PUT', f'/{item}', sub=sub, body={'state': 'removed'}), (403, {'error': 'forbidden'}))
            self.assertEqual(self.admin('POST', f'/{item}/move', sub=sub, body={'direction': 'up'}),
                             (403, {'error': 'forbidden'}))
        self.assertEqual(self.sheet('listener-sub')[0], 200)

    def test_unknown_item_404(self):
        self.assertEqual(self.admin('PUT', '/nope', body={'state': 'in'}), (404, {'error': 'item_not_found'}))
        self.assertEqual(self.admin('PUT', '/' + 'A' * 26, body={'state': 'in'}), (404, {'error': 'item_not_found'}))
        self.assertEqual(self.admin('POST', '/nope/move', body={'direction': 'up'}), (404, {'error': 'item_not_found'}))

    def test_other_kehila_404(self):
        pending = self.mazal('member-sub')
        free = self.free()
        before = {i['itemId']: i for i in self.repo.list_sheet_items(self.k, FRIDAY, int(time.time()))}
        other = self.repo.create_kehila('Beit Other', {})
        other_gabbai = self.call('GET', '/v1/me', sub='other-sub')[1]['userId']
        self.repo.put_membership(other, other_gabbai, 'gabbai')
        base = f'/v1/kehilot/{other}'
        denied = (404, {'error': 'item_not_found'})
        for method, path, body in (
                ('GET', f'{base}/sheet/{FRIDAY}', None),
                ('PUT', f'{base}/admin/sheet/{FRIDAY}/items/{pending}', {'state': 'in'}),
                ('PUT', f'{base}/admin/sheet/{FRIDAY}/items/{free}', {'line': {'text': 'x'}}),
                ('POST', f'{base}/admin/sheet/{FRIDAY}/items/{free}/move', {'direction': 'up'})):
            status, answer = self.call(method, path, sub='other-sub', body=body)
            if method == 'GET':
                self.assertEqual((status, answer['items']), (200, []), path)
            else:
                self.assertEqual((status, answer), denied, path)
        after = {i['itemId']: i for i in self.repo.list_sheet_items(self.k, FRIDAY, int(time.time()))}
        self.assertEqual(after, before)
        # and a non-member of the Kehila gets kehila_not_found
        self.assertEqual(self.call('PUT', f'/v1/kehilot/{self.k}/admin/sheet/{FRIDAY}/items/{free}', sub='other-sub',
                                   body={'state': 'removed'}), (404, {'error': 'kehila_not_found'}))
        self.assertEqual(self.call('GET', f'/v1/kehilot/{self.k}/sheet/{FRIDAY}', sub='other-sub')[1],
                         {'error': 'kehila_not_found'})
