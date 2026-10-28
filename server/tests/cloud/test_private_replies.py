import time
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import private_replies, routes_changes
from server.tests.cloud import test_messages

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
