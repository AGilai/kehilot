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


    # gabbai link, leaving, removal, pruning, gabbai view
    def link_path(self):
        return f'{self.base()}/admin/families/link'

    def gabbai_link(self, a, b, sub='gabbai-sub'):
        return self.call('POST', self.link_path(), sub=sub, body={'userIds': [a, b]})

    def cards(self, sub):
        return self.call('GET', self.base(), sub=sub)[1]['cards']

    def link_pair(self, a_sub='member-sub', b_sub='quiet-sub'):
        a, b = self.user_of(a_sub), self.user_of(b_sub)
        self.repo.link(self.k, a, b)
        return a, b

    def user_of(self, sub):
        return {'member-sub': self.member, 'quiet-sub': self.quiet, 'gabbai-sub': self.gabbai}[sub]

    def test_gabbai_links_two_members_with_notice_and_push(self):
        self.add_child(sub='member-sub', firstName='Noa')
        with mock.patch.object(push, 'enqueue') as enqueue:
            status, body = self.gabbai_link(self.member, self.quiet)
        self.assertEqual(status, 200)
        self.assertEqual(body['familyId'], self.family_id(self.member))
        self.assertEqual(self.family_id(self.quiet), body['familyId'])
        self.assertEqual(sorted(c.args for c in enqueue.call_args_list),
                         sorted([('family_gabbai', self.k, self.member), ('family_gabbai', self.k, self.quiet)]))
        self.assertEqual(self.cards('member-sub')['gabbaiLink'],
                         {'gabbaiName': 'Gabi Gabbai', 'partnerName': 'Quinn Quiet'})
        self.assertEqual(self.cards('quiet-sub')['gabbaiLink'],
                         {'gabbaiName': 'Gabi Gabbai', 'partnerName': 'Mia Member'})
        self.assertEqual(self.view('quiet-sub')['notice'], {'gabbaiName': 'Gabi Gabbai', 'partnerName': 'Mia Member'})
        self.assertEqual([c['firstName'] for c in self.view('quiet-sub')['children']], ['Noa'])
        self.assertEqual(self.call('POST', f'{self.base()}/me/cards/gabbai_link/dismiss', sub='quiet-sub'),
                         (204, None))
        self.assertIsNone(self.cards('quiet-sub')['gabbaiLink'])
        self.assertIsNone(self.view('quiet-sub')['notice'])
        self.assertIsNotNone(self.cards('member-sub')['gabbaiLink'])
        self.assertEqual(self.call('POST', f'{self.base()}/me/cards/bogus/dismiss', sub='quiet-sub'),
                         (400, {'error': 'invalid_card'}))
        self.assertEqual(self.call('POST', f'{self.base()}/me/cards/gabbai_link/dismiss', sub='listener-sub')[0], 403)

    def test_gabbai_link_errors(self):
        for ids in ([self.member, self.member], [self.member, self.listener], [self.member], [],
                    [self.member, 'nope'], [self.member, 'nobody' * 5], 'x', [self.member, self.quiet, self.gabbai]):
            self.assertEqual(self.call('POST', self.link_path(), body={'userIds': ids}),
                             (400, {'error': 'invalid_user_ids'}), ids)
        self.assertEqual(self.call('POST', self.link_path(), body={}), (400, {'error': 'invalid_user_ids'}))
        self.assertEqual(self.gabbai_link(self.member, self.quiet)[0], 200)
        for pair in ((self.member, self.gabbai), (self.gabbai, self.quiet), (self.quiet, self.member)):
            self.assertEqual(self.gabbai_link(*pair), (409, {'error': 'partner_taken'}), pair)
        self.assertEqual(self.gabbai_link(self.gabbai, self.member, sub='member-sub'), (403, {'error': 'forbidden'}))
        self.assertEqual(len(self.repo.family_of(self.k, self.member)['adults']), 2)

    def test_gabbai_link_deletes_outstanding_requests(self):
        with mock.patch.object(push, 'enqueue'):
            self.ask('quiet-sub', self.member)
            self.gabbai_link(self.quiet, self.gabbai)
        self.assertIsNone(self.view('quiet-sub')['sent'])
        self.assertEqual(self.view('member-sub')['received'], [])
        self.assertEqual(self.pending_items(), [])
        with mock.patch.object(push, 'enqueue'):
            self.ask('member-sub', self.quiet)  # quiet is linked: refused, nothing recorded
        self.assertEqual(self.pending_items(), [])

    def test_undo_gabbai_link_leaver_gets_new_family(self):
        self.add_child(sub='member-sub', firstName='Noa')
        with mock.patch.object(push, 'enqueue'):
            self.gabbai_link(self.member, self.quiet)
        kept = self.family_id(self.member)
        status, mine = self.call('POST', self.fam('/unlink'), sub='quiet-sub')
        self.assertEqual(status, 200)
        self.assertNotEqual(mine['familyId'], kept)
        self.assertEqual([c['firstName'] for c in mine['children']], ['Noa'])
        self.assertEqual(self.family_id(self.member), kept)
        self.assertIsNone(self.cards('member-sub')['gabbaiLink'])
        self.assertIsNone(self.cards('quiet-sub')['gabbaiLink'])

    def test_leave_keeps_family_with_partner(self):
        self.add_child(sub='member-sub', firstName='Noa')
        with mock.patch.object(push, 'enqueue'):
            self.gabbai_link(self.member, self.quiet)
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='member-sub'), (204, None))
        family = self.repo.family_of(self.k, self.quiet)
        self.assertEqual((family['adults'], [c['firstName'] for c in family['children']], int(family['version'])),
                         ([self.quiet], ['Noa'], 4))  # create, child, link, drop
        self.assertIsNone(self.cards('quiet-sub')['gabbaiLink'])
        self.assertEqual([a['userId'] for a in self.view('quiet-sub')['adults']], [self.quiet])
        self.assertEqual(len(self.families()), 1)

    def test_removed_member_drops_out(self):
        self.link_pair()
        self.assertEqual(self.call('DELETE', f'{self.base()}/admin/members/{self.quiet}'), (204, None))
        self.assertEqual(self.repo.family_of(self.k, self.member)['adults'], [self.member])
        (family,) = self.families()
        self.assertNotIn(self.quiet, family['adults'])

    def test_last_adult_leaving_deletes_family(self):
        self.add_child(sub='member-sub')
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='member-sub'), (204, None))
        self.assertEqual(self.families(), [])

    def test_leave_survives_failing_family_cleanup(self):
        self.link_pair()
        with mock.patch.object(self.repo, 'drop_adult', side_effect=RuntimeError('boom')):
            self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='member-sub'), (204, None))
        self.assertEqual([a['userId'] for a in self.view('quiet-sub')['adults']], [self.quiet])

    def test_leave_deletes_pending_requests_to_and_from(self):
        with mock.patch.object(push, 'enqueue'):
            self.ask('member-sub', self.quiet)
            self.ask('gabbai-sub', self.member)
        self.repo.table.put_item(Item={**self.repo._key(self.k, f'PD#{self.member}#{self.quiet}'),
                                       'until': 1, 'expiresAt': 9999999999})
        self.repo.table.put_item(Item={**self.repo._key(self.k, f'PD#{self.quiet}#{self.member}'),
                                       'until': 1, 'expiresAt': 9999999999})
        self.repo.table.put_item(Item={**self.repo._key(self.k, f'PD#{self.quiet}#{self.gabbai}'),
                                       'until': 1, 'expiresAt': 9999999999})
        self.call('DELETE', f'{self.base()}/membership', sub='member-sub')
        self.assertEqual(self.pending_items(), [])
        self.assertEqual([i['sk'] for i in self.repo._query_prefix(self.k, 'PD#')],
                         [f'PD#{self.quiet}#{self.gabbai}'])
        self.assertEqual(self.view('quiet-sub')['received'], [])
        self.assertIsNone(self.view('gabbai-sub')['sent'])

    def drop_membership_only(self, user_id):
        self.repo.table.delete_item(Key=self.repo._key(self.k, f'M#{user_id}'))

    def test_departed_adult_pruned_on_read(self):
        self.add_child(sub='member-sub', firstName='Noa')
        with mock.patch.object(push, 'enqueue'):
            self.gabbai_link(self.member, self.quiet)
        family_id = self.family_id(self.member)
        before = int(self.repo.get_family(self.k, family_id)['version'])
        self.drop_membership_only(self.member)
        rows = self.call('GET', f'{self.base()}/admin/families')[1]
        self.assertEqual([[a['userId'] for a in r['adults']] for r in rows if r['familyId'] == family_id],
                         [[self.quiet]])
        ids = [c['userId'] for c in self.call('GET', self.fam('/candidates'), sub='gabbai-sub')[1]]
        self.assertIn(self.quiet, ids)
        view = self.view('quiet-sub')
        self.assertEqual([a['userId'] for a in view['adults']], [self.quiet])
        self.assertEqual([c['firstName'] for c in view['children']], ['Noa'])
        self.assertIsNone(view['notice'])
        stored = self.repo.get_family(self.k, family_id)
        self.assertEqual((stored['adults'], int(stored['version'])), ([self.quiet], before + 1))
        self.assertIsNone(self.cards('quiet-sub')['gabbaiLink'])
        self.assertNotIn('familyNotice', self.repo.get_membership(self.k, self.quiet))

    def test_pruned_candidates_before_any_family_read(self):
        self.link_pair()
        self.drop_membership_only(self.member)
        ids = [c['userId'] for c in self.call('GET', self.fam('/candidates'), sub='gabbai-sub')[1]]
        self.assertIn(self.quiet, ids)
        self.assertEqual(self.ask('gabbai-sub', self.quiet)[0], 201)

    def test_unlink_with_departed_partner_does_not_trap(self):
        self.link_pair()
        self.drop_membership_only(self.member)
        self.assertEqual(self.call('POST', self.fam('/unlink'), sub='quiet-sub'), (409, {'error': 'not_linked'}))
        self.assertEqual(self.repo.family_of(self.k, self.quiet)['adults'], [self.quiet])

    def test_drop_adult_without_membership_finds_the_family(self):
        self.add_child(sub='member-sub', firstName='Noa')
        self.link_pair()
        self.drop_membership_only(self.member)
        self.repo.drop_adult(self.k, self.member)
        self.repo.drop_adult(self.k, self.member)  # idempotent
        family = self.repo.family_of(self.k, self.quiet)
        self.assertEqual((family['adults'], len(family['children'])), ([self.quiet], 1))
        self.drop_membership_only(self.quiet)
        self.repo.drop_adult(self.k, self.quiet)
        self.assertEqual(self.families(), [])

    def test_stale_received_hidden_when_two_live_adults(self):
        with mock.patch.object(push, 'enqueue'):
            self.ask('quiet-sub', self.member)
        with mock.patch.object(self.repo, 'clear_requests'):
            self.repo.link(self.k, self.member, self.gabbai)
        self.assertEqual(self.view('member-sub')['received'], [])
        self.assertIsNone(self.cards('member-sub')['request'])
        self.assertEqual(self.view('gabbai-sub')['received'], [])

    def test_cards_request_is_oldest_received(self):
        self.assertIsNone(self.cards('member-sub')['request'])
        with mock.patch.object(push, 'enqueue'), mock.patch('time.time', return_value=time.time() - 100):
            self.ask('quiet-sub', self.member)
        with mock.patch.object(push, 'enqueue'), mock.patch('time.time', return_value=time.time() - 50):
            self.ask('gabbai-sub', self.member)
        self.assertEqual(self.cards('member-sub')['request'], {'fromUserId': self.quiet, 'fromName': 'Quinn Quiet'})
        self.assertEqual(self.cards('listener-sub'), {'gabbaiLink': None, 'request': None, 'imported': False, 'phoneAsk': False, 'terms': False})

    def test_consistent_prefix_reads(self):
        self.assertFalse(hasattr(self.repo, 'query_consistent'))
        with mock.patch.object(self.repo.table, 'query', wraps=self.repo.table.query) as query:
            self.repo._query_prefix(self.k, 'PR#', consistent=True)
            self.repo._query_prefix(self.k, 'PR#')
        self.assertEqual([c.kwargs.get('ConsistentRead') for c in query.call_args_list], [True, None])
        with mock.patch.object(self.repo.table, 'query', wraps=self.repo.table.query) as query:
            self.repo.clear_requests(self.k, self.member)
        self.assertTrue(query.call_args_list)
        self.assertTrue(all(c.kwargs.get('ConsistentRead') is True for c in query.call_args_list))

    def test_admin_families_children_year_only(self):
        self.add_child(sub='member-sub', firstName='Noa', birthDate='2015-12-31')
        self.add_child(sub='member-sub', firstName='Ari', birthDate='')
        self.link_pair()
        status, rows = self.call('GET', f'{self.base()}/admin/families')
        self.assertEqual(status, 200)
        (row,) = [r for r in rows if self.member in [a['userId'] for a in r['adults']]]
        self.assertEqual(row['adults'], [{'userId': self.member, 'displayName': 'Mia Member'},
                                         {'userId': self.quiet, 'displayName': 'Quinn Quiet'}])
        self.assertEqual(row['children'], [{'firstName': 'Noa', 'gender': 'f', 'birthYear': 2015},
                                           {'firstName': 'Ari', 'gender': 'f'}])
        self.assertTrue(all(isinstance(c.get('birthYear', 0), int) for c in row['children']))
        self.assertNotIn('phone', str(rows))
        self.assertNotIn(self.listener, str(rows))
        self.assertEqual(self.call('GET', f'{self.base()}/admin/families', sub='member-sub')[0], 403)

    # final review fixes: partial deletion, orphan families
    def test_drop_adult_with_kept_membership_clears_family_id(self):
        """A deletion that fails after drop_adult leaves the person a member: they get a fresh family, not the
        ex-partner's, and a later confirm links only the two people who agreed."""
        self.add_child(sub='member-sub', firstName='Noa')
        self.link_pair()
        old_id = self.family_id(self.member)
        self.repo.drop_adult(self.k, self.quiet)  # membership stays (the rest of DELETE /v1/me failed)
        self.assertIsNone(self.family_id(self.quiet))
        view = self.view('quiet-sub')
        self.assertEqual(([a['userId'] for a in view['adults']], view['children']), ([self.quiet], []))
        self.assertNotEqual(view['familyId'], old_id)
        with mock.patch.object(push, 'enqueue'):
            self.ask('gabbai-sub', self.quiet)
        self.assertEqual(self.call('POST', self.fam(f'/requests/{self.gabbai}/confirm'), sub='quiet-sub')[0], 200)
        self.assertEqual(self.repo.get_family(self.k, old_id)['adults'], [self.member])
        self.assertEqual(sorted(self.repo.family_of(self.k, self.quiet)['adults']), sorted([self.quiet, self.gabbai]))

    def test_foreign_or_dangling_family_id_self_heals(self):
        self.add_child(sub='member-sub', firstName='Noa')
        theirs = self.repo.ensure_family(self.k, self.member)
        for bad in (theirs, 'gone'):
            self.repo.table.update_item(Key=self.repo._key(self.k, f'M#{self.quiet}'),
                                        UpdateExpression='SET familyId = :f', ExpressionAttributeValues={':f': bad})
            self.assertIsNone(self.repo.family_of(self.k, self.quiet))
            status, view = self.call('GET', self.fam(), sub='quiet-sub')
            self.assertEqual(status, 200)
            self.assertEqual(([a['userId'] for a in view['adults']], view['children']), ([self.quiet], []))
            self.assertEqual(self.repo.get_family(self.k, theirs)['adults'], [self.member])
            self.repo.table.update_item(Key=self.repo._key(self.k, f'M#{self.quiet}'),
                                        UpdateExpression='REMOVE familyId')
            self.repo.table.delete_item(Key=self.repo._key(self.k, f'F#{view["familyId"]}'))

    def test_admin_views_ignore_a_rejoined_adult_in_the_old_family(self):
        self.link_pair()
        old_id = self.family_id(self.member)
        self.repo.table.update_item(Key=self.repo._key(self.k, f'M#{self.quiet}'),
                                    UpdateExpression='REMOVE familyId')
        self.repo.ensure_family(self.k, self.quiet)  # rejoined with a family of their own
        rows = self.call('GET', f'{self.base()}/admin/families')[1]
        row = [r for r in rows if r['familyId'] == old_id][0]
        self.assertEqual([a['userId'] for a in row['adults']], [self.member])

    def test_purge_user_removes_the_user_from_orphan_and_shared_families(self):
        self.add_child(sub='member-sub', firstName='Noa')
        self.link_pair()
        shared = self.family_id(self.member)
        before = int(self.repo.get_family(self.k, shared)['version'])
        self.drop_membership_only(self.quiet)  # drop_adult never ran
        self.repo.purge_user(self.quiet, 'quiet-sub')
        family = self.repo.get_family(self.k, shared)
        self.assertEqual((family['adults'], len(family['children'])), ([self.member], 1))
        self.assertGreater(int(family['version']), before)
        self.drop_membership_only(self.member)
        self.repo.purge_user(self.member, 'member-sub')
        self.assertEqual(self.families(), [])

    def test_sweep_deletes_families_without_a_live_adult(self):
        self.add_child(sub='member-sub', firstName='Noa')
        self.add_child(sub='quiet-sub', firstName='Ari')
        keep = self.family_id(self.quiet)
        self.drop_membership_only(self.member)
        self.assertEqual(kehila_admin.sweep_orphan_families(self.repo, self.k, delete=False), 1)
        self.assertEqual(len(self.families()), 2)
        self.assertEqual(kehila_admin.sweep_orphan_families(self.repo, self.k), 1)
        self.assertEqual([f['familyId'] for f in self.families()], [keep])
        self.assertEqual(kehila_admin.sweep_orphan_families(self.repo), 0)


if __name__ == '__main__':
    unittest.main()
