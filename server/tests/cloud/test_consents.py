import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import consents
from server.tests.cloud import test_messages

GABBAI_SUB, MEMBER_SUB, LISTENER_SUB = 'gabbai-sub', 'member-sub', 'listener-sub'


@mock_aws
class ConsentsTest(test_messages.MessagesTest):
    def setUp(self):
        super().setUp()
        for sub, first, last in ((MEMBER_SUB, 'Mia', 'Levi'), (GABBAI_SUB, 'Gabi', 'Gabbai'),
                                 (LISTENER_SUB, 'Lior', 'Listener')):
            self.call('PUT', '/v1/me/profile', sub=sub, body={'firstName': first, 'lastName': last, 'lang': 'en'})

    def kehila(self, sub):
        status, body = self.call('GET', self.base(), sub=sub)
        self.assertEqual(status, 200)
        return body

    def accept(self, sub=GABBAI_SUB):
        return self.call('POST', f'{self.base()}/admin/terms', sub=sub)

    def settings(self, body, sub=GABBAI_SUB):
        return self.call('PUT', f'{self.base()}/admin/settings', sub=sub, body=body)

    def dismiss(self, card, sub):
        return self.call('POST', f'{self.base()}/me/cards/{card}/dismiss', sub=sub)

    def test_age13_required_until_recorded(self):
        self.assertTrue(self.call('GET', '/v1/me', sub=MEMBER_SUB)[1]['age13Required'])
        self.assertEqual(self.call('POST', '/v1/me/consents/age13', sub=MEMBER_SUB), (204, None))
        self.assertFalse(self.call('GET', '/v1/me', sub=MEMBER_SUB)[1]['age13Required'])
        item = consents.latest(self.repo.list_consents(self.member), 'age13')
        self.assertEqual((item['value'], item['version']), ('accepted', consents.VERSIONS['age13']))
        with mock.patch.dict(consents.VERSIONS, {'age13': '2027-01-01'}):
            self.assertTrue(self.call('GET', '/v1/me', sub=MEMBER_SUB)[1]['age13Required'])

    def test_terms_card_for_gabbai_only_until_accepted(self):
        self.assertTrue(self.kehila(GABBAI_SUB)['cards']['terms'])
        self.assertIsNone(self.kehila(GABBAI_SUB)['termsAccepted'])
        self.assertFalse(self.kehila(MEMBER_SUB)['cards']['terms'])
        self.assertNotIn('termsAccepted', self.kehila(MEMBER_SUB))
        status, body = self.accept()
        self.assertEqual(status, 200)
        self.assertIn('at', body)
        second = self.add('gabbai2-sub', 'gabbai', 'Gita Second')
        for sub in (GABBAI_SUB, 'gabbai2-sub'):
            got = self.kehila(sub)
            self.assertFalse(got['cards']['terms'])
            self.assertEqual(got['termsAccepted']['name'], 'Gabi Gabbai')
            self.assertEqual(got['termsAccepted']['at'], body['at'])
        item = consents.latest(self.repo.list_consents(self.gabbai), 'kehilaTerms', self.k)
        self.assertEqual((item['value'], item['version']), ('accepted', consents.VERSIONS['kehilaTerms']))
        self.assertEqual(self.repo.list_consents(second), [])

    def test_terms_accepted_by_departed_user_has_empty_name(self):
        self.accept()
        self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.gabbai}'})
        self.add('gabbai2-sub', 'gabbai', 'Gita Second')
        self.assertEqual(self.kehila('gabbai2-sub')['termsAccepted']['name'], '')

    def test_terms_new_version_asks_again(self):
        self.accept()
        with mock.patch.dict(consents.VERSIONS, {'kehilaTerms': '2027-01-01'}):
            self.assertTrue(self.kehila(GABBAI_SUB)['cards']['terms'])
            self.assertEqual(self.accept()[0], 200)
            self.assertFalse(self.kehila(GABBAI_SUB)['cards']['terms'])

    def test_member_cannot_accept_terms(self):
        self.assertEqual(self.accept(MEMBER_SUB)[0], 403)
        self.assertEqual(self.accept(LISTENER_SUB)[0], 403)
        self.assertEqual(self.repo.list_consents(self.member), [])

    def test_privacy_contact_set_shown_removed(self):
        self.assertEqual(self.kehila(MEMBER_SUB)['privacyContact'], '')
        self.assertEqual(self.settings({'privacyContact': '  privacy@beit.example.test  '})[0], 200)
        for sub in (GABBAI_SUB, MEMBER_SUB, LISTENER_SUB):
            self.assertEqual(self.kehila(sub)['privacyContact'], 'privacy@beit.example.test')
        for bad in ('x' * 101, 'a‮b', 'a\nb', 5, None):
            self.assertEqual(self.settings({'privacyContact': bad}), (400, {'error': 'invalid_privacy_contact'}), bad)
        self.assertEqual(self.settings({'privacyContact': 'ש' * 100})[0], 200)
        self.assertEqual(self.settings({'privacyContact': ''})[0], 200)
        self.assertEqual(self.kehila(MEMBER_SUB)['privacyContact'], '')
        self.assertEqual(self.settings({}), (400, {'error': 'invalid_body'}))
        self.assertEqual(self.settings({'maxListeners': 7})[0], 200)
        self.assertEqual(self.kehila(GABBAI_SUB)['settings']['maxListeners'], 7)
        self.settings({'privacyContact': 'keep'})
        self.settings({'maxListeners': 8})
        self.assertEqual(self.kehila(MEMBER_SUB)['privacyContact'], 'keep')
        self.assertEqual(self.settings({'maxListeners': 9, 'privacyContact': 'both'})[0], 200)
        self.assertEqual(self.kehila(GABBAI_SUB)['settings']['maxListeners'], 9)
        self.assertEqual(self.kehila(GABBAI_SUB)['privacyContact'], 'both')
        self.assertEqual(self.settings({'privacyContact': 'x'}, MEMBER_SUB)[0], 403)

    def test_phone_card_until_answered(self):
        self.assertTrue(self.kehila(MEMBER_SUB)['cards']['phoneAsk'])
        self.assertTrue(self.kehila(GABBAI_SUB)['cards']['phoneAsk'])
        self.assertFalse(self.kehila(LISTENER_SUB)['cards']['phoneAsk'])
        self.assertEqual(self.dismiss('phone', MEMBER_SUB), (204, None))
        self.assertFalse(self.kehila(MEMBER_SUB)['cards']['phoneAsk'])
        self.assertEqual(self.repo.list_consents(self.member), [])  # "not now" is not a consent
        self.assertEqual(self.dismiss('phone', LISTENER_SUB)[0], 403)
        self.call('PUT', '/v1/me/phone', sub=GABBAI_SUB, body={'phone': '050-123 4567'})
        self.call('PUT', f'{self.base()}/me/phone-list', sub=GABBAI_SUB, body={'show': True})
        self.assertFalse(self.kehila(GABBAI_SUB)['cards']['phoneAsk'])
        with mock.patch.dict(consents.VERSIONS, {'phoneList': '2027-01-01'}):
            self.assertTrue(self.kehila(MEMBER_SUB)['cards']['phoneAsk'])

    def test_phone_card_reasked_for_gabbai_phones_version(self):
        # answered under the previous version (2026-10-27): asked once more under 2026-10-28
        self.repo.set_phone_asked(self.k, self.member, '2026-10-27')
        self.assertTrue(self.kehila(MEMBER_SUB)['cards']['phoneAsk'])
        self.assertEqual(self.dismiss('phone', MEMBER_SUB), (204, None))
        self.assertFalse(self.kehila(MEMBER_SUB)['cards']['phoneAsk'])

    def test_imported_card_dismiss_any_role(self):
        self.assertFalse(self.kehila(LISTENER_SUB)['cards']['imported'])
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.listener}'},
                                    UpdateExpression='SET importNotice = :t', ExpressionAttributeValues={':t': True})
        self.assertTrue(self.kehila(LISTENER_SUB)['cards']['imported'])
        self.assertEqual(self.dismiss('imported', LISTENER_SUB), (204, None))
        self.assertFalse(self.kehila(LISTENER_SUB)['cards']['imported'])

    def test_unknown_card_400(self):
        self.assertEqual(self.dismiss('nope', MEMBER_SUB), (400, {'error': 'invalid_card'}))
        self.assertEqual(self.dismiss('nope', LISTENER_SUB), (400, {'error': 'invalid_card'}))
        self.assertEqual(self.dismiss('gabbai_link', LISTENER_SUB)[0], 403)

    def test_phone_list_consent_written_before_switch(self):
        self.call('PUT', '/v1/me/phone', sub=MEMBER_SUB, body={'phone': '050-123 4567'})
        with mock.patch.object(self.repo, 'set_phone_switch', side_effect=RuntimeError('boom')):
            try:
                self.call('PUT', f'{self.base()}/me/phone-list', sub=MEMBER_SUB, body={'show': True})
            except RuntimeError:
                pass
        self.assertFalse(self.kehila(MEMBER_SUB)['showPhone'])
        self.assertEqual(consents.latest(self.repo.list_consents(self.member), 'phoneList', self.k)['value'], 'on')

    def test_put_phone_without_key_is_400(self):
        self.call('PUT', '/v1/me/phone', sub=MEMBER_SUB, body={'phone': '050-123 4567'})
        self.assertEqual(self.call('PUT', '/v1/me/phone', sub=MEMBER_SUB, body={}), (400, {'error': 'invalid_phone'}))
        self.assertEqual(self.call('PUT', '/v1/me/phone', sub=MEMBER_SUB, body={'phon': None})[0], 400)
        self.assertTrue(self.call('GET', '/v1/me', sub=MEMBER_SUB)[1]['profile']['phone'])
        self.assertEqual(self.call('PUT', '/v1/me/phone', sub=MEMBER_SUB, body={'phone': None}), (200, {'phone': None}))
        self.assertEqual(self.call('PUT', '/v1/me/phone', sub=MEMBER_SUB, body={'phone': ''}), (200, {'phone': None}))


if __name__ == '__main__':
    unittest.main()
