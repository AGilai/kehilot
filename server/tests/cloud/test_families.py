import importlib.util
import os
import time
from datetime import date, timedelta
import unittest
from unittest import mock

import boto3
from moto import mock_aws

from server.cloud import accounts, importer, push, repo_messages
from server.cloud.errors import ApiError
from server.cloud.families import family_name
from server.tests.cloud import test_messages
from server.tests.cloud.test_admin import PROFILE

_spec = importlib.util.spec_from_file_location(
    'kehila_admin', os.path.join(os.path.dirname(__file__), '..', '..', '..', 'tools', 'kehila_admin.py'))
kehila_admin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kehila_admin)


@mock_aws
class FamiliesTest(test_messages.MessagesTest):
    def families(self):
        return self.repo._query_prefix(self.k, 'F#')

    def family_id(self, user_id):
        return self.repo.get_membership(self.k, user_id).get('familyId')

    def user(self, sub):
        user_id = self.call('GET', '/v1/me', sub=sub)[1]['userId']
        self.call('PUT', '/v1/me/profile', sub=sub, body=PROFILE)
        return user_id

    def assert_single_adult_family(self, user_id):
        family_id = self.family_id(user_id)
        self.assertTrue(family_id)
        family = self.repo.get_family(self.k, family_id)
        self.assertEqual((family['adults'], family['children'], int(family['version'])), ([user_id], [], 1))
        self.assertEqual(self.repo.family_of(self.k, user_id), family)

    def test_family_name_rules(self):
        cases = [([('Dana', 'Levi'), ('Avi', 'Levi')], 'Levi'),
                 ([('Dana', 'Levi'), ('Avi', 'Cohen')], 'Levi · Cohen'),
                 ([('Dana', ''), ('Avi', '')], 'Dana · Avi'),
                 ([('Dana', '')], 'Dana'),
                 ([('Dana', 'Levi'), ('Avi', '')], 'Levi · Avi')]
        for people, expected in cases:
            profiles = [{'firstName': f, 'lastName': l} for f, l in people]
            self.assertEqual(family_name(profiles), expected)
        self.assertEqual(family_name([None, {'firstName': 'Avi', 'lastName': ''}]), 'Avi')

    def test_ensure_family_creates_once(self):
        first = self.repo.ensure_family(self.k, self.member)
        self.assertEqual(self.repo.ensure_family(self.k, self.member), first)
        (family,) = self.families()
        self.assertEqual((family['familyId'], family['adults']), (first, [self.member]))
        self.assert_single_adult_family(self.member)

    def test_ensure_family_skips_listener(self):
        self.assertIsNone(self.repo.ensure_family(self.k, self.listener))
        self.assertIsNone(self.repo.ensure_family(self.k, 'nobody'))
        self.assertEqual(self.families(), [])
        self.assertIsNone(self.repo.family_of(self.k, self.listener))

    def test_approve_creates_family(self):
        self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')
        status, _ = self.call('POST', f'{self.base()}/admin/requests/{self.listener}/approve',
                              body={'classification': ''})
        self.assertEqual(status, 200)
        self.assert_single_adult_family(self.listener)

    def test_approve_succeeds_when_family_creation_fails(self):
        self.call('POST', f'{self.base()}/membership-request', sub='listener-sub')
        with mock.patch.object(self.repo, 'ensure_family', side_effect=RuntimeError('boom')):
            status, _ = self.call('POST', f'{self.base()}/admin/requests/{self.listener}/approve',
                                  body={'classification': ''})
        self.assertEqual(status, 200)
        self.assertIsNone(self.family_id(self.listener))

    def test_member_invite_creates_family(self):
        newcomer = self.user('new-sub')
        code = self.repo.create_invite(self.k, self.gabbai, 'member', 1, 7)
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='new-sub')[0], 200)
        self.assert_single_adult_family(newcomer)

    def test_listener_invite_has_no_family(self):
        newcomer = self.user('new-sub')
        code = self.repo.create_invite(self.k, self.gabbai, 'listener', 1, 7)
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='new-sub')[0], 200)
        self.assertIsNone(self.family_id(newcomer))

    def _import(self, rows):
        if not hasattr(self, 'cognito'):
            self.cognito = boto3.client('cognito-idp', region_name='il-central-1')
            self.pool = self.cognito.create_user_pool(PoolName='p', UsernameAttributes=['email'])['UserPool']['Id']
        cognito, pool = self.cognito, self.pool
        with mock.patch.object(accounts, 'cognito_client', return_value=cognito):
            results = importer.import_rows(self.repo, cognito, pool, self.k, rows)

        def user_id(email):
            user = cognito.admin_get_user(UserPoolId=pool, Username=email)
            return self.repo.get_user_id(next(a['Value'] for a in user['UserAttributes'] if a['Name'] == 'sub'))
        return results, user_id

    def test_import_member_creates_family(self):
        row = {'firstName': 'Dana', 'lastName': 'Example', 'email': 'dana@example.test', 'role': 'member'}
        results, user_id = self._import([row])
        self.assertEqual(results[0]['status'], 'created')
        self.assert_single_adult_family(user_id('dana@example.test'))
        results, _ = self._import([row])  # a re-import: exists, still one family
        self.assertEqual(results[0]['status'], 'exists')
        self.assertEqual(len(self.families()), 1)

    def test_import_listener_has_no_family(self):
        row = {'firstName': 'Dana', 'lastName': 'Example', 'email': 'dana@example.test', 'role': 'listener'}
        results, user_id = self._import([row])
        self.assertEqual(results[0]['status'], 'created')
        self.assertIsNone(self.family_id(user_id('dana@example.test')))
        self.assertEqual(self.families(), [])

    def test_backfill_is_idempotent(self):
        self.assertEqual(kehila_admin.backfill_families(self.repo), (1, 3))  # gabbai, member, quiet
        self.assertEqual(len(self.families()), 3)
        self.assertEqual(kehila_admin.backfill_families(self.repo), (1, 0))
        self.assertEqual(kehila_admin.backfill_families(self.repo, self.k), (1, 0))
        self.assertIsNone(self.family_id(self.listener))
        self.assertEqual(len(self.families()), 3)

    # family view and children
    def fam(self, path=''):
        return f'{self.base()}/family{path}'

    def add_child(self, sub='member-sub', **extra):
        body = {'firstName': 'Noa', 'gender': 'f', 'birthDate': '2015-12-31', **extra}
        return self.call('POST', self.fam('/children'), sub=sub, body=body)

    def test_get_family_creates_lazily_and_names_it(self):
        self.assertIsNone(self.family_id(self.member))
        self.call('PUT', '/v1/me/profile', sub='member-sub', body=PROFILE)
        status, view = self.call('GET', self.fam(), sub='member-sub')
        self.assertEqual(status, 200)
        self.assertEqual(view['adults'], [{'userId': self.member, 'displayName': 'Mia Member', 'me': True}])
        self.assertEqual((view['children'], view['name'], view['familyId']),
                         ([], 'Test', self.family_id(self.member)))
        self.assertEqual((view['sent'], view['received'], view['notice']), (None, [], None))
        self.assertEqual(len(self.families()), 1)

    def test_listener_gets_403_on_family(self):
        self.assertEqual(self.call('GET', self.fam(), sub='listener-sub'), (403, {'error': 'forbidden'}))
        self.assertEqual(self.add_child(sub='listener-sub')[0], 403)

    def test_add_edit_remove_child(self):
        status, child = self.add_child()
        self.assertEqual(status, 201)
        self.assertEqual({k: child[k] for k in ('firstName', 'gender', 'birthDate')},
                         {'firstName': 'Noa', 'gender': 'f', 'birthDate': '2015-12-31'})
        status, edited = self.call('PUT', self.fam('/children/' + child['id']), sub='member-sub',
                                   body={'firstName': 'Noa', 'gender': 'm'})
        self.assertEqual((status, edited['gender'], edited['id'], 'birthDate' in edited), (200, 'm', child['id'], False))
        self.assertEqual(self.call('GET', self.fam(), sub='member-sub')[1]['children'], [edited])
        self.assertEqual(self.call('DELETE', self.fam('/children/' + child['id']), sub='member-sub'), (204, None))
        self.assertEqual(self.call('GET', self.fam(), sub='member-sub')[1]['children'], [])
        self.assertEqual(self.call('DELETE', self.fam('/children/' + child['id']), sub='member-sub'),
                         (404, {'error': 'child_not_found'}))
        self.assertEqual(self.call('PUT', self.fam('/children/' + child['id']), sub='member-sub',
                                   body={'firstName': 'Noa', 'gender': 'f'}), (404, {'error': 'child_not_found'}))

    def test_child_validation(self):
        tomorrow = (date.fromisoformat(repo_messages.local_date()) + timedelta(days=1)).isoformat()
        cases = [({'gender': None}, 'invalid_gender'), ({'firstName': ''}, 'invalid_first_name'),
                 ({'firstName': 'א' * 61}, 'invalid_first_name'),
                 ({'birthDate': '2015-02-30'}, 'invalid_birth_date'), ({'birthDate': '31.12.2015'}, 'invalid_birth_date'),
                 ({'birthDate': tomorrow}, 'invalid_birth_date'), ({'birthDate': '1899-12-31'}, 'invalid_birth_date'),
                 ({'birthDate': 5}, 'invalid_birth_date')]
        for change, code in cases:
            body = {'firstName': 'Noa', 'gender': 'f', **change}
            if change == {'gender': None}:
                del body['gender']
            self.assertEqual(self.call('POST', self.fam('/children'), sub='member-sub', body=body),
                             (400, {'error': code}), change)
        self.assertEqual(self.add_child(firstName='א' * 60, birthDate='')[0], 201)
        self.assertEqual(self.add_child(birthDate=repo_messages.local_date())[0], 201)
        self.assertEqual(self.add_child(birthDate='1900-01-01')[0], 201)

    def test_children_limit(self):
        for _ in range(20):
            self.assertEqual(self.add_child()[0], 201)
        self.assertEqual(self.add_child(), (409, {'error': 'children_limit'}))
        self.assertEqual(len(self.call('GET', self.fam(), sub='member-sub')[1]['children']), 20)

    def test_concurrent_child_edits_both_kept(self):
        family_id = self.repo.ensure_family(self.k, self.member)
        real = self.repo.get_family
        calls = []

        def stale_then_real(k, fid):
            item = real(k, fid)
            calls.append(1)
            if len(calls) == 1:  # another adult's add lands after this read
                self.repo.update_children(k, fid, lambda c: c + [{'id': 'X' * 26, 'firstName': 'Eli', 'gender': 'm'}])
            return item
        with mock.patch.object(self.repo, 'get_family', side_effect=stale_then_real):
            self.assertEqual(self.add_child()[0], 201)
        names = [c['firstName'] for c in real(self.k, family_id)['children']]
        self.assertEqual(names, ['Eli', 'Noa'])
        self.assertEqual(int(real(self.k, family_id)['version']), 3)

    def test_update_children_gives_up_with_try_again(self):
        family_id = self.repo.ensure_family(self.k, self.member)
        stale = self.repo.get_family(self.k, family_id)
        self.repo.update_children(self.k, family_id, lambda c: c)
        with mock.patch.object(self.repo, 'get_family', return_value=stale):
            self.assertEqual(self.add_child(), (409, {'error': 'try_again'}))

    def test_other_kehila_family_not_reachable(self):
        child = self.add_child()[1]
        other = self.repo.create_kehila('Beit Other', {})
        user_id = self.call('GET', '/v1/me', sub='other-sub')[1]['userId']
        self.repo.put_membership(other, user_id, 'member')
        path = f'/v1/kehilot/{other}/family/children/{child["id"]}'
        self.assertEqual(self.call('PUT', path, sub='other-sub', body={'firstName': 'X', 'gender': 'm'}),
                         (404, {'error': 'child_not_found'}))
        self.assertEqual(self.call('DELETE', path, sub='other-sub'), (404, {'error': 'child_not_found'}))
        self.assertEqual(self.call('GET', f'/v1/kehilot/{other}/family', sub='other-sub')[1]['children'], [])
        self.assertEqual(self.call('DELETE', self.fam('/children/not-a-ulid'), sub='member-sub'),
                         (404, {'error': 'child_not_found'}))
        self.assertEqual(self.call('GET', self.fam(), sub='other-sub')[0], 404)  # not a member here


    # link requests, confirm, decline, unlink
    def ask(self, sub, to):
        return self.call('POST', self.fam('/requests'), sub=sub, body={'toUserId': to})

    def view(self, sub):
        return self.call('GET', self.fam(), sub=sub)[1]

    def pending_items(self):
        return self.repo._query_prefix(self.k, 'PR#') + self.repo._query_prefix(self.k, 'PS#')

    def test_request_confirm_links_and_merges_children(self):
        self.add_child(sub='member-sub', firstName='Noa')
        self.add_child(sub='quiet-sub', firstName='Ari')
        with mock.patch.object(push, 'enqueue'):
            status, body = self.ask('member-sub', self.quiet)
        self.assertEqual(status, 201)
        self.assertEqual(body['toUserId'], self.quiet)
        self.assertAlmostEqual(body['expiresAt'], time.time() + 7 * 86400, delta=60)
        a_family = self.family_id(self.member)
        b_family = self.family_id(self.quiet)
        view = self.view('quiet-sub')
        self.assertEqual([r['fromUserId'] for r in view['received']], [self.member])
        self.assertEqual(self.view('member-sub')['sent']['state'], 'pending')
        status, linked = self.call('POST', self.fam(f'/requests/{self.member}/confirm'), sub='quiet-sub')
        self.assertEqual(status, 200)
        self.assertEqual(linked['familyId'], b_family)
        self.assertEqual([a['userId'] for a in linked['adults']], [self.quiet, self.member])
        self.assertEqual([c['firstName'] for c in linked['children']], ['Ari', 'Noa'])
        mine = self.view('member-sub')
        self.assertEqual((mine['familyId'], mine['children']), (b_family, linked['children']))
        self.assertEqual((mine['sent'], mine['received']), (None, []))
        self.assertIsNone(self.repo.get_family(self.k, a_family))
        self.assertEqual(len(self.families()), 1)
        self.assertEqual(self.pending_items(), [])

    def test_request_pushes_generic_family_screen(self):
        with mock.patch.object(push, 'enqueue') as enqueue:
            self.ask('member-sub', self.quiet)
        enqueue.assert_called_once_with('family_request', self.k, self.quiet)

    def test_request_errors(self):
        for target in (self.member, self.listener, 'not-a-ulid', 'x' * 26):
            self.assertEqual(self.ask('member-sub', target), (400, {'error': 'invalid_to_user_id'}), target)
        with mock.patch.object(push, 'enqueue'):
            self.assertEqual(self.ask('member-sub', self.quiet)[0], 201)
            self.assertEqual(self.ask('member-sub', self.gabbai), (409, {'error': 'request_pending'}))
            self.assertEqual(self.ask('member-sub', self.quiet), (409, {'error': 'request_pending'}))
        self.repo.link(self.k, self.gabbai, self.quiet)  # quiet is now taken
        self.assertEqual(self.ask('listener-sub', self.quiet)[0], 403)
        self.repo.ensure_family(self.k, self.member)
        self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': f'PS#{self.member}'})
        self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': f'PR#{self.quiet}#{self.member}'})
        self.assertEqual(self.ask('member-sub', self.quiet), (409, {'error': 'partner_taken'}))
        self.assertEqual(self.ask('quiet-sub', self.member), (409, {'error': 'already_linked'}))

    def test_decline_is_silent_and_starts_cooldown(self):
        with mock.patch.object(push, 'enqueue'):
            self.ask('member-sub', self.quiet)
        with mock.patch.object(push, 'enqueue') as enqueue:
            status, _ = self.call('POST', self.fam(f'/requests/{self.member}/decline'), sub='quiet-sub')
        self.assertEqual(status, 204)
        enqueue.assert_not_called()
        self.assertEqual(self.view('quiet-sub')['received'], [])
        self.assertEqual(self.view('member-sub')['sent']['state'], 'declined')
        self.assertEqual(self.ask('member-sub', self.quiet), (409, {'error': 'request_cooldown'}))
        candidates = self.call('GET', self.fam('/candidates'), sub='member-sub')[1]
        by_id = {c['userId']: c for c in candidates}
        self.assertAlmostEqual(by_id[self.quiet]['cooldownUntil'], time.time() + 30 * 86400, delta=60)
        self.assertNotIn('cooldownUntil', by_id[self.gabbai])
        self.assertEqual([c['displayName'] for c in candidates], sorted(c['displayName'] for c in candidates))
        self.assertNotIn(self.member, by_id)
        self.assertNotIn(self.listener, by_id)
        with mock.patch.object(push, 'enqueue'):
            self.assertEqual(self.ask('member-sub', self.gabbai)[0], 201)  # a declined request frees the sender
        self.assertEqual(self.call('POST', self.fam(f'/requests/{self.member}/decline'), sub='quiet-sub'),
                         (404, {'error': 'request_not_found'}))

    def test_request_expires_after_7_days(self):
        with mock.patch.object(push, 'enqueue'):
            self.ask('member-sub', self.quiet)
            later = time.time() + 7 * 86400 + 1
            with mock.patch('time.time', return_value=later):
                sent = self.view('member-sub')['sent']
                self.assertEqual(sent['state'], 'expired')
                self.assertEqual(self.view('quiet-sub')['received'], [])
                self.assertEqual(self.call('POST', self.fam(f'/requests/{self.member}/confirm'), sub='quiet-sub'),
                                 (404, {'error': 'request_not_found'}))
                self.assertEqual(self.ask('member-sub', self.quiet)[0], 201)
                self.assertEqual(self.view('member-sub')['sent']['state'], 'pending')
                self.assertEqual(len(self.view('quiet-sub')['received']), 1)

    def test_withdraw(self):
        with mock.patch.object(push, 'enqueue'):
            self.ask('member-sub', self.quiet)
        self.assertEqual(self.call('DELETE', self.fam('/requests/mine'), sub='member-sub'), (204, None))
        self.assertEqual(self.view('quiet-sub')['received'], [])
        self.assertIsNone(self.view('member-sub')['sent'])
        self.assertEqual(self.pending_items(), [])
        self.assertEqual(self.call('DELETE', self.fam('/requests/mine'), sub='member-sub'), (204, None))

    def test_withdraw_dismisses_declined_banner(self):
        with mock.patch.object(push, 'enqueue'):
            self.ask('member-sub', self.quiet)
        self.call('POST', self.fam(f'/requests/{self.member}/decline'), sub='quiet-sub')
        self.assertEqual(self.call('DELETE', self.fam('/requests/mine'), sub='member-sub'), (204, None))
        self.assertIsNone(self.view('member-sub')['sent'])
        self.assertEqual(self.ask('member-sub', self.quiet), (409, {'error': 'request_cooldown'}))

    def test_unlink_copies_children_and_keeps_family_with_other(self):
        self.add_child(sub='member-sub', firstName='Noa')
        self.add_child(sub='member-sub', firstName='Ari')
        with mock.patch.object(push, 'enqueue'):
            self.ask('quiet-sub', self.member)
        self.call('POST', self.fam(f'/requests/{self.quiet}/confirm'), sub='member-sub')
        old_id = self.family_id(self.member)
        self.assertEqual(self.family_id(self.quiet), old_id)
        status, mine = self.call('POST', self.fam('/unlink'), sub='quiet-sub')
        self.assertEqual(status, 200)
        self.assertNotEqual(mine['familyId'], old_id)
        self.assertEqual([a['userId'] for a in mine['adults']], [self.quiet])
        self.assertEqual([c['firstName'] for c in mine['children']], ['Noa', 'Ari'])
        self.assertEqual(self.family_id(self.quiet), mine['familyId'])
        other = self.view('member-sub')
        self.assertEqual((other['familyId'], [a['userId'] for a in other['adults']]), (old_id, [self.member]))
        self.assertEqual(len(other['children']), 2)
        child = mine['children'][0]
        self.call('DELETE', self.fam(f'/children/{child["id"]}'), sub='quiet-sub')
        self.assertEqual(len(self.view('quiet-sub')['children']), 1)
        self.assertEqual(len(self.view('member-sub')['children']), 2)
        self.assertEqual(self.call('POST', self.fam('/unlink'), sub='quiet-sub'), (409, {'error': 'not_linked'}))

    def test_confirm_after_target_linked_elsewhere_409(self):
        with mock.patch.object(push, 'enqueue'):
            self.ask('member-sub', self.quiet)
        with mock.patch.object(self.repo, 'clear_requests'):  # the commit-to-clean-up window
            self.repo.link(self.k, self.quiet, self.gabbai)
        self.assertEqual(self.call('POST', self.fam(f'/requests/{self.member}/confirm'), sub='quiet-sub'),
                         (409, {'error': 'already_linked'}))
        self.assertEqual(len(self.repo.family_of(self.k, self.quiet)['adults']), 2)
        self.repo.clear_requests(self.k, self.quiet)
        self.assertEqual(self.pending_items(), [])
        ids = [c['userId'] for c in self.call('GET', self.fam('/candidates'), sub='member-sub')[1]]
        self.assertNotIn(self.quiet, ids)

    def test_link_clears_requests_of_both_people(self):
        with mock.patch.object(push, 'enqueue'):
            self.ask('member-sub', self.quiet)
        self.repo.link(self.k, self.quiet, self.gabbai)
        self.assertEqual(self.pending_items(), [])
        self.assertEqual(self.call('POST', self.fam(f'/requests/{self.member}/confirm'), sub='quiet-sub'),
                         (404, {'error': 'request_not_found'}))
        self.assertIsNone(self.view('member-sub')['sent'])

    def test_link_refuses_third_adult_and_same_family(self):
        self.repo.link(self.k, self.quiet, self.gabbai)
        for keep, move, code in ((self.quiet, self.member, 'already_linked'),
                                 (self.member, self.quiet, 'partner_taken'),
                                 (self.quiet, self.gabbai, 'already_linked')):
            with self.assertRaises(ApiError) as caught:
                self.repo.link(self.k, keep, move)
            self.assertEqual((caught.exception.status, caught.exception.code), (409, code))
        self.assertEqual(len(self.repo.family_of(self.k, self.quiet)['adults']), 2)

    def test_link_lost_race_is_try_again(self):
        real = self.repo.get_family
        stale = {}

        def spy(k, fid):
            item = real(k, fid)
            stale.setdefault(fid, item)
            return stale[fid]  # always the first read: every attempt sees an old version
        self.repo.ensure_family(self.k, self.member)
        self.repo.ensure_family(self.k, self.quiet)
        spy(self.k, self.family_id(self.quiet))
        self.repo.update_children(self.k, self.family_id(self.quiet), lambda c: c)
        with mock.patch.object(self.repo, 'get_family', side_effect=spy):
            with self.assertRaises(ApiError) as caught:
                self.repo.link(self.k, self.quiet, self.member)
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'try_again'))
        self.assertEqual(len(self.repo.family_of(self.k, self.member)['adults']), 1)

    def test_crossed_requests_link_once(self):
        with mock.patch.object(push, 'enqueue'):
            self.ask('member-sub', self.quiet)
            self.ask('quiet-sub', self.member)
        self.assertEqual(self.call('POST', self.fam(f'/requests/{self.quiet}/confirm'), sub='member-sub')[0], 200)
        self.assertEqual(self.call('POST', self.fam(f'/requests/{self.member}/confirm'), sub='quiet-sub'),
                         (404, {'error': 'request_not_found'}))
        family = self.repo.family_of(self.k, self.member)
        self.assertEqual(sorted(family['adults']), sorted([self.member, self.quiet]))
        self.assertEqual(self.pending_items(), [])

    def test_crossed_confirms_in_the_race_window_link_once(self):
        with mock.patch.object(push, 'enqueue'):
            self.ask('member-sub', self.quiet)
            self.ask('quiet-sub', self.member)
        with mock.patch.object(self.repo, 'clear_requests'):
            self.assertEqual(self.call('POST', self.fam(f'/requests/{self.quiet}/confirm'), sub='member-sub')[0],
                             200)
        status, body = self.call('POST', self.fam(f'/requests/{self.member}/confirm'), sub='quiet-sub')
        self.assertEqual((status, body['error'] in ('already_linked', 'partner_taken')), (409, True))
        self.assertEqual(len(self.repo.family_of(self.k, self.member)['adults']), 2)

    def test_push_texts_hide_system_keys(self):
        status, body = self.call('GET', f'{self.base()}/admin/push-texts')
        self.assertEqual(status, 200)
        self.assertFalse([key for key in body['defaults'] if key.startswith('family_')])
        for key in ('family_request', 'family_gabbai'):
            self.assertEqual(self.call('PUT', f'{self.base()}/admin/push-texts',
                                       body={'key': key, 'lang': 'he', 'text': 'x'}),
                             (400, {'error': 'invalid_key'}))


if __name__ == '__main__':
    unittest.main()
