import time
from unittest import mock

from moto import mock_aws

from server.cloud import push, routes_messages, sheet_items
from server.cloud.message_fields import event_changes
from server.tests.cloud import test_messages
from server.tests.cloud.test_sheet_items import EVENT, at

SHIVA = {'variant': 'later', 'surname': 'ניסיון', 'deceased': 'יוסף', 'relation': 'אביו של משה'}
FULL = {**SHIVA, 'variant': 'full', 'address': 'רחוב הדוגמה 1', 'hours': '9:00-20:00', 'until': '2026-11-05'}


@mock_aws
class MessageUpdateTest(test_messages.MessagesTest):
    def setUp(self):
        super().setUp()
        self.other = self.add('other-sub', 'member', 'Omri Other')
        self.stranger = self.add('stranger-sub', 'member', 'Sami Stranger')
        for patcher in (mock.patch.object(sheet_items, '_now', return_value=at(2026, 10, 28, 9, 0)),
                        mock.patch.object(push, 'enqueue')):
            patcher.start()
            self.addCleanup(patcher.stop)

    def family(self):
        self.repo.link(self.k, self.quiet, self.other)
        return self.repo.family_of(self.k, self.quiet)['familyId']

    def shiva(self, fid=None, sub='member-sub', fields=SHIVA):
        extra = {'targetMemberId': self.quiet, 'targetFamilyId': fid} if fid else {}
        status, body = self.post('condolences', sub=sub, type='condolence', templateId='condolence', fields=fields,
                                 body='old body', **extra)
        self.assertEqual(status, 201, body)
        return body['messageId']

    def event(self, sub='gabbai-sub', fields=EVENT):
        status, body = self.post('announcements', sub=sub, type='event', templateId='event', fields=fields)
        self.assertEqual(status, 201, body)
        return body['messageId']

    def put(self, mid, sub='member-sub', **extra):
        body = {'title': 'Updated', 'body': 'new body', 'notify': False, **extra}
        return self.call('PUT', f'{self.base()}/messages/{mid}', sub=sub, body=body)

    def stored(self, mid):
        return self.repo.get_message(self.k, mid)

    def test_author_updates_shiva_keeps_id_and_history(self):
        mid = self.shiva(self.family())
        status, body = self.put(mid, fields=FULL)
        self.assertEqual(status, 200, body)
        self.assertEqual((body['messageId'], body['body'], body['fields']['variant'], body['notified']),
                         (mid, 'new body', 'full', False))
        self.assertIn('updatedAt', body)
        for key in ('replyTo', 'canReply', 'isRecipient', 'replied'):
            self.assertIn(key, body)
        self.assertNotIn('history', body)
        got = self.call('GET', f'{self.base()}/messages/{mid}')[1]
        self.assertEqual((got['history'][0]['body'], got['history'][0]['title']), ('old body', 'Shabbat times'))
        self.assertIn('at', got['history'][0])
        self.assertNotIn('by', got['history'][0])
        self.assertNotIn('history', self.call('GET', f'{self.base()}/messages/{mid}', sub='member-sub')[1])
        self.assertNotIn('firstFields', got)
        listed = self.call('GET', f'{self.base()}/messages', query={'limit': '5'})[1]
        self.assertNotIn('history', listed[0])

    def test_tech_sees_history_and_may_update(self):
        mid = self.shiva()
        tech = self.add('tech-sub', 'tech', 'Tali Tech')
        self.assertEqual(self.put(mid, sub='tech-sub', fields=FULL)[0], 200)
        self.assertEqual(len(self.call('GET', f'{self.base()}/messages/{mid}', sub='tech-sub')[1]['history']), 1)
        self.assertEqual(self.stored(mid)['updatedBy'], tech)

    def test_family_adult_may_update_condolence(self):
        mid = self.shiva(self.family())
        self.assertEqual(self.put(mid, sub='other-sub', fields=FULL)[0], 200)
        self.assertEqual(self.put(mid, sub='quiet-sub', fields=FULL)[0], 200)

    def test_family_adult_who_left_cannot_update(self):               # Review Focus 1
        mid = self.shiva(self.family())
        self.assertEqual(self.call('POST', f'{self.base()}/family/unlink', sub='other-sub')[0], 200)
        self.assertEqual(self.put(mid, sub='other-sub', fields=FULL), (403, {'error': 'forbidden'}))
        self.assertEqual(self.put(mid, sub='quiet-sub', fields=FULL)[0], 200)

    def test_condolence_without_target_family_only_author_and_gabbai(self):
        mid = self.shiva()
        self.assertEqual(self.put(mid, sub='quiet-sub', fields=FULL)[0], 403)
        self.assertEqual(self.put(mid, sub='gabbai-sub', fields=FULL)[0], 200)
        self.assertEqual(self.put(mid, sub='member-sub', fields=FULL)[0], 200)

    def test_unrelated_member_and_listener_forbidden(self):
        mid = self.shiva(self.family())
        self.assertEqual(self.put(mid, sub='stranger-sub', fields=FULL), (403, {'error': 'forbidden'}))
        self.assertEqual(self.put(mid, sub='listener-sub', fields=FULL), (403, {'error': 'forbidden'}))

    def test_general_message_not_updatable(self):
        status, body = self.post('announcements', type='general')
        self.assertEqual(status, 201)
        self.assertEqual(self.put(body['messageId'], sub='gabbai-sub'), (409, {'error': 'not_updatable'}))

    def test_chat_message_not_updatable(self):
        chat = self.call('POST', f'{self.base()}/admin/channels', body={
            'name': 'Chat', 'listenersCanRead': False, 'postPolicy': 'management', 'groups': [], 'conversation': True})
        self.assertEqual(chat[0], 201, chat)
        status, msg = self.call('POST', f'{self.base()}/messages', body={'channelId': chat[1]['channelId'], 'body': 'hi'})
        self.assertEqual(status, 201, msg)
        self.assertEqual(self.put(msg['messageId'], sub='gabbai-sub'), (409, {'error': 'not_updatable'}))

    def test_validation(self):
        mid = self.shiva()
        cases = [({'title': ''}, 'invalid_title'), ({'title': 'x' * 121}, 'invalid_title'),
                 ({'body': 'x' * 4001}, 'invalid_body'), ({'notify': 'yes'}, 'invalid_notify'),
                 ({'fields': {**SHIVA, 'x': 1}}, 'invalid_fields')]
        for extra, code in cases:
            with self.subTest(code=code):
                status, body = self.put(mid, **{'fields': SHIVA, **extra})
                self.assertEqual((status, body['error']), (400, code))
        self.assertEqual(self.call('PUT', f'{self.base()}/messages/{mid}', sub='member-sub',
                                   body={'title': 'x', 'body': ''})[1]['error'], 'invalid_fields')
        self.assertEqual(self.call('PUT', f'{self.base()}/messages/{mid}', sub='member-sub',
                                   body={'title': 'x', 'fields': SHIVA})[1]['error'], 'invalid_notify')
        self.assertEqual(self.stored(mid)['body'], 'old body')

    def test_missing_message_404(self):
        self.assertEqual(self.put('0' * 26), (404, {'error': 'message_not_found'}))

    def test_template_is_set_from_type(self):
        status, body = self.post('condolences', type='condolence')
        self.assertEqual(status, 201)
        status, got = self.put(body['messageId'], sub='gabbai-sub', fields=SHIVA)
        self.assertEqual((status, got['templateId']), (200, 'condolence'))

    def test_event_changes_keep_first_values(self):
        mid = self.event()
        self.assertEqual(self.put(mid, sub='gabbai-sub', fields={**EVENT, 'time': '21:00'})[1]['changed'], {'time': '20:30'})
        status, body = self.put(mid, sub='gabbai-sub', fields={**EVENT, 'time': '21:15'})
        self.assertEqual(body['changed'], {'time': '20:30'})
        status, body = self.put(mid, sub='gabbai-sub', fields={**EVENT, 'time': '21:15', 'place': 'אולם'})
        self.assertEqual(body['changed'], {'time': '20:30', 'place': 'בית הכנסת'})
        status, body = self.put(mid, sub='gabbai-sub', fields=EVENT)
        self.assertNotIn('changed', body)
        self.assertNotIn('changed', self.stored(mid))
        self.assertEqual(self.stored(mid)['firstFields']['time'], '20:30')

    def test_event_changes_pure(self):
        self.assertEqual(event_changes(EVENT, {**EVENT, 'name': 'other', 'date': '2026-11-11'}),
                         {'date': EVENT['date']})
        self.assertEqual(event_changes(EVENT, EVENT), {})

    def test_event_date_change_moves_sheet_item(self):                # Review Focus 3
        mid = self.event()
        week_a, week_b = '2026-11-06', '2026-11-13'
        self.assertEqual(len(self.repo.list_sheet_items(self.k, week_a, int(time.time()))), 1)
        self.repo.update_sheet_item(self.k, week_a, mid, {'state': 'pending', 'source': 'member', 'wasPending': True})
        base = f'{self.base()}/admin/sheet/{week_a}/items/{mid}'
        self.assertEqual(self.call('PUT', base, body={'state': 'in'})[0], 200)
        self.assertEqual(self.call('PUT', base, body={'line': {'text': 'שורה'}})[0], 200)
        self.assertEqual(self.put(mid, sub='gabbai-sub', fields={**EVENT, 'date': '2026-11-17'})[0], 200)
        self.assertEqual(self.repo.list_sheet_items(self.k, week_a, int(time.time())), [])
        (moved,) = self.repo.list_sheet_items(self.k, week_b, int(time.time()))
        self.assertEqual((moved['state'], moved['source'], moved['wasPending'], moved['week'], moved['messageId']),
                         ('in', 'approved', True, week_b, mid))
        self.assertNotIn('line', moved)
        self.assertEqual(moved['approvedBy'], self.gabbai)
        self.assertEqual(moved['order'], '12026-11-1720:30' + mid)
        self.assertEqual(self.stored(mid)['sheetWeek'], week_b)

    def test_same_week_update_clears_line_and_keeps_item(self):
        mid = self.shiva(sub='gabbai-sub')
        (item,) = self.repo.list_sheet_items(self.k, '2026-10-30', int(time.time()))
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/sheet/2026-10-30/items/{mid}',
                                   body={'line': {'text': 'שורה'}})[0], 200)
        self.assertEqual(self.put(mid, sub='gabbai-sub', fields=FULL)[0], 200)
        (after,) = self.repo.list_sheet_items(self.k, '2026-10-30', int(time.time()))
        self.assertNotIn('line', after)
        self.assertEqual((after['state'], after['order']), (item['state'], item['order']))

    def test_update_puts_change_and_history_capped_at_10(self):
        mid = self.shiva()
        before = len(self.changes())
        for n in range(12):
            self.assertEqual(self.put(mid, title=f'T{n}', body=f'B{n}', fields=FULL)[0], 200)
        changes = self.changes()[before:]
        self.assertEqual(len(changes), 12)
        self.assertEqual({(c['kind'], c['refId'], c['channelId']) for c in changes},
                         {('message', mid, self.channels['condolences'])})
        history = self.stored(mid)['history']
        self.assertEqual(len(history), 10)
        self.assertEqual((history[0]['body'], history[-1]['body']), ('B1', 'B10'))
        self.assertEqual(set(history[0]), {'title', 'body', 'at', 'by'})

    def test_stale_update_is_try_again(self):
        mid = self.shiva()
        real = self.repo.update_message

        def racing(*args, **kwargs):
            self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'MSG#{mid}'},
                                        UpdateExpression='SET updatedAt = :u', ExpressionAttributeValues={':u': 5})
            return real(*args, **kwargs)
        with mock.patch.object(self.repo, 'update_message', side_effect=racing):
            self.assertEqual(self.put(mid, fields=FULL), (409, {'error': 'try_again'}))
        self.assertEqual(self.stored(mid)['body'], 'old body')

    def test_removed_message_404(self):
        mid = self.shiva()
        self.call('DELETE', f'{self.base()}/messages/{mid}', sub='member-sub')
        self.assertEqual(self.put(mid, fields=FULL), (404, {'error': 'message_not_found'}))

    def test_scrub_removes_update_attributes(self):
        mid = self.event()
        self.put(mid, sub='gabbai-sub', fields={**EVENT, 'time': '21:00'})
        self.assertTrue({'history', 'firstFields', 'changed'} <= set(self.stored(mid)))
        self.repo.scrub_message(self.k, mid)
        self.assertFalse({'history', 'firstFields', 'changed', 'fields'} & set(self.stored(mid)))

    def test_kehila_returns_family_id(self):
        fid = self.family()
        for sub in ('quiet-sub', 'other-sub'):
            self.assertEqual(self.call('GET', self.base(), sub=sub)[1]['familyId'], fid)
        self.assertIsNone(self.call('GET', self.base(), sub='gabbai-sub')[1]['familyId'])
        self.assertNotIn('familyId', self.call('GET', self.base(), sub='listener-sub')[1])

    # carry-over from the Task 4 review: an update keeps the thread and the viewer fields stay right
    def test_update_keeps_replier_count_target_family_and_thread(self):
        fid = self.family()
        mid = self.shiva(fid)
        url = f'{self.base()}/messages/{mid}/replies'
        status, reply = self.call('POST', url, sub='gabbai-sub', body={'body': 'הנחמה'})
        self.assertEqual(status, 201, reply)
        before = self.call('GET', f'{self.base()}/messages/{mid}', sub='gabbai-sub')[1]
        self.assertEqual(before['replierCount'], 1)
        status, body = self.put(mid, fields=FULL)
        self.assertEqual(status, 200, body)
        self.assertEqual((body['replierCount'], body['targetFamilyId'], body['targetMemberId']),
                         (1, fid, self.quiet))
        got = self.call('GET', f'{self.base()}/messages/{mid}', sub='gabbai-sub')[1]
        self.assertEqual((got['replierCount'], got['targetFamilyId']), (1, fid))
        listed = self.call('GET', f'{self.base()}/messages', sub='other-sub')[1]
        self.assertEqual((listed[0]['replierCount'], listed[0]['targetFamilyId']), (1, fid))
        replies = self.call('GET', url, sub='gabbai-sub')[1]
        self.assertEqual([r['body'] for r in replies], ['הנחמה'])
        self.assertEqual(len(self.call('GET', url, sub='other-sub')[1]), 1)  # sent to the family: still seen

    def test_viewer_fields_for_family_adult_after_update(self):
        fid = self.family()
        mid = self.shiva(fid)
        status, body = self.put(mid, sub='other-sub', fields=FULL)   # the family adult updates
        self.assertEqual(status, 200, body)
        self.assertEqual((body['replyTo'], body['canReply'], body['isRecipient'], body['replied']),
                         ('family', False, True, False))
        got = self.call('GET', f'{self.base()}/messages/{mid}', sub='other-sub')[1]
        self.assertEqual((got['replyTo'], got['canReply'], got['isRecipient'], got['replied']),
                         ('family', False, True, False))
        stranger = self.call('GET', f'{self.base()}/messages/{mid}', sub='stranger-sub')[1]
        self.assertEqual((stranger['canReply'], stranger['isRecipient']), (True, False))


