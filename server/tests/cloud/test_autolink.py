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
        self.profile(self.gabbai_id(), 'דוד', 'גבאי')

    def gabbai_id(self):
        return self.call('GET', '/v1/me', sub='gabbai-sub')[1]['userId']

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
        h = self.holder_named('משפחת מאזין', phone='050-888-8888')  # phone counts only together with the surname
        self.give(f'holder:{h}', (5, 0))
        fam = self.register()
        self.assertEqual(list(self.asg().values()), [f'family:{fam}'])
        self.assertEqual(self.autos()[1]['count'], 1)

    def test_two_candidates_stay_suggestions(self):
        a = self.holder_named('מאזין ל.')
        b = self.holder_named('מאזין', phone='0508888888')
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
        self.assertEqual(self.undo(h), (200, {'holderId': h, 'skipped': 0}))
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
        self.assertEqual(self.undo(h), (409, {'error': 'autolink_changed'}))  # every moved seat was changed
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

    def test_invite_accept_never_auto_links(self):
        h = self.holder_named('מאזין ל.')
        status, inv = self.call('POST', f'{self.base()}/invites', body={'role': 'member'})
        self.assertEqual(status, 201, inv)
        status, _ = self.call('POST', f'/v1/invites/{inv["code"]}/accept', sub='listener-sub', body={})
        self.assertEqual(status, 200)
        self.assertEqual(self.repo.get_membership(self.k, self.listener)['role'], 'member')
        self.assertIn(h, self.holder_ids())  # only a gabbai's approval auto-links
        self.assertEqual(self.autos()[1]['count'], 0)

    def hook(self):
        return routes_seatlink.auto_link_family(self.ctx(), self.k, self.listener)

    def approved_with_spouse(self, first, last):
        """The registering family gets a second adult (first, last) = the old quiet user."""
        self.register()
        self.profile(self.quiet, first, last)
        self.call('POST', f'{self.base()}/admin/families/link', body={'userIds': [self.listener, self.quiet]})

    # certainty (C1)
    def test_cross_adult_alone_never_links(self):
        self.approved_with_spouse('מיכל', 'לוי')
        cross = self.holder_named('לוי ל.')
        self.assertIsNone(self.hook())
        self.assertIn(cross, self.holder_ids())

    def test_same_adult_links(self):
        self.approved_with_spouse('מיכל', 'לוי')
        mine = self.holder_named('לוי מ.')
        self.assertEqual(self.hook(), mine)

    def test_another_holder_with_the_surname_blocks(self):
        a = self.holder_named('מאזין ל.')
        b = self.holder_named('מאזין ש.')  # an unregistered same-surname household
        self.register()
        self.assertTrue({a, b} <= self.holder_ids())
        self.assertEqual(self.autos()[1]['count'], 0)

    def test_spelling_variant_holder_blocks(self):
        a = self.holder_named('מאזין ל.')
        b = self.holder_named('מאזן')
        self.register()
        self.assertTrue({a, b} <= self.holder_ids())

    def test_a_pending_requester_with_the_surname_and_initial_blocks(self):
        self.profile(self.add('req2-sub', 'listener', 'Lia Other'), 'לירון', 'מאזין')
        self.assertEqual(self.call('POST', f'{self.base()}/membership-request', sub='req2-sub')[0], 202)
        h = self.holder_named('מאזין ל.')
        self.register()
        self.assertIn(h, self.holder_ids())

    def test_a_listener_or_member_with_the_surname_and_initial_blocks(self):
        self.profile(self.add('l2-sub', 'listener', 'Lia Other'), 'לירון', 'מאזין')
        h = self.holder_named('מאזין ל.')
        self.register()
        self.assertIn(h, self.holder_ids())

    def test_other_surname_other_initial_does_not_block(self):
        self.profile(self.add('l3-sub', 'listener', 'Sam Other'), 'שמעון', 'מאזין')
        h = self.holder_named('מאזין ל.')
        self.register()
        self.assertNotIn(h, self.holder_ids())

    def test_phone_alone_is_only_a_suggestion(self):
        h = self.holder_named('שם אחר לגמרי', phone='050-888-8888')
        self.register()
        self.assertIn(h, self.holder_ids())

    def test_phone_shared_with_another_profile_blocks(self):
        self.profile(self.add('l4-sub', 'listener', 'Sam Other'), 'שמעון', 'שונה', '+972508888888')
        h = self.holder_named('מאזין', phone='050-888-8888')
        self.register()
        self.assertIn(h, self.holder_ids())

    def test_phone_shared_with_another_holder_blocks(self):
        a = self.holder_named('מאזין', phone='050-888-8888')
        b = self.holder_named('אחר', phone='050-888-8888')
        self.register()
        self.assertTrue({a, b} <= self.holder_ids())

    # resume (I2)
    def test_partial_move_is_resumed_by_the_next_run(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0), (5, 1))
        real = self.repo.move_holder_seats
        with mock.patch.object(self.repo, 'move_holder_seats', side_effect=lambda *a: (_ for _ in ()).throw(Exception('boom'))):
            fam = self.register()
        self.assertIn(h, self.holder_ids())
        (item,) = self.autos()[1]['items']
        self.assertEqual((item['holderId'], item['state']), (h, 'pending'))
        routes_seatlink.try_auto_link(self.ctx(), self.k, self.listener)  # the next approval finishes it
        self.assertNotIn(h, self.holder_ids())
        self.assertEqual(sorted(self.asg().values()), [f'family:{fam}'] * 2)
        self.assertEqual(self.autos()[1]['items'][0]['state'], 'done')

    def test_gabbai_can_finish_a_pending_one(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0))
        with mock.patch.object(self.repo, 'move_holder_seats', side_effect=Exception('boom')):
            self.register()
        self.assertEqual(self.call('POST', f'{self.base()}/admin/seating/auto-links/{h}/finish'), (200, {'holderId': h}))
        self.assertNotIn(h, self.holder_ids())
        self.assertEqual(self.call('POST', f'{self.base()}/admin/seating/auto-links/{h}/finish')[0], 409)  # nothing pending

    # undo (I1, I3)
    def test_undo_restores_only_untouched_seats(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0), (5, 1), (5, 3))
        fam = self.register()
        self.owned[f'family:{fam}'] = ((5, 1),)
        self.give(f'family:{fam}')  # a gabbai freed one seat meanwhile
        status, body = self.undo(h)
        self.assertEqual((status, body['holderId'], body['skipped']), (200, h, 1))
        asg = self.asg()
        self.assertEqual(sorted(asg.values()), [f'holder:{h}'] * 2)
        self.assertNotIn(self.at[(5, 1)], asg)

    def test_rerun_after_undo_does_nothing(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0))
        self.register()
        self.assertEqual(self.undo(h)[0], 200)
        self.assertIsNone(self.hook())
        self.assertIn(h, self.holder_ids())
        self.assertEqual(self.autos()[1]['count'], 0)
        self.assertEqual(self.undo(h)[0], 404)

    def test_undo_restores_week_records_and_clears_the_card(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (4, 0), (4, 1))
        self.assertEqual(self.gput({self.at[(4, 1)]: True})[0], 200)
        self.assertEqual(self.respond([{'household': f'holder:{h}', 'released': 1, 'requests': {'ברחבה': 2}}], 'day')[0], 200)
        fam = self.register()
        week = self.admin_week()
        self.assertEqual(week['prayers']['day']['requests'], {f'family:{fam}': {'ברחבה': 2}})
        self.assertEqual(self.cards('listener-sub')['seatLink']['seats'], 2)
        self.assertEqual(self.undo(h)[0], 200)
        week = self.admin_week()
        self.assertEqual(week['prayers']['day']['requests'], {f'holder:{h}': {'ברחבה': 2}})
        erev = self.repo.get_week(self.k, sl.WEEK, 'erev')
        self.assertTrue(all(v.get('h') == f'holder:{h}' for v in erev['seats'].values()))
        self.assertIsNone(self.cards('listener-sub')['seatLink'])

    def test_undo_twice_halfway_is_resumable(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0), (5, 1))
        self.register()
        with mock.patch.object(routes_seatlink, '_restore_weeks', side_effect=Exception('boom')):
            self.assertEqual(self.undo(h)[0], 500)
        self.assertEqual(self.undo(h)[0], 200)
        self.assertEqual(sorted(self.asg().values()), [f'holder:{h}'] * 2)

    # round 2
    def _blocked_by(self, other_name):
        a = self.holder_named('מאזין ל.')
        b = self.holder_named(other_name)
        self.register()
        self.assertTrue({a, b} <= self.holder_ids(), other_name)
        self.assertEqual(self.autos()[1]['count'], 0)

    def test_other_row_with_a_full_first_name_blocks(self):
        self._blocked_by('מאזין לילך')

    def test_other_row_first_name_first_blocks(self):
        self._blocked_by('לילך מאזין')

    def test_other_row_with_several_initials_blocks(self):
        self._blocked_by('מאזין ש. ור.')

    def test_other_row_with_a_prefix_and_a_name_blocks(self):
        self._blocked_by('משפחת מאזין שמעון ורחל')

    def test_unrelated_two_word_row_does_not_block(self):
        a = self.holder_named('מאזין ל.')
        self.holder_named('שמעון בדיוני')
        self.register()
        self.assertNotIn(a, self.holder_ids())

    def test_short_surname_with_the_definite_article_blocks(self):
        a = self.holder_named('לוי ל.')
        b = self.holder_named('הלוי משה')
        self.profile(self.listener, 'לאה', 'לוי', '+972508888888')
        self.register()
        self.assertTrue({a, b} <= self.holder_ids())

    def test_short_surname_spelling_variant_blocks(self):
        a = self.holder_named('לוי ל.')
        b = self.holder_named('לווי ש')
        self.profile(self.listener, 'לאה', 'לוי', '+972508888888')
        self.register()
        self.assertTrue({a, b} <= self.holder_ids())

    def test_short_surname_unrelated_row_does_not_block(self):
        a = self.holder_named('לוי ל.')
        self.holder_named('הבדיוני שמעון')
        self.profile(self.listener, 'לאה', 'לוי', '+972508888888')
        self.register()
        self.assertNotIn(a, self.holder_ids())

    def test_a_cancel_that_wins_the_race_puts_the_seats_back(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0), (5, 1))
        real = routes_seatlink._move

        def move_then_cancel(*a, **kw):
            out = real(*a, **kw)
            self.repo.update_auto_link(self.k, h, {'state': 'cancelled'})  # the gabbai's cancel landed meanwhile
            return out
        with mock.patch.object(routes_seatlink, '_move', side_effect=move_then_cancel):
            self.register()
        self.assertIn(h, self.holder_ids())
        self.assertEqual(sorted(self.asg().values()), [f'holder:{h}'] * 2)
        self.assertEqual(self.repo.get_auto_link(self.k, h)['state'], 'cancelled')
        self.assertIsNone(self.cards('listener-sub')['seatLink'])

    def pending(self, h):
        """A pending auto-link: the first move fails."""
        with mock.patch.object(self.repo, 'move_holder_seats', side_effect=Exception('boom')):
            fam = self.register()
        self.assertEqual(self.autos()[1]['items'][0]['state'], 'pending')
        return fam

    def test_undo_of_a_pending_link_cancels_it_for_good(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0), (5, 1))
        self.pending(h)
        with mock.patch.object(routes_seatlink, '_restore_weeks', side_effect=Exception('boom')):
            self.assertEqual(self.undo(h)[0], 500)
        self.assertEqual(self.repo.get_auto_link(self.k, h)['state'], 'cancelled')
        routes_seatlink.try_auto_link(self.ctx(), self.k, self.listener)  # another approval
        self.assertIn(h, self.holder_ids())
        self.assertEqual(sorted(self.asg().values()), [f'holder:{h}'] * 2)
        self.assertEqual(self.call('POST', f'{self.base()}/admin/seating/auto-links/{h}/finish')[0], 409)
        self.assertEqual(self.undo(h)[0], 200)

    def test_cancelling_a_pending_link_is_never_blocked_by_a_changed_seat(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0), (5, 1))
        self.pending(h)
        self.give(f'holder:{h}', (5, 0))  # the gabbai freed a seat meanwhile
        self.assertEqual(self.undo(h)[0], 200)
        self.assertEqual(self.autos()[1]['count'], 0)
        self.assertEqual(self.repo.get_auto_link(self.k, h)['state'], 'undone')

    def test_tombstone_outlives_the_record(self):
        h = self.holder_named('מאזין ל.')
        self.register()
        self.assertEqual(self.undo(h)[0], 200)
        rec = self.repo.get_auto_link(self.k, h)
        self.assertEqual((rec['holderName'], rec['familyName'], rec['holderPhone']), ('', '', None))  # no personal data is kept
        self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': f'SEATAUTO#{h}'})  # the record's TTL fired
        self.approved_spouse = self.profile(self.quiet, 'מיכל', 'מאזין')
        self.call('POST', f'{self.base()}/admin/families/link', body={'userIds': [self.listener, self.quiet]})
        routes_seatlink.try_auto_link(self.ctx(), self.k, self.quiet)
        self.assertIn(h, self.holder_ids())

    def test_a_pending_link_older_than_14_days_is_not_resumed(self):
        h = self.holder_named('מאזין ל.')
        self.give(f'holder:{h}', (5, 0))
        self.pending(h)
        with mock.patch.object(routes_seatlink.time, 'time', return_value=__import__('time').time() + 15 * DAY):
            routes_seatlink.try_auto_link(self.ctx(), self.k, self.listener)
            self.assertEqual(self.autos()[1]['count'], 0)
        self.assertEqual(self.repo.get_auto_link(self.k, h)['state'], 'expired')
        self.assertIn(h, self.holder_ids())
        self.assertEqual(list(self.asg().values()), [f'holder:{h}'])

    def test_a_member_without_a_surname_blocks(self):
        other = self.add('m5-sub', 'member', 'No Surname')
        self.repo.ensure_family(self.k, other)
        self.profile(other, 'לילך', '')
        h = self.holder_named('מאזין ל.')
        self.register()
        self.assertIn(h, self.holder_ids())

    def test_a_requester_with_a_latin_name_blocks(self):
        self.profile(self.add('r6-sub', 'listener', 'Lia Other'), 'Lilach', 'Mazin')
        self.assertEqual(self.call('POST', f'{self.base()}/membership-request', sub='r6-sub')[0], 202)
        h = self.holder_named('מאזין ל.')
        self.register()
        self.assertIn(h, self.holder_ids())

    def test_a_latin_first_name_with_the_surname_blocks(self):
        self.profile(self.add('l7-sub', 'listener', 'Lia Other'), 'Lilach', 'מאזין')
        h = self.holder_named('מאזין ל.')
        self.register()
        self.assertIn(h, self.holder_ids())

    def test_record_has_a_ttl(self):
        h = self.holder_named('מאזין ל.')
        self.register()
        rec = self.repo.get_auto_link(self.k, h)
        self.assertEqual(int(rec['expiresAt']) - int(rec['at']), 30 * DAY)

    def test_no_names_in_logs(self):
        self.holder_named('מאזין ל.')
        with self.assertLogs('server.cloud', level='DEBUG') as logs:
            self.register()
        text = '\n'.join(logs.output)
        self.assertIn('auto-link', text)
        self.assertNotIn('מאזין', text)
        self.assertNotIn('Lior', text)
