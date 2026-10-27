import io
import json
import zipfile
from unittest import mock

from moto import mock_aws

from server.cloud import export, type_rules, visibility
from server.tests.cloud import test_phone_list
from server.tests.cloud.test_groups import own_tests_only
from server.tests.cloud.test_phone_list import NUMBER


@own_tests_only
@mock_aws
class TagsTest(test_phone_list.PhoneListTest):
    """Reuses the phone-list fixtures (profiles, families) but none of its tests."""

    def tags_url(self, tag_id=None):
        return f'{self.base()}/admin/tags' + (f'/{tag_id}' if tag_id else '')

    def make(self, name, sub='gabbai-sub', expect=201):
        status, body = self.call('POST', self.tags_url(), sub=sub, body={'name': name})
        self.assertEqual(status, expect, body)
        return body.get('tagId') if status == 201 else body

    def assign(self, user_id, ids, sub='gabbai-sub'):
        return self.call('PUT', f'{self.base()}/admin/members/{user_id}/tags', sub=sub, body={'tagIds': ids})

    def member_row(self, user_id):
        status, rows = self.call('GET', f'{self.base()}/admin/members')
        self.assertEqual(status, 200)
        return next(r for r in rows if r['userId'] == user_id)

    def test_create_list_rename(self):
        rabbi = self.make(' Rabbi ')
        tech = self.make('tech')
        status, rows = self.call('GET', self.tags_url())
        self.assertEqual((status, rows), (200, [{'tagId': rabbi, 'name': 'Rabbi', 'memberCount': 0},
                                                {'tagId': tech, 'name': 'tech', 'memberCount': 0}]))
        self.assign(self.member, [rabbi])
        self.assertEqual(self.call('GET', self.tags_url())[1][0]['memberCount'], 1)
        self.assertEqual(self.call('PUT', self.tags_url(rabbi), body={'name': 'Rav'}),
                         (200, {'tagId': rabbi, 'name': 'Rav'}))
        self.assertEqual(self.member_row(self.member)['tags'], [{'tagId': rabbi, 'name': 'Rav'}])
        self.assertEqual(self.call('PUT', self.tags_url(rabbi), body={'name': 'RAV'})[0], 200)  # own name, new case
        self.assertEqual(self.call('PUT', self.tags_url(rabbi), body={'name': ' TECH '}), (409, {'error': 'tag_exists'}))

    def test_name_validation(self):
        for bad in ('', '   ', 'x' * 25, 'a\nb', 'a\tb', 'a‮b', 'a b', 'a\x00b', 5, None, ['a']):
            self.assertEqual(self.call('POST', self.tags_url(), body={'name': bad}),
                             (400, {'error': 'invalid_tag_name'}), repr(bad))
        self.assertEqual(self.call('POST', self.tags_url(), body={}), (400, {'error': 'invalid_tag_name'}))
        self.make('x' * 24)
        self.make('ועד שמחות')
        tag = self.make('ok')
        self.assertEqual(self.call('PUT', self.tags_url(tag), body={'name': 'a\nb'}),
                         (400, {'error': 'invalid_tag_name'}))

    def test_unique_case_insensitive_after_trim(self):
        self.make('Rabbi')
        for dup in ('rabbi', ' RABBI ', 'Rabbi'):
            self.assertEqual(self.make(dup, expect=409), {'error': 'tag_exists'}, dup)

    def test_limit_twenty(self):
        for i in range(20):
            self.make(f'tag {i}')
        self.assertEqual(self.make('one more', expect=409), {'error': 'too_many_tags'})
        status, rows = self.call('GET', self.tags_url())
        self.call('DELETE', self.tags_url(rows[0]['tagId']))
        self.make('one more')

    def test_only_gabbai(self):
        tag = self.make('Rabbi')
        for sub in ('member-sub', 'quiet-sub', 'listener-sub'):
            self.assertEqual(self.call('GET', self.tags_url(), sub=sub)[0], 403, sub)
            self.assertEqual(self.call('POST', self.tags_url(), sub=sub, body={'name': 'x'})[0], 403, sub)
            self.assertEqual(self.call('PUT', self.tags_url(tag), sub=sub, body={'name': 'x'})[0], 403, sub)
            self.assertEqual(self.call('DELETE', self.tags_url(tag), sub=sub)[0], 403, sub)
            self.assertEqual(self.assign(self.quiet, [tag], sub=sub)[0], 403, sub)
        self.assertEqual(self.call('GET', self.tags_url(), sub='nobody-sub')[0], 404)  # not a member at all: the Kehila is not revealed
        self.assertEqual(self.call('GET', f'{self.base()}/admin/members', sub='member-sub')[0], 403)

    def test_other_kehila_gabbai_gets_404_and_cannot_use_foreign_tags(self):
        other = self.repo.create_kehila('Other', {})
        user = self.call('GET', '/v1/me', sub='x-sub')[1]['userId']
        self.repo.put_membership(other, user, 'gabbai')
        foreign = self.call('POST', f'/v1/kehilot/{other}/admin/tags', sub='x-sub', body={'name': 'Theirs'})[1]['tagId']
        self.assertEqual(self.call('GET', self.tags_url(), sub='x-sub')[0], 404)
        self.assertEqual(self.assign(self.member, [foreign]), (400, {'error': 'invalid_tag_ids'}))
        self.assertEqual(self.call('PUT', self.tags_url(foreign), body={'name': 'x'}), (404, {'error': 'tag_not_found'}))

    def test_not_found(self):
        for tag_id in ('0' * 26, 'nope'):
            self.assertEqual(self.call('PUT', self.tags_url(tag_id), body={'name': 'x'}), (404, {'error': 'tag_not_found'}))
            self.assertEqual(self.call('DELETE', self.tags_url(tag_id)), (404, {'error': 'tag_not_found'}))

    def test_assign_validation(self):
        tag = self.make('Rabbi')
        for bad in ('x', None, [5], ['nope'], ['0' * 26], [tag, '0' * 26], [tag] * 21):
            self.assertEqual(self.call('PUT', f'{self.base()}/admin/members/{self.member}/tags', body={'tagIds': bad}),
                             (400, {'error': 'invalid_tag_ids'}), repr(bad))
        self.assertEqual(self.call('PUT', f'{self.base()}/admin/members/{self.member}/tags', body={}),
                         (400, {'error': 'invalid_tag_ids'}))
        self.assertEqual(self.assign('0' * 26, [tag]), (404, {'error': 'member_not_found'}))
        self.assertEqual(self.assign('nope', [tag]), (404, {'error': 'member_not_found'}))

    def test_assign_replaces_clears_and_dedupes(self):
        a, b = self.make('Alpha'), self.make('Beta')
        status, out = self.assign(self.member, [b, a, a])
        self.assertEqual(status, 200)
        self.assertEqual(out['tags'], [{'tagId': a, 'name': 'Alpha'}, {'tagId': b, 'name': 'Beta'}])
        self.assertEqual(self.assign(self.member, [b])[0], 200)
        self.assertEqual(self.member_row(self.member)['tags'], [{'tagId': b, 'name': 'Beta'}])
        self.assertEqual(self.assign(self.member, [])[0], 200)
        self.assertEqual(self.member_row(self.member)['tags'], [])
        self.assertEqual(self.member_row(self.quiet)['tags'], [])

    def test_listener_and_gabbai_can_hold_tags(self):
        tag = self.make('Tech')
        self.assertEqual(self.assign(self.listener, [tag])[0], 200)
        self.assertEqual(self.assign(self.gabbai, [tag])[0], 200)
        self.assertEqual(self.member_row(self.listener)['tags'], [{'tagId': tag, 'name': 'Tech'}])
        self.assertEqual(self.call('GET', self.base(), sub='listener-sub')[1]['tags'], [{'tagId': tag, 'name': 'Tech'}])
        self.assertEqual(self.member_row(self.listener)['role'], 'listener')

    def test_delete_cascades(self):
        a, b = self.make('Alpha'), self.make('Beta')
        self.assign(self.member, [a, b])
        self.assign(self.quiet, [a])
        self.assertEqual(self.call('DELETE', self.tags_url(a)), (204, None))
        for user_id in (self.member, self.quiet):
            item = self.repo.get_membership(self.k, user_id)
            self.assertNotIn(a, item.get('tagIds') or set())
        self.assertEqual(self.repo.get_membership(self.k, self.member)['tagIds'], {b})
        self.assertNotIn('tagIds', self.repo.get_membership(self.k, self.quiet))
        self.assertEqual(self.member_row(self.member)['tags'], [{'tagId': b, 'name': 'Beta'}])
        self.assertEqual(self.call('DELETE', self.tags_url(a)), (404, {'error': 'tag_not_found'}))

    def test_stale_ids_never_shown(self):
        a = self.make('Alpha')
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.member}'},
                                    UpdateExpression='ADD tagIds :s', ExpressionAttributeValues={':s': {a, 'S' * 26}})
        self.assertEqual(self.member_row(self.member)['tags'], [{'tagId': a, 'name': 'Alpha'}])
        self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': f'TAG#{a}'})  # tag gone, ids left behind
        self.assertEqual(self.member_row(self.member)['tags'], [])
        self.assertEqual(self.call('GET', self.base(), sub='member-sub')[1]['tags'], [])
        self.assertNotIn(a, json.dumps(self.call('GET', f'{self.base()}/admin/members')[1]))

    def test_me_view_shows_own_tags_only_and_other_roles_do_not_see_tag_list(self):
        a, b = self.make('Rabbi'), self.make('Tech')
        self.assign(self.member, [a])
        self.assertEqual(self.call('GET', self.base(), sub='member-sub')[1]['tags'], [{'tagId': a, 'name': 'Rabbi'}])
        self.assertEqual(self.call('GET', self.base(), sub='quiet-sub')[1]['tags'], [])
        # messages and the channel list carry no tags
        mid = self.post('announcements')[1]
        self.assertNotIn('tags', mid)
        self.assertNotIn('tags', json.dumps(self.call('GET', f'{self.base()}/channels', sub='member-sub')[1]))
        self.assertNotIn('tags', json.dumps(self.call('GET', f'{self.base()}/messages', sub='member-sub')[1]))
        self.assertNotIn('Rabbi', json.dumps(self.call('GET', f'{self.base()}/members', sub='member-sub')[1]))

    def test_phone_list_tags_only_on_opted_in(self):
        a = self.make('Treasurer')
        self.assign(self.member, [a])
        self.assign(self.quiet, [a])  # tagged but not opted in: must not appear
        self.on('member-sub')
        status, rows = self.listing('quiet-sub')
        self.assertEqual(status, 200)
        people = [p for r in rows for p in r['people']]
        self.assertEqual([p['userId'] for p in people], [self.member])
        self.assertEqual(people[0]['tags'], [{'tagId': a, 'name': 'Treasurer'}])
        self.assertNotIn(self.quiet, json.dumps(rows))
        # an opted-in person without tags gets an empty list
        self.on('gabbai-sub')
        people = {p['userId']: p for r in self.listing()[1] for p in r['people']}
        self.assertEqual(people[self.gabbai]['tags'], [])
        # tagging someone never adds them to the list
        self.assign(self.listener, [a])
        self.assertEqual(set(people), {self.member, self.gabbai})

    def test_tags_grant_nothing(self):
        channel = self.repo.get_channel(self.k, self.channels['announcements'])
        simchas = self.repo.get_channel(self.k, self.channels['simchas'])
        message = {'type': 'celebration', 'channelId': self.channels['simchas']}
        rules = type_rules.rules({})

        def snapshot():
            out = []
            for user_id in (self.gabbai, self.member, self.quiet, self.listener):
                m = self.repo.get_membership(self.k, user_id)
                for ch in (channel, simchas):
                    out.append((visibility.can_post(m, ch), visibility.can_read_channel(m, ch),
                                visibility.message_visible(m, ch, message, rules),
                                [visibility.can_post(m, ch, t, rules) for t in type_rules.TYPES],
                                type_rules.postable_types(m, ch, rules)))
            return out

        before = snapshot()
        tags = [self.make(n) for n in ('Gabbai', 'Rabbi', 'Tech')]  # names that sound powerful
        for user_id in (self.gabbai, self.member, self.quiet, self.listener):
            self.assertEqual(self.assign(user_id, tags)[0], 200)
        self.assertTrue(self.repo.get_membership(self.k, self.quiet)['tagIds'])
        self.assertEqual(snapshot(), before)
        # and over HTTP: the tagged non-broadcaster still cannot post, the listener still cannot
        self.assertEqual(self.post('simchas', sub='quiet-sub', type='general'), (403, {'error': 'forbidden'}))
        self.assertEqual(self.post('announcements', sub='listener-sub')[0], 403)
        self.assertEqual(self.call('GET', f'{self.base()}/admin/tags', sub='quiet-sub')[0], 403)

    def test_leaving_and_removal_take_tags_along(self):
        a = self.make('Alpha')
        self.assign(self.quiet, [a])
        self.assertEqual(self.call('DELETE', f'{self.base()}/membership', sub='quiet-sub')[0], 204)
        self.assertIsNone(self.repo.get_membership(self.k, self.quiet))
        self.assign(self.member, [a])
        self.assertEqual(self.call('DELETE', f'{self.base()}/admin/members/{self.member}')[0], 204)
        self.assertEqual(self.call('GET', self.tags_url())[1][0]['memberCount'], 0)
        # a member who rejoins starts without tags
        self.repo.put_membership(self.k, self.member, 'member')
        self.assertNotIn('tagIds', self.repo.get_membership(self.k, self.member))

    def test_account_deletion_leaves_no_tag_ids(self):
        a = self.make('Alpha')
        self.assign(self.quiet, [a])
        self.repo.purge_user(self.quiet, 'quiet-sub')
        mine = [i for i in self.repo.table.scan()['Items'] if self.quiet in json.dumps(i, default=str)]
        self.assertEqual(mine, [])
        self.assertEqual([t['sk'] for t in self.repo._query_prefix(self.k, 'TAG#')], [f'TAG#{a}'])  # the Kehila's tag stays

    def test_export_has_own_tag_names(self):
        a, b = self.make('Rabbi'), self.make('Tech')
        self.assign(self.quiet, [a])
        self.assign(self.member, [b])
        data = export._kehilot(self.repo, self.quiet)
        self.assertEqual(data[0]['tags'], ['Rabbi'])
        self.assertNotIn('Tech', json.dumps(data))
        self.assertEqual(export._kehilot(self.repo, self.listener)[0]['tags'], [])
