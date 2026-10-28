from unittest import mock

from moto import mock_aws

from server.cloud import routes_seatlink
from server.tests.cloud import test_seatlink as sl
from server.tests.cloud.test_groups import own_tests_only

DAY = 86400


@own_tests_only
@mock_aws
class AutoLinkTest(sl.SeatLinkTest):
    """A family becoming a member auto-links ONE certain holder; anything weaker stays a suggestion. Invented names."""

    def setUp(self):
        super().setUp()
        self.profile(self.listener, 'לאה', 'מאזין', '+972508888888')

    def register(self):
        self.assertEqual(self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')[0], 202)
        status, _ = self.call('POST', f'{self.base()}/admin/requests/{self.listener}/approve', body={'classification': ''})
        self.assertEqual(status, 200)
        return self.repo.get_membership(self.k, self.listener)['familyId']

    def autos(self, sub='gabbai-sub'):
        return self.call('GET', f'{self.base()}/admin/seating/auto-links', sub=sub)

    def undo(self, holder, sub='gabbai-sub'):
        return self.call('POST', f'{self.base()}/admin/seating/auto-links/{holder}/undo', sub=sub)

    def holder_ids(self):
        return {h['holderId'] for h in self.holders()}

    def test_unique_surname_and_initial_links(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0), (5, 1))
        fam = self.register()
        self.assertNotIn(h, self.holder_ids())
        self.assertEqual(sorted(r for r in self.asg().values()), [f'family:{fam}'] * 2)
        status, body = self.autos()
        self.assertEqual(status, 200)
        (item,) = body['items']
        self.assertEqual((item['holderId'], item['familyId'], item['holderName'], item['seats']), (h, fam, 'מאזין ל.', 2))
        self.assertIn('Lior', item['familyName'])
        self.assertEqual(item['expiresAt'] - item['at'], 14 * DAY)

    def test_unique_phone_links(self):
        h = self.holder_named('אחר לגמרי', phone='050-888-8888')
        self.give(f'holder:{h}', (5, 0))
        fam = self.register()
        self.assertEqual(list(self.asg().values()), [f'family:{fam}'])
        self.assertEqual(self.autos()[1]['count'], 1)

    def test_two_candidates_stay_suggestions(self):
        a = self.holder_named('מאזין ל.')
        b = self.holder_named('אחר', phone='0508888888')
        self.register()
        self.assertEqual({a, b} <= self.holder_ids(), True)
        self.assertEqual(self.autos()[1]['count'], 0)
        self.assertEqual(len([s for s in self.suggestions()[1]['suggestions'] if s['holderId'] in (a, b)]), 2)

    def test_surname_only_and_spelling_stay_suggestions(self):
        a = self.holder_named('מאזין')
        b = self.holder_named('מאזן')
        self.register()
        self.assertTrue({a, b} <= self.holder_ids())
        self.assertEqual(self.autos()[1]['count'], 0)

    def test_other_initial_stays_a_suggestion(self):
        a = self.holder_named('מאזין ש.')
        self.register()
        self.assertIn(a, self.holder_ids())

    def test_holder_matching_two_families_is_not_linked(self):
        self.profile(self.quiet, 'לאה', 'מאזין')  # another existing family also fits 'מאזין ל.'
        a = self.holder_named('מאזין ל.')
        self.register()
        self.assertIn(a, self.holder_ids())

    def test_already_linked_holder_is_untouched(self):
        h = self.holder_named('בדיוני מ.')
        self.assertEqual(self.link(h)[0], 200)
        self.assertEqual(self.autos()[1]['count'], 0)  # a manual link leaves no auto record
        self.register()
        self.assertEqual(self.autos()[1]['count'], 0)

    def test_mid_link_holder_is_untouched(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0))
        self.repo.add_seat_link_notice(self.k, self.member, h, 1, 100)  # a manual link wrote its notice and stopped
        self.register()
        self.assertIn(h, self.holder_ids())

    def test_idempotent_rerun(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0))
        fam = self.register()
        with mock.patch.object(routes_seatlink, 'link_holder', side_effect=AssertionError):
            self.assertIsNone(self.run_hook(fam))
        self.assertEqual(self.autos()[1]['count'], 1)
        self.assertEqual(list(self.asg().values()), [f'family:{fam}'])

    def run_hook(self, fam):
        return routes_seatlink.auto_link_family(self.ctx(), self.k, self.listener)

    def ctx(self):
        return mock.Mock(repo=self.repo, user_id='gabbai')

    def test_undo_restores(self):
        h = self.holder_named('מאזין ל.', phone='0507770000')
        self.give(f'holder:{h}', (5, 0), (5, 1))
        self.register()
        self.assertEqual(self.undo(h), (200, {'holderId': h}))
        self.assertIn(h, self.holder_ids())
        self.assertEqual(sorted(self.asg().values()), [f'holder:{h}'] * 2)
        self.assertEqual(self.autos()[1]['count'], 0)
        restored = [x for x in self.holders() if x['holderId'] == h][0]
        self.assertEqual((restored['name'], restored['phone']), ('מאזין ל.', '+972507770000'))
        self.assertEqual(self.undo(h), (404, {'error': 'autolink_not_found'}))

    def test_undo_after_a_change_is_409(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0))
        fam = self.register()
        self.owned[f'family:{fam}'] = ((5, 0),)
        self.give(f'family:{fam}', (6, 0))  # the gabbai moved the family to another seat
        self.assertEqual(self.undo(h), (409, {'error': 'autolink_changed'}))
        self.assertEqual(list(self.asg().values()), [f'family:{fam}'])
        self.assertNotIn(h, self.holder_ids())

    def test_undo_after_14_days_is_410(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0))
        self.register()
        with mock.patch.object(routes_seatlink.time, 'time', return_value=__import__('time').time() + 15 * DAY):
            self.assertEqual(self.autos()[1]['count'], 0)
            self.assertEqual(self.undo(h), (410, {'error': 'autolink_expired'}))

    def test_gabbai_only(self):
        h = self.holder_named('מאזין ל.')
        self.register()
        self.assertEqual(self.autos(sub='member-sub')[0], 403)
        self.assertEqual(self.undo(h, sub='member-sub')[0], 403)

    def test_invite_accept_as_member_links_too(self):
        h = self.holder_named('מאזין ל.')
        self.repo.put_membership(self.k, self.listener, 'member')
        self.repo.ensure_family(self.k, self.listener)
        routes_seatlink.auto_link_family(self.ctx(), self.k, self.listener)
        self.assertNotIn(h, self.holder_ids())

    def test_no_names_in_logs(self):
        self.holder_named('מאזין ל.')
        with self.assertLogs('server.cloud', level='DEBUG') as logs:
            self.register()
        text = '\n'.join(logs.output)
        self.assertIn('auto-link', text)
        self.assertNotIn('מאזין', text)
        self.assertNotIn('Lior', text)
