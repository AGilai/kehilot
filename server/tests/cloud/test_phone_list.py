import unittest

from moto import mock_aws

from server.cloud import consents
from server.cloud.phones import normalize_phone
from server.tests.cloud import test_messages

NUMBER = '050-123 4567'
E164 = '+972501234567'


@mock_aws
class PhoneListTest(test_messages.MessagesTest):
    def setUp(self):
        super().setUp()
        for sub, first, last in (('member-sub', 'Mia', 'Levi'), ('quiet-sub', 'Quinn', 'Levi'),
                                 ('gabbai-sub', 'Gabi', 'Gabbai'), ('listener-sub', 'Lior', 'Listener')):
            self.call('PUT', '/v1/me/profile', sub=sub, body={'firstName': first, 'lastName': last, 'lang': 'en'})

        for user_id in (self.member, self.quiet, self.gabbai):
            self.repo.ensure_family(self.k, user_id)

    def set_phone(self, sub, phone=NUMBER):
        return self.call('PUT', '/v1/me/phone', sub=sub, body={'phone': phone})

    def switch(self, sub, show, k=None):
        return self.call('PUT', f'/v1/kehilot/{k or self.k}/me/phone-list', sub=sub, body={'show': show})

    def listing(self, sub='gabbai-sub', k=None):
        return self.call('GET', f'/v1/kehilot/{k or self.k}/phone-list', sub=sub)

    def couple(self):
        self.repo.link(self.k, self.member, self.quiet)

    def on(self, sub, phone=NUMBER):
        self.assertEqual(self.set_phone(sub, phone)[0], 200)
        self.assertEqual(self.switch(sub, True)[0], 200)

    def test_normalize_phone(self):
        for raw in ('050-123 4567', '+972 50 123 4567', '00972501234567', '+972-0501234567'):
            self.assertEqual(normalize_phone(raw), E164, raw)
        self.assertEqual(normalize_phone('02-6234567'), '+97226234567')
        self.assertEqual(normalize_phone('077-1234567'), '+972771234567')
        self.assertEqual(normalize_phone('+44 20 7946 0958'), '+442079460958')
        for raw in ('', '12345', '050-123', 'abc', '+0123456789', '+1234567890123456', '0' * 40):
            self.assertIsNone(normalize_phone(raw), raw)

    def test_consents_latest(self):
        items = [{'sk': 'CONSENT#01', 'kind': 'phoneList', 'kehilaId': 'a', 'value': 'on'},
                 {'sk': 'CONSENT#02', 'kind': 'phoneList', 'kehilaId': 'b', 'value': 'off'},
                 {'sk': 'CONSENT#03', 'kind': 'age13', 'value': 'accepted'}]
        self.assertEqual(consents.latest(items, 'phoneList', 'a')['value'], 'on')
        self.assertEqual(consents.latest(items, 'phoneList')['value'], 'off')
        self.assertIsNone(consents.latest(items, 'kehilaTerms'))
        self.assertEqual(consents.VERSIONS['phoneList'], '2026-10-28')

    def test_phone_roundtrip_and_invalid(self):
        self.assertEqual(self.set_phone('member-sub'), (200, {'phone': E164}))
        self.assertEqual(self.call('GET', '/v1/me', sub='member-sub')[1]['profile']['phone'], E164)
        self.assertEqual(self.set_phone('member-sub', 'abc'), (400, {'error': 'invalid_phone'}))
        self.assertEqual(self.call('PUT', '/v1/me/phone', sub='member-sub', body={'phone': 5}),
                         (400, {'error': 'invalid_phone'}))
        self.assertEqual(self.set_phone('member-sub', ''), (200, {'phone': None}))
        self.assertIsNone(self.call('GET', '/v1/me', sub='member-sub')[1]['profile']['phone'])
        self.assertEqual(self.set_phone('member-sub', None), (200, {'phone': None}))
        self.assertEqual(self.repo.list_consents(self.member), [])

    def test_phone_needs_profile(self):
        status, _ = self.call('PUT', '/v1/me/phone', sub='fresh-sub', body={'phone': NUMBER})
        self.assertEqual(status, 409)

    def test_put_profile_keeps_phone(self):
        self.set_phone('member-sub')
        new = {'firstName': 'Maya', 'lastName': 'Cohen', 'lang': 'he'}
        self.assertEqual(self.call('PUT', '/v1/me/profile', sub='member-sub', body=new)[0], 200)
        profile = self.call('GET', '/v1/me', sub='member-sub')[1]['profile']
        self.assertEqual(profile, {**new, 'phone': E164})

    def test_switch_needs_phone(self):
        self.assertEqual(self.switch('member-sub', True), (409, {'error': 'phone_required'}))
        self.assertEqual(self.switch('member-sub', False), (200, {'show': False}))
        self.assertEqual(self.call('PUT', f'{self.base()}/me/phone-list', sub='member-sub', body={'show': 'x'})[0], 400)

    def test_switch_writes_consent_records(self):
        self.set_phone('member-sub')
        self.assertEqual(self.switch('member-sub', True), (200, {'show': True}))
        self.assertEqual(self.switch('member-sub', False), (200, {'show': False}))
        rows = [c for c in self.repo.list_consents(self.member)]
        self.assertEqual([c['sk'][:8] for c in rows], ['CONSENT#'] * 2)
        self.assertEqual([(c['kind'], c['value'], c['version'], c['kehilaId']) for c in rows],
                         [('phoneList', 'on', consents.VERSIONS['phoneList'], self.k),
                          ('phoneList', 'off', consents.VERSIONS['phoneList'], self.k)])
        membership = self.repo.get_membership(self.k, self.member)
        self.assertEqual((membership['showPhone'], membership['phoneAsked']), (False, consents.VERSIONS['phoneList']))
        self.assertEqual(self.call('GET', self.base(), sub='member-sub')[1]['showPhone'], False)

    def test_list_shows_only_switched_on_numbers(self):
        self.couple()
        self.set_phone('quiet-sub', '052-765 4321')
        self.on('member-sub')
        self.on('gabbai-sub', '03-6234567')
        status, rows = self.listing('quiet-sub')
        self.assertEqual(status, 200)
        self.assertEqual([r['name'] for r in rows], ['Gabbai', 'Levi'])
        levi = rows[1]
        self.assertEqual(levi['familyId'], self.repo.family_of(self.k, self.member)['familyId'])
        self.assertEqual(levi['people'], [{'userId': self.member, 'name': 'Mia Member', 'phone': E164, 'tags': []}])
        self.assertEqual(rows[0]['people'][0]['phone'], '+97236234567')

    def test_family_with_nobody_on_is_absent(self):
        self.couple()
        self.set_phone('member-sub')
        self.assertEqual(self.listing(), (200, []))

    def test_children_never_included(self):
        self.on('member-sub')
        self.call('POST', f'{self.base()}/family/children', sub='member-sub',
                  body={'firstName': 'Noa', 'gender': 'f'})
        rows = self.listing()[1]
        self.assertNotIn('Noa', str(rows))
        self.assertEqual(set(rows[0]), {'familyId', 'name', 'people'})

    def test_switch_is_per_kehila(self):
        other = self.repo.create_kehila('Beit Other', {})
        self.repo.put_membership(other, self.member, 'member')
        self.repo.put_membership(other, self.gabbai, 'gabbai')
        self.repo.ensure_family(other, self.member)
        self.on('member-sub')
        self.assertEqual(len(self.listing()[1]), 1)
        self.assertEqual(self.listing(k=other), (200, []))
        self.assertEqual(self.call('GET', f'/v1/kehilot/{other}', sub='member-sub')[1]['showPhone'], False)

    def test_listener_cannot_see_list(self):
        self.on('member-sub')
        self.assertEqual(self.listing('listener-sub'), (403, {'error': 'forbidden'}))
        self.assertEqual(self.switch('listener-sub', True)[0], 403)

    def test_other_kehila_404(self):
        other = self.repo.create_kehila('Beit Other', {})
        self.assertEqual(self.listing(k=other), (404, {'error': 'kehila_not_found'}))
        self.assertEqual(self.switch('member-sub', False, k=other)[0], 404)

    def test_off_removes_at_once(self):
        self.on('member-sub')
        self.assertEqual(len(self.listing()[1]), 1)
        self.switch('member-sub', False)
        self.assertEqual(self.listing(), (200, []))

    def test_removing_number_hides_but_keeps_switch(self):
        self.on('member-sub')
        self.set_phone('member-sub', None)
        self.assertEqual(self.listing(), (200, []))
        self.assertEqual(self.call('GET', self.base(), sub='member-sub')[1]['showPhone'], True)

    def test_departed_adult_not_listed(self):
        self.couple()
        self.on('member-sub')
        self.on('quiet-sub', '052-765 4321')
        self.assertEqual(len(self.listing()[1][0]['people']), 2)
        self.repo.table.delete_item(Key=self.repo._key(self.k, f'M#{self.member}'))
        rows = self.listing()[1]
        self.assertEqual([p['userId'] for p in rows[0]['people']], [self.quiet])

    def test_list_response_not_logged(self):
        self.on('member-sub')
        with self.assertNoLogs('server.cloud', level='DEBUG'):
            self.listing()

    def admin_members(self, sub='gabbai-sub', k=None):
        return self.call('GET', f'/v1/kehilot/{k or self.k}/admin/members', sub=sub)

    def test_gabbai_sees_phones_even_when_switch_off(self):
        self.set_phone('member-sub')
        self.on('quiet-sub', '052-765 4321')
        status, rows = self.admin_members()
        self.assertEqual(status, 200)
        by = {r['userId']: r for r in rows}
        self.assertEqual((by[self.member]['phone'], by[self.member]['showPhone']), (E164, False))
        self.assertEqual((by[self.quiet]['phone'], by[self.quiet]['showPhone']), ('+972527654321', True))
        self.assertEqual((by[self.gabbai]['phone'], by[self.gabbai]['showPhone']), (None, False))
        self.assertEqual((by[self.listener]['phone'], by[self.listener]['showPhone']), (None, False))

    def test_admin_members_phones_refused_to_others(self):
        self.on('member-sub')
        for sub in ('member-sub', 'listener-sub'):
            status, body = self.admin_members(sub)
            self.assertEqual((status, body), (403, {'error': 'forbidden'}))
            self.assertNotIn(E164, str(body))

    def test_admin_members_other_kehila_404(self):
        other = self.repo.create_kehila('Beit Other', {})
        self.assertEqual(self.admin_members(k=other), (404, {'error': 'kehila_not_found'}))

    def test_admin_members_not_logged(self):
        self.on('member-sub')
        with self.assertNoLogs('server.cloud', level='DEBUG'):
            self.admin_members()


if __name__ == '__main__':
    unittest.main()
