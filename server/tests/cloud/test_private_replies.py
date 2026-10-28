import time
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import private_replies, push, routes_changes
from server.cloud.ids import new_id
from server.tests.cloud import test_messages
from server.tests.cloud.helpers import set_type_rules

WHOLE = {'name': 'announcements'}
GROUPED = {'name': 'announcements', 'groups': {'g1'}}
CHAT = {'name': 'chat', 'conversation': True}


def msg(type_, kind='member', **extra):
    return {'type': type_, 'authorKind': kind, **extra}


class RouteTableTest(unittest.TestCase):
    def test_reply_route_table(self):
        rows = [
            (msg('general'), WHOLE, 'author'),
            (msg('event'), WHOLE, 'author'),
            (msg('general', 'management'), WHOLE, None),
            (msg('event', 'management'), WHOLE, None),
            (msg('celebration', 'management', targetMemberId='u1'), WHOLE, 'family'),
            (msg('celebration', targetMemberId='u1'), WHOLE, 'family'),
            (msg('condolence', targetMemberId='u1'), WHOLE, 'family'),
            (msg('condolence'), WHOLE, None),
            (msg('celebration', 'management'), WHOLE, None),
            (msg('weekly', 'management'), WHOLE, None),
            (msg('weekly'), WHOLE, None),
            (msg('chat'), CHAT, None),
            (msg('general'), GROUPED, None),
            (msg('general'), CHAT, None),
            (msg('general'), None, None),
            (msg('general', removed=True), WHOLE, None),
            (msg('celebration', targetMemberId='u1', removed=True), WHOLE, None),
        ]
        for message, channel, expected in rows:
            self.assertEqual(private_replies.reply_route(message, channel), expected, (message, channel))


