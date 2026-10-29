import time
import unittest
from datetime import date, datetime, timezone
from unittest import mock
from zoneinfo import ZoneInfo

from moto import mock_aws

from server.cloud import push, sheet_items
from server.cloud.errors import ApiError
from server.cloud.sheet_rules import (appended_order, default_order, initial_state, pending_expired, sheet_members,
                                      week_for_post)
from server.tests.cloud import test_messages

J = ZoneInfo('Asia/Jerusalem')
MAZAL = {'occasion': 'other', 'occasionOther': 'ברית', 'whose': 'other', 'whoseOther': 'חברים', 'surname': 'דוגמה'}
EVENT = {'name': 'ערב לימוד', 'date': '2026-11-10', 'time': '20:30', 'place': 'בית הכנסת', 'for': 'all'}
FRIDAY = '2026-10-30'


def at(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm, tzinfo=J).astimezone(timezone.utc)


class RulesTest(unittest.TestCase):
    def test_week_for_post_friday_noon_and_saturday(self):          # Review Focus 5
        self.assertEqual(week_for_post(at(2026, 10, 30, 11, 59), 'celebration', None), date(2026, 10, 30))
        self.assertEqual(week_for_post(at(2026, 10, 30, 12, 0), 'celebration', None), date(2026, 11, 6))
        self.assertEqual(week_for_post(at(2026, 10, 31, 21, 0), 'condolence', None), date(2026, 11, 6))
        self.assertEqual(week_for_post(at(2026, 10, 25, 9, 0), 'celebration', None), date(2026, 10, 30))
        self.assertEqual(week_for_post(at(2026, 3, 27, 11, 30), 'celebration', None), date(2026, 3, 27))  # DST Friday
        self.assertEqual(week_for_post(at(2026, 10, 28, 9, 0), 'event', {'date': '2026-11-10'}), date(2026, 11, 6))

    def test_event_week_edges(self):
        self.assertEqual(week_for_post(at(2026, 10, 28, 9, 0), 'event', {'date': '2026-11-06'}), date(2026, 11, 6))
        self.assertEqual(week_for_post(at(2026, 10, 28, 9, 0), 'event', {'date': '2026-11-12'}), date(2026, 11, 6))
        self.assertEqual(week_for_post(at(2026, 10, 28, 9, 0), 'event', {'date': '2026-11-13'}), date(2026, 11, 13))
        self.assertEqual(week_for_post(at(2026, 10, 31, 21, 0), 'event', None), date(2026, 11, 6))  # free text

    def test_pending_expires_after_shabbat(self):
        self.assertFalse(pending_expired(date(2026, 10, 30), at(2026, 10, 31, 23, 59)))
        self.assertTrue(pending_expired(date(2026, 10, 30), at(2026, 11, 1, 0, 0)))

    def test_initial_state_and_setting(self):
        self.assertEqual(initial_state('gabbai', 'approve'), ('in', 'auto'))
        self.assertEqual(initial_state('member', 'auto'), ('in', 'auto'))
        self.assertEqual(initial_state('member', 'approve'), ('pending', 'member'))
        self.assertEqual(sheet_members({}), 'approve')
        self.assertEqual(sheet_members({'sheetMembers': 'auto'}), 'auto')
        self.assertEqual(sheet_members({'sheetMembers': 'junk'}), 'approve')

    def test_orders(self):
        self.assertEqual(default_order('event', 'M1', EVENT), '12026-11-1020:30M1')
        self.assertEqual(default_order('event', 'M1', None), '1M1')
        self.assertEqual(default_order('celebration', 'M1', MAZAL), '1M1')
        self.assertTrue(appended_order().startswith('2'))
        self.assertGreater(appended_order(), default_order('event', 'Z' * 26, EVENT))