for _name in dir(test_messages.MessagesTest):  # the fixtures only: none of the base class's tests
    if _name.startswith('test_') and _name not in MessageUpdateTest.__dict__:
        setattr(MessageUpdateTest, _name, None)


@mock_aws
class NotifyTest(test_messages.MessagesTest):
    T0 = 1_800_000_000

    def setUp(self):
        super().setUp()
        self.t = self.T0
        self.enqueue = mock.patch.object(push, 'enqueue').start()
        for patcher in (mock.patch.object(sheet_items, '_now', return_value=at(2026, 10, 28, 9, 0)),
                        mock.patch.object(routes_messages, '_now', side_effect=lambda: self.t)):
            patcher.start()
        self.addCleanup(mock.patch.stopall)

    def updates(self):
        return [c for c in self.enqueue.call_args_list if c.args[0] == 'message_update']

    def event(self):
        status, body = self.post('announcements', templateId='event', type='event', fields=EVENT)
        self.assertEqual(status, 201, body)
        return body['messageId']

    def put(self, mid, notify=True, sub='gabbai-sub', **fields):
        status, body = self.call('PUT', f'{self.base()}/messages/{mid}', sub=sub,
                                 body={'title': 'Updated', 'body': 'b', 'fields': {**EVENT, **fields}, 'notify': notify})
        self.assertEqual(status, 200, body)
        return body

    def read(self, mid, sub='member-sub'):
        self.assertEqual(self.call('POST', f'{self.base()}/messages/{mid}/read', sub=sub)[0], 204)

    def get(self, mid, sub):
        return self.call('GET', f'{self.base()}/messages/{mid}', sub=sub)[1]

    def test_notify_bumps_marks_unread_and_enqueues(self):
        old = self.event()
        self.t += 5
        self.read(old)
        self.assertTrue(self.get(old, 'member-sub')['read'])
        self.t += 5
        self.event()                  # a newer message, so only the bump can put `old` first
        self.t += 5
        out = self.put(old, time='21:00')
        self.assertTrue(out['notified'])
        self.assertEqual(self.updates(), [mock.call('message_update', self.k, old)])
        self.assertFalse(self.get(old, 'member-sub')['read'])
        self.assertTrue(self.get(old, 'gabbai-sub')['read'])
        first = self.call('GET', f'{self.base()}/messages', sub='member-sub', query={'limit': '1'})[1]
        self.assertEqual(len(first), 2)               # the page plus the merged bump
        self.assertEqual(first[0]['messageId'], old)
        self.assertEqual(first[0]['bumpId'], out['bumpId'])
        self.assertEqual(self.get(old, 'member-sub')['bumpId'], out['bumpId'])
        self.assertFalse(first[0]['read'])
        self.assertTrue(self.call('GET', f'{self.base()}/messages', sub='gabbai-sub', query={'limit': '1'})[1][0]['read'])

    def test_second_notify_within_12h_is_silent(self):              # Review Focus 2
        mid = self.event()
        self.t += 10
        first = self.put(mid, time='21:00')
        self.assertTrue(first['notified'])
        self.t += 60
        self.read(mid)                                   # read after the first bump
        self.t += 3600                                   # +1 h: a correction
        second = self.put(mid, time='21:15')
        self.assertFalse(second['notified'])
        self.assertEqual(second['bumpId'], first['bumpId'])
        self.assertEqual(len(self.updates()), 1)
        self.assertTrue(self.get(mid, 'member-sub')['read'])
        self.assertEqual(self.get(mid, 'member-sub')['fields']['time'], '21:15')   # saved
        self.assertEqual(len(self.repo._query_prefix(self.k, 'BUMP#')), 1)
        self.t = self.T0 + 10 + 12 * 3600 + 1            # 12 h 1 s after the first notify
        third = self.put(mid, time='21:30')
        self.assertTrue(third['notified'])
        self.assertNotEqual(third['bumpId'], first['bumpId'])
        self.assertEqual(len(self.updates()), 2)
        self.assertFalse(self.get(mid, 'member-sub')['read'])

    def test_notify_false_never_bumps(self):
        mid = self.event()
        self.read(mid)
        self.t += 10
        out = self.put(mid, notify=False, time='21:00')
        self.assertFalse(out['notified'])
        self.assertNotIn('bumpId', out)
        self.assertEqual(self.updates(), [])
        self.assertTrue(self.get(mid, 'member-sub')['read'])
        self.assertEqual(self.repo._query_prefix(self.k, 'BUMP#'), [])
        self.assertNotIn('notifiedAt', self.repo.get_message(self.k, mid))

    def test_a_silent_save_does_not_use_up_the_window(self):
        mid = self.event()
        self.t += 10
        self.put(mid, notify=False, time='21:00')
        self.assertTrue(self.put(mid, time='21:15')['notified'])

    def test_before_cursor_ignores_bumps(self):
        old = self.event()
        self.t += 5
        newer = self.event()
        self.t += 5
        self.put(old, time='21:00')
        page = self.call('GET', f'{self.base()}/messages', query={'before': newer})[1]
        self.assertEqual(page, [])    # `old` is shown by the first page while its bump is live

    def test_bumped_message_appears_once_across_pages(self):
        ids = []
        for _ in range(6):
            ids.append(self.event())
            self.t += 5
        self.put(ids[0], time='21:00')      # the oldest moves to the top
        first = self.call('GET', f'{self.base()}/messages', query={'limit': '3'})[1]
        self.assertEqual(first[0]['messageId'], ids[0])
        seen = [m['messageId'] for m in first]
        while True:
            rest = self.call('GET', f'{self.base()}/messages', query={'limit': '3', 'before': first[-1]['messageId']})[1]
            if not rest:
                break
            seen += [m['messageId'] for m in rest]
            first = rest
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(set(seen), set(ids))

    def test_expired_bump_stops_moving_the_message(self):
        old = self.event()
        self.t += 5
        self.event()
        self.t += 5
        self.put(old, time='21:00')
        self.t += 15 * 86400
        listing = self.call('GET', f'{self.base()}/messages', query={'limit': '1'})[1]
        self.assertNotEqual(listing[0]['messageId'], old)
        before = self.call('GET', f'{self.base()}/messages', query={'before': listing[0]['messageId']})[1]
        self.assertEqual([m['messageId'] for m in before], [old])

    def test_bump_write_failure_leaves_window_unclaimed(self):
        mid = self.event()
        self.t += 5
        with mock.patch.object(self.repo, 'put_bump', side_effect=RuntimeError('boom')):
            status, _ = self.call('PUT', f'{self.base()}/messages/{mid}',
                                  body={'title': 'U', 'body': 'b', 'fields': {**EVENT, 'time': '21:00'}, 'notify': True})
        self.assertEqual(status, 500)
        self.assertNotIn('notifiedAt', self.repo.get_message(self.k, mid))
        self.assertTrue(self.put(mid, time='21:15')['notified'])

    def test_merge_exceeds_limit_and_skips_removed_and_hidden(self):
        ids = []
        for _ in range(3):
            ids.append(self.event())
            self.t += 5
        a, b, _ = ids
        for _ in range(8):
            self.post('announcements', type='general')   # push a, b out of a limit-3 page
        self.t += 5
        self.put(a, time='21:00')
        listing = self.call('GET', f'{self.base()}/messages', query={'limit': '3'})[1]
        self.assertEqual(listing[0]['messageId'], a)
        self.assertEqual(len(listing), 4)
        self.assertEqual(len({m['messageId'] for m in listing}), 4)
        self.t += 5
        self.put(b, time='21:00')
        self.call('DELETE', f'{self.base()}/messages/{b}')
        listing = self.call('GET', f'{self.base()}/messages', query={'limit': '3'})[1]
        self.assertNotIn(b, [m['messageId'] for m in listing])

    def test_short_page_gets_all_bumps(self):
        mid = self.event()
        self.t += 5
        self.put(mid, time='21:00')
        listing = self.call('GET', f'{self.base()}/messages', query={'limit': '50'})[1]
        self.assertEqual([m['messageId'] for m in listing], [mid])

    def test_updater_who_is_not_author_reads_own_bump(self):
        mid = self.event()
        self.t += 10
        self.put(mid, sub='gabbai-sub', time='21:00')
        self.assertTrue(self.get(mid, 'gabbai-sub')['read'])
        self.assertFalse(self.get(mid, 'member-sub')['read'])

    def test_read_uses_the_route_clock(self):
        mid = self.event()
        self.t += 10
        self.put(mid, time='21:00')
        self.t += 1
        self.read(mid)
        self.assertTrue(self.get(mid, 'member-sub')['read'])


for _name in dir(test_messages.MessagesTest):  # the fixtures only: none of the base class's tests
    if _name.startswith('test_') and _name not in NotifyTest.__dict__:
        setattr(NotifyTest, _name, None)
