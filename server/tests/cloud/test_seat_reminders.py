import copy

from moto import mock_aws

from server.cloud import seat_reminders
from server.tests.cloud import test_seatweek
from server.tests.cloud.test_groups import own_tests_only
from server.tests.cloud.test_seating import friday
from server.tests.cloud.test_seatweek import LAYOUT, WEEK


@own_tests_only
@mock_aws
class SeatRemindersTest(test_seatweek.SeatWeekTest):
    def join_family(self, user_id, family_id):
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{user_id}'}, UpdateExpression='SET familyId = :f',
                                    ExpressionAttributeValues={':f': family_id})
        family = self.repo.get_family(self.k, family_id)
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'F#{family_id}'}, UpdateExpression='SET adults = :a',
                                    ExpressionAttributeValues={':a': [*family['adults'], user_id]})

    def set_people(self, family_id, people):
        self.repo.table.update_item(
            Key={'pk': f'K#{self.k}', 'sk': f'F#{family_id}'}, UpdateExpression='SET people = :p',
            ExpressionAttributeValues={':p': [{'id': f'P{i:025d}', 'userId': u, 'gender': g, 'relation': r}
                                              for i, (u, g, r) in enumerate(people)]})

    def test_audience_rules(self):
        a = seat_reminders.audience
        m = lambda u: {'userId': u}
        fam = lambda *g: {'people': [{'userId': u, 'gender': x, 'relation': r} for u, x, r in g]}
        self.assertEqual(a(fam(('u1', 'm', 'self'), ('u2', 'f', 'spouse')), [m('u1'), m('u2')]), [m('u1')])
        self.assertEqual(a(fam(('u2', 'f', 'self')), [m('u2')]), [m('u2')])
        self.assertEqual(a({}, [m('u1'), m('u2')]), [m('u1'), m('u2')])
        self.assertEqual(a(fam(('u1', 'm', 'self'), ('u2', 'f', 'spouse')), [m('u2')]), [m('u2')])
        self.assertEqual(a({}, []), [])
        self.assertEqual(a(fam(('u1', None, 'self'), ('u2', 'f', 'spouse')), [m('u1'), m('u2')]), [m('u1'), m('u2')])

    def test_unanswered_and_recipients(self):
        self.mine((5, 0))
        self.give(f'family:{self.other}', (5, 3))
        self.give(f'holder:{self.holder}', (6, 0))
        self.assertEqual(seat_reminders.unanswered_families(self.repo, self.k, WEEK), sorted([self.fam, self.other]))
        self.assertEqual(self.put_me([1], 'erev')[0], 200)
        self.assertEqual(seat_reminders.unanswered_families(self.repo, self.k, WEEK), [self.other])
        self.respond([{'household': f'family:{self.other}', 'released': 1}])
        self.assertEqual(seat_reminders.unanswered_families(self.repo, self.k, WEEK), [self.other])
        self.assertEqual(seat_reminders.recipients(self.repo, self.k, WEEK), [self.quiet])
        self.gput({self.at[(5, 3)]: False})
        self.assertEqual(seat_reminders.unanswered_families(self.repo, self.k, WEEK), [])
        self.assertEqual(seat_reminders.recipients(self.repo, self.k, WEEK), [])

    def test_no_layout_means_nobody(self):
        self.assertEqual(seat_reminders.unanswered_families(self.repo, self.k, '2000-01-07'), [])

    def test_muted_is_skipped(self):
        self.mine((5, 0))
        self.assertIn(self.member, seat_reminders.recipients(self.repo, self.k, WEEK))
        self.assertEqual(self.call('PUT', f'{self.base()}/me/notify', sub='member-sub', body={'seatReminders': False})[0], 200)
        self.assertNotIn(self.member, seat_reminders.recipients(self.repo, self.k, WEEK))
        self.assertEqual(self.call('PUT', f'{self.base()}/me/notify', sub='member-sub', body={'seatReminders': 'no'}),
                         (400, {'error': 'invalid_seat_reminders_pref'}))
        self.assertIs(self.call('GET', self.base(), sub='member-sub')[1]['notify']['seatReminders'], False)

    def test_default_is_on(self):
        self.assertIs(self.call('GET', self.base(), sub='quiet-sub')[1]['notify']['seatReminders'], True)

    def test_seats_me_remindable_and_had_seats(self):
        self.mine((5, 0))
        self.assertIs(self.me()[1]['remindable'], True)
        self.join_family(self.quiet, self.fam)
        self.set_people(self.fam, [(self.member, 'f', 'self'), (self.quiet, 'm', 'spouse')])
        self.assertIs(self.me()[1]['remindable'], False)
        self.assertIs(self.me(sub='quiet-sub')[1]['remindable'], True)
        self.assertNotIn('hadSeats', self.me()[1])
        nxt = friday(2)
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/seating/layouts/{nxt}',
                                   body={**copy.deepcopy(LAYOUT), 'ifUpdatedAt': None})[0], 200)
        out = self.me(week=nxt)[1]
        self.assertEqual(out['seats'], 0)
        self.assertIs(out['hadSeats'], True)
        self.assertIs(out['remindable'], False)

    def test_had_seats_false_without_earlier_seats(self):
        out = self.me(week=friday(2))[1]
        self.assertEqual(out['seats'], 0)
        self.assertIs(out['hadSeats'], False)
