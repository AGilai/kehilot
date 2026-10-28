"""Tech-role plan, Task R2: assigning the tech role, and the role on attributions (owner decision 2026-10-28:
a tech has every gabbai right; only the label differs)."""
from unittest import mock

from moto import mock_aws

from server.cloud import push, routes_sheet, sheet_items
from server.tests.cloud import test_messages
from server.tests.cloud.test_groups import own_tests_only
from server.tests.cloud.test_sheet_routes import FRIDAY, at


@own_tests_only
@mock_aws
class TechAssignTest(test_messages.MessagesTest):
    def setUp(self):
        super().setUp()
        self.tech = self.add('tech-sub', 'tech', 'Tali Tech')

    def member_path(self, user_id=None):
        return f'{self.base()}/admin/members/{user_id or self.quiet}'

    def role_of(self, user_id):
        return self.repo.get_membership(self.k, user_id)['role']

    # update_member
    def test_gabbai_grants_tech(self):
        self.assertEqual(self.call('PUT', self.member_path(), 'gabbai-sub', {'role': 'tech'})[0], 200)
        self.assertEqual(self.role_of(self.quiet), 'tech')

    def test_tech_grants_gabbai_and_tech(self):
        self.assertEqual(self.call('PUT', self.member_path(), 'tech-sub', {'role': 'gabbai'})[0], 200)
        self.assertEqual(self.role_of(self.quiet), 'gabbai')
        self.assertEqual(self.call('PUT', self.member_path(self.member), 'tech-sub', {'role': 'tech'})[0], 200)
        self.assertEqual(self.role_of(self.member), 'tech')

    def test_member_grants_nothing(self):
        for role in ('member', 'tech', 'gabbai'):
            self.assertEqual(self.call('PUT', self.member_path(), 'member-sub', {'role': role}),
                             (403, {'error': 'forbidden'}))
        self.assertEqual(self.role_of(self.quiet), 'member')

    def test_other_roles_stay_invalid(self):
        for role in ('owner', 'Tech', '', None, 5):
            self.assertEqual(self.call('PUT', self.member_path(), 'gabbai-sub', {'role': role}),
                             (400, {'error': 'invalid_role'}), role)

    def test_a_tech_cannot_become_listener_and_a_listener_cannot_become_tech(self):
        self.assertEqual(self.call('PUT', self.member_path(self.tech), 'gabbai-sub', {'role': 'listener'}),
                         (409, {'error': 'role_change_not_allowed'}))
        self.assertEqual(self.call('PUT', self.member_path(self.listener), 'gabbai-sub', {'role': 'tech'}),
                         (409, {'error': 'role_change_not_allowed'}))

    # invites
    def invite(self, sub, role='tech'):
        return self.call('POST', f'{self.base()}/invites', sub=sub, body={'role': role})

    def test_gabbai_and_tech_create_a_tech_invite_that_makes_a_tech(self):
        for sub in ('gabbai-sub', 'tech-sub'):
            status, body = self.invite(sub)
            self.assertEqual(status, 201, sub)
            self.assertEqual(self.call('GET', f'/v1/invites/{body["code"]}', sub=None)[1]['role'], 'tech')
        new = self.call('GET', '/v1/me', sub='new-sub')[1]['userId']
        self.call('PUT', '/v1/me/profile', sub='new-sub', body={'firstName': 'נתן', 'lastName': 'דוגמה', 'lang': 'he'})
        self.assertEqual(self.call('POST', f'/v1/invites/{body["code"]}/accept', sub='new-sub'),
                         (200, {'kehilaId': self.k, 'role': 'tech'}))
        self.assertEqual(self.role_of(new), 'tech')

    def test_member_cannot_create_a_tech_invite_and_gabbai_invites_stay_closed(self):
        self.assertEqual(self.invite('member-sub'), (403, {'error': 'forbidden'}))
        self.assertEqual(self.invite('gabbai-sub', 'gabbai'), (400, {'error': 'invalid_role'}))
        self.assertEqual(self.invite('gabbai-sub', 'owner'), (400, {'error': 'invalid_role'}))

    def test_tech_invite_dies_when_its_inviter_stops_being_management(self):
        code = self.invite('tech-sub')[1]['code']
        self.assertEqual(self.call('PUT', self.member_path(self.tech), 'gabbai-sub', {'role': 'member'})[0], 200)
        self.call('GET', '/v1/me', sub='new-sub')
        self.call('PUT', '/v1/me/profile', sub='new-sub', body={'firstName': 'נתן', 'lastName': 'דוגמה', 'lang': 'he'})
        self.assertEqual(self.call('POST', f'/v1/invites/{code}/accept', sub='new-sub'),
                         (410, {'error': 'invite_expired'}))

    # family link card
    def test_family_link_card_names_the_linkers_role(self):
        with mock.patch.object(push, 'enqueue'):
            for sub, role in (('gabbai-sub', 'gabbai'), ('tech-sub', 'tech')):
                self.call('POST', f'{self.base()}/admin/families/link', sub=sub,
                          body={'userIds': [self.member, self.quiet]})
                for who in ('member-sub', 'quiet-sub'):
                    card = self.call('GET', self.base(), sub=who)[1]['cards']['gabbaiLink']
                    self.assertEqual(card['gabbaiRole'], role)
                self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.quiet}'},
                                            UpdateExpression='REMOVE familyId')
                self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.member}'},
                                            UpdateExpression='REMOVE familyId')

    def test_family_link_card_role_when_the_linker_has_left(self):
        with mock.patch.object(push, 'enqueue'):
            self.call('POST', f'{self.base()}/admin/families/link', sub='tech-sub',
                      body={'userIds': [self.member, self.quiet]})
        self.assertEqual(self.call('DELETE', f'{self.base()}/admin/members/{self.tech}', 'gabbai-sub')[0], 204)
        card = self.call('GET', self.base(), sub='member-sub')[1]['cards']['gabbaiLink']
        self.assertEqual((card['gabbaiName'], card['gabbaiRole']), ('', None))

    # push text
    def test_family_push_text_names_no_role(self):
        text = push.PUSH_TEXT['family_gabbai']
        self.assertEqual(set(text), {'he', 'en'})
        for lang, words in (('he', ('גבאי', 'טכני')), ('en', ('gabbai', 'tech'))):
            self.assertFalse(any(w in text[lang].lower() for w in words), text[lang])
        self.assertEqual(push.resolve_text({'pushTexts': {'family_gabbai': {'en': 'x'}}}, 'family_gabbai', 'en'),
                         text['en'])