@mock_aws
class SheetItemsTest(test_messages.MessagesTest):
    def setUp(self):
        super().setUp()
        patcher = mock.patch.object(sheet_items, '_now', return_value=at(2026, 10, 28, 9, 0))
        patcher.start()
        self.addCleanup(patcher.stop)
        enqueue = mock.patch.object(push, 'enqueue')
        enqueue.start()
        self.addCleanup(enqueue.stop)

    def items(self, friday=FRIDAY):
        return self.repo.list_sheet_items(self.k, friday, int(time.time()))

    def mazal(self, sub='gabbai-sub'):
        return self.post('simchas', sub=sub, type='celebration', templateId='mazal', fields=MAZAL)[1]

    def test_gabbai_post_goes_in_auto(self):
        message = self.mazal()
        (item,) = self.items()
        self.assertEqual((item['itemId'], item['state'], item['source'], item['wasPending'], item['kind'],
                          item['group'], item['week'], item['type'], item['messageId']),
                         (message['messageId'], 'in', 'auto', False, 'message', 'mazal', FRIDAY, 'celebration',
                          message['messageId']))
        self.assertEqual(item['order'], '1' + message['messageId'])
        self.assertEqual(self.repo.get_message(self.k, message['messageId'])['sheetWeek'], FRIDAY)

    def test_gabbai_condolence_goes_in_auto(self):
        self.post('condolences', type='condolence')
        (item,) = self.items()
        self.assertEqual((item['group'], item['state'], item['source']), ('condolence', 'in', 'auto'))

    def test_templated_event_week_and_order(self):
        message = self.post('announcements', type='event', templateId='event', fields=EVENT)[1]
        (item,) = self.items('2026-11-06')
        self.assertEqual((item['group'], item['order']), ('events', '12026-11-1020:30' + message['messageId']))

    def test_member_post_is_pending_by_default(self):
        self.mazal('member-sub')
        (item,) = self.items()
        self.assertEqual((item['state'], item['source'], item['wasPending']), ('pending', 'member', True))

    def test_member_post_auto_when_setting_auto(self):
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/settings', body={'sheetMembers': 'auto'})[0], 200)
        self.mazal('member-sub')
        (item,) = self.items()
        self.assertEqual((item['state'], item['source'], item['wasPending']), ('in', 'auto', False))

    def test_general_and_weekly_make_no_item(self):
        self.post('announcements', type='general')
        self.post('announcements', type='weekly')
        self.assertEqual(self.items(), [])
        self.assertEqual(self.repo.table.scan()['Items'] and
                         [i for i in self.repo.table.scan()['Items'] if 'SHI#' in i['sk']], [])

    def test_group_channel_post_makes_no_item(self):        # final review M-2: the printed sheet is whole-Kehila
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f"C#{self.channels['simchas']}"},
                                    UpdateExpression='SET #g = :g', ExpressionAttributeNames={'#g': 'groups'},
                                    ExpressionAttributeValues={':g': ['grp-women']})
        self.assertEqual(self.post('simchas', type='celebration', templateId='mazal', fields=MAZAL)[0], 201)
        self.assertEqual(self.items(), [])
        self.assertEqual(self.post('announcements', type='condolence')[0], 201)   # a whole-Kehila channel still does
        self.assertEqual(len(self.items()), 1)

    def test_removed_message_removes_item(self):
        message = self.mazal()
        self.assertEqual(self.call('DELETE', f"{self.base()}/messages/{message['messageId']}")[0], 204)
        self.assertEqual(self.items(), [])

    def test_scrubbed_message_removes_item(self):
        from server.cloud import posts
        message = self.mazal('member-sub')
        self.assertEqual(len(self.items()), 1)
        posts.delete_posts(self.repo, self.member)
        self.assertEqual(self.items(), [])

    def test_settings_sheet_members_validation(self):
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/settings', body={'sheetMembers': 'x'}),
                         (400, {'error': 'invalid_sheet_members'}))

    def test_kehila_returns_sheet_members_to_members(self):
        for sub in ('gabbai-sub', 'member-sub'):
            self.assertEqual(self.call('GET', self.base(), sub=sub)[1]['sheetMembers'], 'approve')
        self.call('PUT', f'{self.base()}/admin/settings', body={'sheetMembers': 'auto'})
        self.assertEqual(self.call('GET', self.base(), sub='member-sub')[1]['sheetMembers'], 'auto')
        self.assertNotIn('sheetMembers', self.call('GET', self.base(), sub='listener-sub')[1])


@mock_aws
class SheetRepoTest(test_messages.MessagesTest):
    def item(self, item_id, order, group='mazal'):
        return {'itemId': item_id, 'week': FRIDAY, 'kind': 'free', 'type': 'free', 'group': group, 'state': 'in',
                'source': 'free', 'wasPending': False, 'order': order, 'createdAt': 1, 'line': {'text': 'x', 'bold': False}}

    def test_put_get_list_update_swap_delete(self):
        r, k = self.repo, self.k
        a = r.put_sheet_item(k, FRIDAY, self.item('A', '1a'))
        r.put_sheet_item(k, FRIDAY, self.item('B', '1b'))
        r.put_sheet_item(k, FRIDAY, self.item('C', '1c', 'events'))
        again = r.put_sheet_item(k, FRIDAY, self.item('A', '9z'))  # retried post: no duplicate, no overwrite
        self.assertEqual(again['order'], '1a')
        listed = r.list_sheet_items(k, FRIDAY, 10)
        self.assertEqual([i['itemId'] for i in listed], ['C', 'A', 'B'])  # sorted by (group, order)
        self.assertEqual(r.list_sheet_items(k, FRIDAY, int(a['expiresAt'])), [])
        self.assertEqual(r.list_sheet_items(k, '2026-11-06', 10), [])
        new = r.update_sheet_item(k, FRIDAY, 'A', {'state': 'removed'}, ('line',))
        self.assertEqual((new['state'], 'line' in new), ('removed', False))
        with self.assertRaises(ApiError) as e:
            r.update_sheet_item(k, FRIDAY, 'NOPE', {'state': 'in'})
        self.assertEqual((e.exception.status, e.exception.code), (404, 'item_not_found'))
        x, y = r.get_sheet_item(k, FRIDAY, 'A'), r.get_sheet_item(k, FRIDAY, 'B')
        r.swap_sheet_order(k, FRIDAY, x, y)
        self.assertEqual((r.get_sheet_item(k, FRIDAY, 'A')['order'], r.get_sheet_item(k, FRIDAY, 'B')['order']),
                         ('1b', '1a'))
        with self.assertRaises(ApiError) as e:  # stale read
            r.swap_sheet_order(k, FRIDAY, x, y)
        self.assertEqual((e.exception.status, e.exception.code), (409, 'try_again'))
        r.delete_sheet_item(k, FRIDAY, 'A')
        self.assertIsNone(r.get_sheet_item(k, FRIDAY, 'A'))

    def test_set_message_sheet_week(self):
        m = self.repo.put_message(self.k, self.channels['simchas'], 'celebration', 't', 'b', self.member, 'M', 'member', None)
        mid = m['sk'][4:]
        self.repo.set_message_sheet_week(self.k, mid, FRIDAY)
        self.assertEqual(self.repo.get_message(self.k, mid)['sheetWeek'], FRIDAY)
        self.repo.set_message_sheet_week(self.k, mid, None)
        self.assertNotIn('sheetWeek', self.repo.get_message(self.k, mid))


if __name__ == '__main__':
    unittest.main()