@mock_aws
class ReplyRuleTest(test_messages.MessagesTest):
    def setUp(self):
        super().setUp()
        self.tech = self.add('tech-sub', 'tech', 'Tal Tech')
        self.rotem = self.add('rotem-sub', 'member', 'רותם אלמוג', True)
        self.other = self.add('other-sub', 'member', 'Omri Other')
        self.repo.link(self.k, self.quiet, self.other)
        self.clock_offset = 10  # past the feed's hold-back, so fresh changes are served
        patcher = mock.patch.object(routes_changes, '_now_ms',
                                    side_effect=lambda: int((time.time() + self.clock_offset) * 1000))
        patcher.start()
        self.addCleanup(patcher.stop)

    def msg_url(self, mid):
        return f'{self.base()}/messages/{mid}'

    def get(self, mid, sub):
        status, body = self.call('GET', self.msg_url(mid), sub=sub)
        self.assertEqual(status, 200)
        return body

    def blessing(self, sub='gabbai-sub'):
        status, body = self.post('simchas', sub=sub, type='celebration', targetMemberId=self.quiet)
        self.assertEqual(status, 201)
        return body['messageId']

    def member_general(self):
        status, body = self.post('announcements', sub='member-sub', type='general')
        self.assertEqual(status, 201, body)
        return body

    def test_member_message_answerable_management_not(self):
        body = self.member_general()
        self.assertEqual((body['replyTo'], body['replierCount']), ('author', 0))
        for sub in ('gabbai-sub', 'tech-sub'):
            status, posted = self.post('announcements', sub=sub, type='general')
            self.assertEqual(status, 201)
            self.assertNotIn('replyTo', posted)
            self.assertNotIn('replierCount', posted)

    def test_management_blessing_takes_blessings(self):
        mid = self.blessing()
        self.assertEqual(self.get(mid, 'rotem-sub')['replyTo'], 'family')
        self.assertTrue(self.get(mid, 'rotem-sub')['canReply'])

    def test_viewer_fields_per_person(self):
        mid = self.member_general()['messageId']
        author = self.get(mid, 'member-sub')
        self.assertEqual((author['canReply'], author['isRecipient']), (False, True))
        other = self.get(mid, 'rotem-sub')
        self.assertEqual((other['canReply'], other['isRecipient'], other['replied']), (True, False, False))
        self.assertTrue(self.get(mid, 'gabbai-sub')['canReply'])
        listener = self.get(mid, 'listener-sub')
        self.assertEqual((listener['canReply'], listener['isRecipient']), (False, False))
        b = self.blessing()
        for sub in ('quiet-sub', 'other-sub'):
            got = self.get(b, sub)
            self.assertEqual((got['canReply'], got['isRecipient']), (False, True), sub)

    def test_replied_marker(self):
        mid = self.member_general()['messageId']
        self.repo.table.put_item(Item={'pk': f'K#{self.k}#MSG#{mid}', 'sk': f'RP#{self.rotem}'})
        self.assertTrue(self.get(mid, 'rotem-sub')['replied'])
        self.assertFalse(self.get(mid, 'other-sub')['replied'])

    def test_list_and_feed_carry_viewer_fields(self):
        self.clock_offset = 0
        start = self.call('GET', f'{self.base()}/changes', sub='rotem-sub')[1]['cursor']
        self.clock_offset = 10
        mid = self.member_general()['messageId']
        fields = ('replyTo', 'canReply', 'isRecipient', 'replied')
        status, listed = self.call('GET', f'{self.base()}/messages', sub='rotem-sub')
        row = next(m for m in listed if m['messageId'] == mid)
        for f in fields:
            self.assertIn(f, row)
        self.assertNotIn('replyAdults', row)
        self.repo.put_change(self.k, 'reply_count', mid, self.channels['announcements'])
        status, feed = self.call('GET', f'{self.base()}/changes', sub='rotem-sub', query={'since': start})
        self.assertEqual(status, 200)
        items = [c['item'] for c in feed['changes'] if c['kind'] == 'reply_count']
        self.assertTrue(items)
        for f in fields:
            self.assertIn(f, items[0])
        self.assertTrue(items[0]['canReply'])

    def test_detail_reply_adults_in_family_order(self):
        mid = self.blessing()
        adults = self.repo.family_of(self.k, self.quiet)['adults']
        names = {self.quiet: 'Quinn Quiet', self.other: 'Omri Other'}
        got = self.get(mid, 'rotem-sub')
        self.assertEqual(got['replyAdults'], [{'userId': u, 'name': names[u]} for u in adults])
        status, listed = self.call('GET', f'{self.base()}/messages', sub='rotem-sub')
        self.assertNotIn('replyAdults', next(m for m in listed if m['messageId'] == mid))
        self.assertNotIn('replyAdults', self.get(mid, 'quiet-sub'))

    def test_detail_one_adult_family(self):
        status, body = self.post('simchas', sub='gabbai-sub', type='celebration', targetMemberId=self.rotem)
        got = self.get(body['messageId'], 'member-sub')
        self.assertEqual(len(got['replyAdults']), 1)

    def test_reply_blocked_author_left(self):
        mid = self.member_general()['messageId']
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='member-sub')[0], 204)
        got = self.get(mid, 'rotem-sub')
        self.assertEqual((got['canReply'], got['replyBlocked']), (False, 'author_left'))

    def test_reply_blocked_target_left(self):
        mid = self.blessing()
        for sub in ('quiet-sub', 'other-sub'):
            self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub=sub)[0], 204)
        got = self.get(mid, 'rotem-sub')
        self.assertEqual((got['canReply'], got['replyBlocked']), (False, 'target_left'))
        self.assertNotIn('replyAdults', got)

    def test_rule_follows_stored_author_kind(self):
        mid = self.member_general()['messageId']
        self.repo.put_membership(self.k, self.member, 'gabbai')
        self.assertEqual(self.get(mid, 'rotem-sub')['replyTo'], 'author')

    def test_legacy_blessing_in_group_channel_keeps_count(self):
        mid = self.blessing()
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'C#{self.channels["simchas"]}'},
                                    UpdateExpression='SET #g = :g', ExpressionAttributeNames={'#g': 'groups'},
                                    ExpressionAttributeValues={':g': {'g1'}})
        got = self.get(mid, 'gabbai-sub')
        self.assertNotIn('replyTo', got)
        self.assertEqual(got['replierCount'], 0)