@own_tests_only
@mock_aws
class TechSheetRoleTest(test_messages.MessagesTest):
    def setUp(self):
        super().setUp()
        self.tech = self.add('tech-sub', 'tech', 'Tali Tech')
        for module in (sheet_items, routes_sheet):
            patcher = mock.patch.object(module, '_now', return_value=at(2026, 10, 28, 9, 0))
            patcher.start()
            self.addCleanup(patcher.stop)

    def add_line(self, sub, **extra):
        return self.call('POST', f'{self.base()}/admin/sheet/{FRIDAY}/items', sub=sub,
                         body={'type': 'notice', 'text': 'שלום', **extra})

    def test_by_gabbai_items_carry_the_role_of_who_added_them(self):
        for sub, role in (('gabbai-sub', 'gabbai'), ('tech-sub', 'tech')):
            status, item = self.add_line(sub, source='byGabbai')
            self.assertEqual((status, item['source'], item['byRole']), (201, 'byGabbai', role))
        sheet = self.call('GET', f'{self.base()}/sheet/{FRIDAY}', sub='member-sub')[1]['items']
        self.assertEqual(sorted(i['byRole'] for i in sheet), ['gabbai', 'tech'])

    def test_other_sources_have_no_by_role(self):
        status, item = self.add_line('tech-sub')
        self.assertEqual((status, item['source']), (201, 'free'))
        self.assertNotIn('byRole', item)

    def test_a_by_gabbai_item_stored_before_the_field_existed_reads_as_gabbai(self):
        item = self.add_line('gabbai-sub', source='byGabbai')[1]
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'SI#{FRIDAY}#{item["itemId"]}'},
                                    UpdateExpression='REMOVE byRole')
        sheet = self.call('GET', f'{self.base()}/sheet/{FRIDAY}', sub='member-sub')[1]['items']
        self.assertEqual(sheet[0]['byRole'], 'gabbai')
