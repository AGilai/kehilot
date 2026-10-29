import time
from unittest import mock

from moto import mock_aws

from server.cloud import push, sheet_items
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


for _name in dir(test_messages.MessagesTest):  # the fixtures only: none of the base class's tests
    if _name.startswith('test_') and _name not in MessageUpdateTest.__dict__:
        setattr(MessageUpdateTest, _name, None)