for _name in dir(test_messages.MessagesTest):  # the messages fixtures only, none of its tests
    if _name.startswith('test_') and _name not in vars(ReplyRuleTest):
        setattr(ReplyRuleTest, _name, None)


@mock_aws
class ReplyFlowTest(test_messages.MessagesTest):
    """Writing, editing, deleting and reading replies, and the mailbox. Fixture names are invented."""

    def setUp(self):
        super().setUp()
        self.tech = self.add('tech-sub', 'tech', 'Tal Tech')
        self.rotem = self.add('rotem-sub', 'member', 'רותם אלמוג')
        self.shul = self.add('shul-sub', 'member', 'שולמית ברקן')
        self.yigal = self.add('yigal-sub', 'member', 'יגאל ברקן')
        self.dana = self.add('dana-sub', 'member', 'דנה בדיוני')
        self.ron = self.add('ron-sub', 'member', 'רון לדוגמה')
        self.repo.link(self.k, self.shul, self.yigal)
        self.ids = {'member-sub': self.member, 'rotem-sub': self.rotem, 'shul-sub': self.shul,
                    'yigal-sub': self.yigal, 'dana-sub': self.dana, 'ron-sub': self.ron, 'quiet-sub': self.quiet,
                    'gabbai-sub': self.gabbai, 'tech-sub': self.tech, 'listener-sub': self.listener}
        self.clock_offset = 0
        patcher = mock.patch.object(routes_changes, '_now_ms',
                                    side_effect=lambda: int((time.time() + self.clock_offset) * 1000))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.start = self.call('GET', f'{self.base()}/changes', sub='gabbai-sub')[1]['cursor']
        self.clock_offset = 10

    # helpers
    def general(self, sub='member-sub'):
        status, body = self.post('announcements', sub=sub, type='general')
        self.assertEqual(status, 201, body)
        return body['messageId']

    def blessing(self, target=None, sub='gabbai-sub'):
        status, body = self.post('simchas', sub=sub, type='celebration', targetMemberId=target or self.shul)
        self.assertEqual(status, 201, body)
        return body['messageId']

    def url(self, mid, tail=''):
        return f'{self.base()}/messages/{mid}/replies{tail}'

    def reply(self, sub, mid, body='ברכה', **extra):
        return self.call('POST', self.url(mid), sub=sub, body={'body': body, **extra})

    def sent(self, sub, mid, body='ברכה', **extra):
        status, out = self.reply(sub, mid, body, **extra)
        self.assertEqual(status, 201, out)
        return out

    def replies(self, sub, mid):
        status, body = self.call('GET', self.url(mid), sub=sub)
        self.assertEqual(status, 200, body)
        return body

    def read(self, sub, mid, up_to):
        return self.call('POST', self.url(mid, '/read'), sub=sub, body={'upTo': up_to})

    def inbox(self, sub):
        status, body = self.call('GET', f'{self.base()}/replies/inbox', sub=sub)
        self.assertEqual(status, 200, body)
        return body

    def card(self, sub, mid):
        return self.call('GET', f'{self.base()}/messages/{mid}', sub=sub)[1]

    def feed(self, sub, kind=None):
        status, body = self.call('GET', f'{self.base()}/changes', sub=sub, query={'since': self.start})
        self.assertEqual(status, 200)
        return [c for c in body['changes'] if kind is None or c['kind'] == kind]

    def partition(self, pk, prefix):
        from boto3.dynamodb.conditions import Key
        return self.repo.table.query(KeyConditionExpression=Key('pk').eq(pk) & Key('sk').begins_with(prefix))['Items']

    # the cases of the brief
    def test_reply_to_author_seen_by_writer_and_author_only(self):
        mid = self.general()
        sent = self.sent('rotem-sub', mid, 'שלום')
        self.assertEqual(sent['to'], 'author')
        for sub in ('quiet-sub', 'gabbai-sub', 'tech-sub', 'shul-sub'):
            self.assertEqual(self.replies(sub, mid), [], sub)
        mine = self.replies('rotem-sub', mid)
        self.assertEqual([r['body'] for r in mine], ['שלום'])
        self.assertNotIn('unread', mine[0])
        got = self.replies('member-sub', mid)
        self.assertEqual([(r['body'], r['unread'], r['personal']) for r in got], [('שלום', True, False)])
        self.assertEqual(self.read('member-sub', mid, got[0]['replyId'])[0], 204)
        self.assertFalse(self.replies('member-sub', mid)[0]['unread'])

    def test_one_reply_per_person(self):
        mid = self.general()
        self.sent('rotem-sub', mid)
        self.assertEqual(self.reply('rotem-sub', mid, 'עוד'), (409, {'error': 'already_replied'}))
        self.assertEqual(self.card('gabbai-sub', mid)['replierCount'], 1)
        self.assertEqual(len(self.partition(f'K#{self.k}#MSG#{mid}', 'R#')), 1)

    def test_edit_by_writer_only(self):
        mid = self.general()
        sent = self.sent('rotem-sub', mid, 'לפני')
        url = self.url(mid, f"/{sent['replyId']}")
        status, edited = self.call('PUT', url, sub='rotem-sub', body={'body': 'אחרי', 'to': 'family'})
        self.assertEqual((status, edited['body'], edited['to']), (200, 'אחרי', 'author'))
        self.assertIn('updatedAt', edited)
        change = [c for c in self.feed('rotem-sub', 'reply')]
        self.assertEqual([c['id'] for c in change], [sent['replyId']] * 2)
        self.assertEqual(change[-1]['item']['body'], 'אחרי')
        self.assertEqual(self.call('PUT', url, sub='member-sub', body={'body': 'x'}), (404, {'error': 'reply_not_found'}))
        self.assertEqual(self.call('PUT', url, sub='gabbai-sub', body={'body': 'x'}), (404, {'error': 'reply_not_found'}))
        self.assertEqual(self.call('PUT', self.url(mid, '/nope'), sub='rotem-sub', body={'body': 'x'})[1],
                         {'error': 'reply_not_found'})
        self.assertEqual(self.replies('member-sub', mid)[0]['body'], 'אחרי')

    def test_delete_by_writer_drops_count(self):
        mid = self.general()
        sent = self.sent('rotem-sub', mid)
        url = self.url(mid, f"/{sent['replyId']}")
        self.assertEqual(self.call('DELETE', url, sub='member-sub'), (404, {'error': 'reply_not_found'}))
        self.assertEqual(self.call('DELETE', url, sub='rotem-sub'), (204, None))
        self.assertEqual(self.card('gabbai-sub', mid)['replierCount'], 0)
        kinds = [c['kind'] for c in self.changes()]
        self.assertIn('reply_removed', kinds)
        self.assertEqual(kinds.count('reply_count'), 2)
        removed = self.feed('member-sub', 'reply_removed')
        self.assertEqual(removed[0]['item'], {'id': sent['replyId'], 'messageId': mid})
        self.assertEqual(self.feed('quiet-sub', 'reply_removed'), [])
        self.assertEqual(self.call('DELETE', url, sub='rotem-sub'), (404, {'error': 'reply_not_found'}))
        self.assertEqual(self.reply('rotem-sub', mid)[0], 201)

    def test_body_limits(self):
        mid = self.general()
        self.assertEqual(self.reply('rotem-sub', mid, '😀' * 1001), (400, {'error': 'invalid_body'}))
        self.assertEqual(self.reply('rotem-sub', mid, '  \n '), (400, {'error': 'invalid_body'}))
        self.assertEqual(self.reply('rotem-sub', mid, '😀' * 1000)[0], 201)

    def test_personal_reply_seen_only_by_chosen_adult(self):
        mid = self.blessing()
        sent = self.sent('member-sub', mid, 'סוד', to=self.shul)
        self.assertEqual(sent['to'], self.shul)
        self.assertEqual(sent['toName'], 'שולמית ברקן')
        got = self.replies('shul-sub', mid)
        self.assertEqual([(r['body'], r['personal'], r['unread']) for r in got], [('סוד', True, True)])
        self.assertNotIn('toName', got[0])
        for sub in ('yigal-sub', 'gabbai-sub', 'tech-sub', 'rotem-sub', 'quiet-sub'):
            self.assertEqual(self.replies(sub, mid), [], sub)
            self.assertEqual(self.inbox(sub), {'unread': 0, 'threads': []}, sub)
        self.assertEqual([c for c in self.feed('yigal-sub', 'reply')], [])
        self.assertEqual([c['item']['body'] for c in self.feed('shul-sub', 'reply')], ['סוד'])
        for sub in self.ids:
            if sub != 'listener-sub':
                self.assertEqual(self.card(sub, mid)['replierCount'], 1, sub)
        self.assertEqual(self.read('yigal-sub', mid, sent['replyId'])[0], 204)
        self.assertEqual(self.repo.seen_marks(self.k, self.yigal, [mid]), {})
        self.assertEqual(self.replies('member-sub', mid)[0]['toName'], 'שולמית ברקן')

    def test_family_reply_seen_by_both_adults_with_separate_unread(self):
        mid = self.blessing()
        sent = self.sent('member-sub', mid, 'מזל טוב')
        self.assertEqual(sent['to'], 'family')
        self.assertEqual([r['body'] for r in self.replies('yigal-sub', mid)], ['מזל טוב'])
        self.assertEqual(self.read('shul-sub', mid, sent['replyId'])[0], 204)
        self.assertFalse(self.replies('shul-sub', mid)[0]['unread'])
        self.assertTrue(self.replies('yigal-sub', mid)[0]['unread'])
        self.assertEqual((self.inbox('shul-sub')['unread'], self.inbox('yigal-sub')['unread']), (0, 1))

    def test_partner_linked_later_sees_family_not_personal(self):
        mid = self.blessing(self.dana)
        self.sent('member-sub', mid, 'לכולם')
        self.sent('rotem-sub', mid, 'לדנה', to=self.dana)
        self.assertEqual(self.replies('ron-sub', mid), [])
        self.repo.link(self.k, self.dana, self.ron)
        self.assertEqual([r['body'] for r in self.replies('ron-sub', mid)], ['לכולם'])
        self.assertEqual(sorted(r['body'] for r in self.replies('dana-sub', mid)), ['לדנה', 'לכולם'])
        self.assertEqual([c['item']['body'] for c in self.feed('ron-sub', 'reply')], ['לכולם'])
        threads = self.inbox('ron-sub')['threads']
        self.assertEqual([(t['total'], t['personal']) for t in threads], [(1, 0)])

    def test_personal_reply_after_unlink_stays_with_adult(self):
        mid = self.blessing()
        self.sent('member-sub', mid, 'לשולמית', to=self.shul)
        self.assertEqual(self.call('POST', f'{self.base()}/family/unlink', sub='shul-sub')[0], 200)
        self.assertEqual([r['body'] for r in self.replies('shul-sub', mid)], ['לשולמית'])
        self.assertEqual(self.replies('yigal-sub', mid), [])
        self.assertEqual(self.inbox('yigal-sub')['threads'], [])
        self.assertEqual(self.inbox('shul-sub')['threads'][0]['personal'], 1)

    def test_to_validation(self):
        mid = self.blessing()
        for to in (self.listener, self.rotem, self.dana, self.gabbai, 'nope', 'author', 5, ['x'], None, True):
            self.assertEqual(self.reply('member-sub', mid, to=to), (400, {'error': 'invalid_to'}), to)
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='yigal-sub')[0], 204)
        self.assertEqual(self.reply('member-sub', mid, to=self.yigal), (400, {'error': 'invalid_to'}))  # left
        gid = self.general()
        for to in ('family', self.shul, self.member, 5):
            self.assertEqual(self.reply('rotem-sub', gid, to=to), (400, {'error': 'invalid_to'}), to)
        self.assertEqual(self.reply('rotem-sub', gid, to='author')[1]['to'], 'author')
        self.assertEqual(self.reply('member-sub', mid, to='family')[1]['to'], 'family')

    def test_reply_rules(self):
        gid = self.general()
        self.assertEqual(self.reply('member-sub', gid), (409, {'error': 'cannot_reply_to_own'}))
        bid = self.blessing()
        for sub in ('shul-sub', 'yigal-sub', 'gabbai-sub'):  # the poster of the blessing wrote it
            self.assertEqual(self.reply(sub, bid)[1], {'error': 'cannot_reply_to_own'}, sub)
        status, general = self.post('announcements', sub='gabbai-sub', type='general')
        status, weekly = self.post('announcements', sub='gabbai-sub', type='weekly')
        for m in (general['messageId'], weekly['messageId']):
            self.assertEqual(self.reply('rotem-sub', m), (409, {'error': 'replies_not_allowed'}))
        grouped = self.blessing(self.dana)
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'C#{self.channels["simchas"]}'},
                                    UpdateExpression='SET #g = :g', ExpressionAttributeNames={'#g': 'groups'},
                                    ExpressionAttributeValues={':g': {'g1'}})
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.member}'}, UpdateExpression='SET #g = :g',
                                    ExpressionAttributeNames={'#g': 'groups'}, ExpressionAttributeValues={':g': {'g1'}})
        self.assertEqual(self.reply('member-sub', grouped), (409, {'error': 'replies_not_allowed'}))
        self.assertEqual(self.reply('listener-sub', gid)[0], 403)
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='member-sub')[0], 204)
        self.assertEqual(self.reply('rotem-sub', gid), (409, {'error': 'author_left'}))

    def test_message_removal_deletes_replies_and_thread(self):
        mid = self.general()
        self.sent('rotem-sub', mid)
        self.assertTrue(self.partition(f'K#{self.k}#RX', f'MSG#{mid}'))
        self.assertEqual(self.call('DELETE', f'{self.base()}/messages/{mid}', sub='member-sub')[0], 204)
        self.assertEqual(self.partition(f'K#{self.k}#MSG#{mid}', 'R'), [])
        self.assertEqual(self.partition(f'K#{self.k}#MSG#{mid}', 'RP#'), [])
        self.assertEqual(self.partition(f'K#{self.k}#RX', f'MSG#{mid}'), [])
        self.assertEqual(self.inbox('member-sub')['threads'], [])

    def test_inbox_counts_family_and_personal(self):
        b1, b2 = self.blessing(), self.blessing()
        self.sent('member-sub', b1, 'one')
        self.sent('rotem-sub', b1, 'two')
        self.sent('dana-sub', b1, 'three')
        self.sent('ron-sub', b1, 'to-shul', to=self.shul)
        self.sent('quiet-sub', b1, 'to-yigal', to=self.yigal)
        self.assertEqual(self.card('gabbai-sub', b1)['replierCount'], 5)
        self.sent('member-sub', b2, 'other thread')
        self.sent('tech-sub', b1, 'last')
        for sub in ('shul-sub', 'yigal-sub'):
            box = self.inbox(sub)
            first, second = box['threads']
            self.assertEqual((first['message']['messageId'], second['message']['messageId']), (b1, b2))
            self.assertEqual((first['total'], first['personal']), (5, 1), sub)
            self.assertEqual(len(first['replies']), 3)
            self.assertEqual(first['replies'][0]['body'], 'last')
            self.assertEqual(box['unread'], 6)

    def test_inbox_spec_example_total_four(self):
        b1 = self.blessing()
        for sub, body in (('member-sub', 'one'), ('rotem-sub', 'two'), ('dana-sub', 'three')):
            self.sent(sub, b1, body)
        self.sent('ron-sub', b1, 'to-shul', to=self.shul)
        self.sent('quiet-sub', b1, 'to-yigal', to=self.yigal)
        self.assertEqual(self.card('rotem-sub', b1)['replierCount'], 5)
        for sub, mine in (('shul-sub', 'to-shul'), ('yigal-sub', 'to-yigal')):
            (thread,) = self.inbox(sub)['threads']
            self.assertEqual((thread['total'], thread['personal'], len(thread['replies'])), (4, 1, 3), sub)
            self.assertEqual([r['body'] for r in thread['replies']], [mine, 'three', 'two'], sub)

    def test_inbox_author_and_listener(self):
        mid = self.general()
        self.sent('rotem-sub', mid, 'שלום')
        (thread,) = self.inbox('member-sub')['threads']
        self.assertEqual((thread['message']['messageId'], thread['total'], thread['unread'], thread['personal']),
                         (mid, 1, 1, 0))
        self.assertEqual(self.inbox('member-sub')['unread'], 1)
        self.assertEqual(self.call('GET', f'{self.base()}/replies/inbox', sub='listener-sub')[0], 403)
        self.assertEqual(self.inbox('gabbai-sub'), {'unread': 0, 'threads': []})
        self.assertEqual(self.inbox('rotem-sub'), {'unread': 0, 'threads': []})  # a writer's own reply is not mail

    def test_legacy_replies_without_to_are_family(self):
        mid = self.blessing()
        for body in ('a', 'b'):
            self.repo.table.put_item(Item={'pk': f'K#{self.k}#MSG#{mid}', 'sk': f'R#{new_id()}', 'authorId': self.member,
                                           'authorName': 'Mia Member', 'body': body, 'createdAt': 1})
        self.repo.table.put_item(Item={'pk': f'K#{self.k}#MSG#{mid}', 'sk': f'RP#{self.member}'})
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'MSG#{mid}'}, UpdateExpression='SET replierCount = :one',
                                    ExpressionAttributeValues={':one': 1})
        for sub in ('shul-sub', 'yigal-sub'):
            got = self.replies(sub, mid)
            self.assertEqual(([r['body'] for r in got], {r['to'] for r in got}), (['a', 'b'], {'family'}))
        self.assertEqual(self.replies('rotem-sub', mid), [])
        self.assertEqual(self.replies('gabbai-sub', mid), [])
        self.assertEqual(self.card('gabbai-sub', mid)['replierCount'], 1)
        self.assertEqual(self.reply('member-sub', mid), (409, {'error': 'already_replied'}))

    def test_read_marker_validation(self):
        mid = self.general()
        sent = self.sent('rotem-sub', mid)
        self.assertEqual(self.read('member-sub', mid, 'nope'), (400, {'error': 'invalid_up_to'}))
        self.assertEqual(self.call('POST', self.url(mid, '/read'), sub='member-sub', body={})[1], {'error': 'invalid_up_to'})
        for sub in ('rotem-sub', 'quiet-sub', 'gabbai-sub'):  # the writer and strangers: 204, nothing written
            self.assertEqual(self.read(sub, mid, sent['replyId']), (204, None), sub)
            self.assertEqual(self.partition(f'K#{self.k}#U#{self.ids[sub]}', 'RXSEEN#'), [], sub)
        self.assertEqual(self.read('member-sub', '0' * 26, sent['replyId'])[0], 404)
        self.assertEqual(self.read('member-sub', mid, sent['replyId'])[0], 204)
        self.assertEqual(self.repo.seen_marks(self.k, self.member, [mid]), {mid: sent['replyId']})
        self.assertEqual(self.read('member-sub', mid, '0' * 26)[0], 204)  # never lowers the mark
        self.assertEqual(self.repo.seen_marks(self.k, self.member, [mid]), {mid: sent['replyId']})

    # Task 1 carry-over: canReply must be honest, and the viewer fields must not leak
    def test_every_can_reply_true_accepts_a_reply(self):
        messages = [self.general(), self.blessing(), self.blessing(self.dana, 'member-sub')]
        for mid in messages:
            for sub in self.ids:
                if self.card(sub, mid).get('canReply'):
                    self.assertEqual(self.reply(sub, mid, sub)[0], 201, (mid, sub))
                else:
                    status, body = self.reply(sub, mid)
                    self.assertNotEqual(status, 201, (mid, sub))

    def test_management_general_and_event_take_no_replies(self):
        for sub in ('gabbai-sub', 'tech-sub'):
            for type_ in ('general', 'event'):
                status, body = self.post('announcements', sub=sub, type=type_)
                self.assertEqual(status, 201, body)
                for key in ('replyTo', 'canReply', 'isRecipient', 'replied', 'replierCount'):
                    self.assertNotIn(key, body)
                got = self.card('rotem-sub', body['messageId'])
                self.assertNotIn('replyTo', got)
                self.assertNotIn('canReply', got)
                self.assertEqual(self.reply('rotem-sub', body['messageId']), (409, {'error': 'replies_not_allowed'}))

    def test_listener_viewing_family_routed_message(self):
        set_type_rules(self.repo, self.k, {'celebration': {'post': 'broadcasters', 'listeners': True}})
        status, posted = self.post('announcements', type='celebration', targetMemberId=self.shul)
        got = self.card('listener-sub', posted['messageId'])
        self.assertEqual((got['replyTo'], got['canReply'], got['isRecipient'], got['replied']),
                         ('family', False, False, False))
        self.assertNotIn('replyAdults', got)

    def test_tech_blessing_keeps_blessings_and_poster_cannot_reply(self):
        mid = self.blessing(sub='tech-sub')
        self.assertTrue(self.card('rotem-sub', mid)['canReply'])
        poster = self.card('tech-sub', mid)
        self.assertEqual((poster['replyTo'], poster['canReply'], poster['isRecipient']), ('family', False, False))
        self.sent('rotem-sub', mid)
        self.assertEqual(self.replies('tech-sub', mid), [])  # the poster is not a recipient

    def test_replied_is_only_about_the_caller(self):
        mid = self.general()
        self.sent('rotem-sub', mid)
        self.assertTrue(self.card('rotem-sub', mid)['replied'])
        for sub in ('member-sub', 'quiet-sub', 'gabbai-sub', 'tech-sub', 'shul-sub'):
            self.assertFalse(self.card(sub, mid)['replied'], sub)
            listed = next(m for m in self.call('GET', f'{self.base()}/messages', sub=sub)[1] if m['messageId'] == mid)
            self.assertFalse(listed['replied'], sub)
            counts = [c['item'] for c in self.feed(sub, 'reply_count')]
            self.assertTrue(counts and not any(c['replied'] for c in counts), sub)
            self.assertEqual(self.card(sub, mid)['replierCount'], 1)
        listed = next(m for m in self.call('GET', f'{self.base()}/messages', sub='rotem-sub')[1] if m['messageId'] == mid)
        self.assertTrue(listed['replied'])

    def test_reply_pushes_with_message_and_reply_ids_only(self):
        mid = self.general()
        with mock.patch.object(push, 'enqueue') as enqueue:
            sent = self.sent('rotem-sub', mid)
            self.call('PUT', self.url(mid, f"/{sent['replyId']}"), sub='rotem-sub', body={'body': 'x'})
            self.call('DELETE', self.url(mid, f"/{sent['replyId']}"), sub='rotem-sub')
        enqueue.assert_called_once_with('reply', self.k, f"{mid}/{sent['replyId']}")


for _name in dir(test_messages.MessagesTest):
    if _name.startswith('test_') and _name not in vars(ReplyFlowTest):
        setattr(ReplyFlowTest, _name, None)
