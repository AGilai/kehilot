import json
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import push
from server.cloud.errors import ApiError
from server.cloud.message_fields import TEMPLATE_OF_TYPE, validate_fields
from server.cloud import handler as handler_module
from server.cloud.repo import Repo
from server.tests.cloud.helpers import ensure_member_channels, make_table
from server.tests.cloud.test_handler import Context, event

EVENT = {'name': 'ערב לימוד', 'date': '2026-11-03', 'time': '20:30', 'place': 'בית הכנסת', 'for': 'all'}


class ValidateTest(unittest.TestCase):
    def test_validate_event_ok_and_strips(self):
        self.assertEqual(validate_fields('event', {**EVENT, 'place': '  בית הכנסת ', 'organisers': ''}), EVENT)

    def test_validate_rejects_unknown_key_without_echo(self):
        with self.assertRaises(ApiError) as e:
            validate_fields('event', {**EVENT, 'secret': 'x'})
        self.assertEqual((e.exception.code, e.exception.field), ('invalid_fields', '<unknown>'))

    def test_validate_required_by_variant(self):
        base = {'variant': 'full', 'surname': 'ניסיון', 'deceased': 'יוסף', 'relation': 'אביו של משה'}
        with self.assertRaises(ApiError) as e:
            validate_fields('condolence', base)
        self.assertEqual(e.exception.field, 'address')
        self.assertEqual(validate_fields('condolence', {**base, 'variant': 'later'})['variant'], 'later')

    def test_validate_bad_date_and_clock(self):
        for bad in ({**EVENT, 'date': '2026-02-30'}, {**EVENT, 'time': '25:00'}):
            with self.assertRaises(ApiError):
                validate_fields('event', bad)

    def test_other_requires_detail_and_unsafe_text_refused(self):
        mazal = {'occasion': 'other', 'whose': 'parents', 'surname': 'דוגמה'}
        with self.assertRaises(ApiError) as e:
            validate_fields('mazal', mazal)
        self.assertEqual(e.exception.field, 'occasionOther')
        self.assertEqual(validate_fields('mazal', {**mazal, 'occasionOther': 'ברית'})['occasionOther'], 'ברית')
        for bad in ({**EVENT, 'name': 'a‮b'}, {**EVENT, 'name': 'a\nb'}, {**EVENT, 'name': 'x' * 121},
                    {**EVENT, 'cancelled': 'yes'}, {**EVENT, 'for': 'dogs'}, 'nope'):
            with self.assertRaises(ApiError):
                validate_fields('event', bad)
        self.assertIs(validate_fields('event', {**EVENT, 'cancelled': True})['cancelled'], True)

    def test_every_required_key_is_required(self):
        full_condolence = {'variant': 'full', 'surname': 'ניסיון', 'deceased': 'יוסף', 'relation': 'אביו',
                           'address': 'רחוב', 'hours': '9-12', 'until': '2026-11-05'}
        valid = [('event', EVENT, ['name', 'date', 'time', 'place', 'for']),
                 ('mazal', {'occasion': 'other', 'occasionOther': 'ברית', 'whose': 'other', 'whoseOther': 'חברים',
                            'surname': 'דוגמה'}, ['occasion', 'occasionOther', 'whose', 'whoseOther', 'surname']),
                 ('condolence', full_condolence, ['variant', 'surname', 'deceased', 'relation', 'address', 'hours', 'until'])]
        for template, base, required in valid:
            self.assertEqual(validate_fields(template, base), base)
            for key in required:
                with self.subTest(template=template, key=key):
                    with self.assertRaises(ApiError) as e:
                        validate_fields(template, {k: v for k, v in base.items() if k != key})
                    self.assertEqual((e.exception.code, e.exception.field), ('invalid_fields', key))
                    if key in ('name', 'place', 'surname', 'occasionOther', 'address'):  # blank text counts as missing
                        with self.assertRaises(ApiError):
                            validate_fields(template, {**base, key: '   '})

    def test_optional_keys_and_shiva_fields_kept_for_other_variants(self):
        base = {'variant': 'only', 'surname': 'ניסיון', 'deceased': 'יוסף', 'relation': 'אביו'}
        shiva = {'address': 'רחוב', 'hours': '9-12', 'until': '2026-11-05', 'prayers': 'שחרית'}
        self.assertEqual(validate_fields('condolence', {**base, **shiva}), {**base, **shiva})
        mazal = {'occasion': 'wedding', 'whose': 'parents', 'surname': 'דוגמה', 'firstNames': 'א', 'name': 'ב',
                 'parents': 'ג', 'blessing': 'ד'}
        self.assertEqual(validate_fields('mazal', mazal), mazal)
        more = {**EVENT, 'organisers': 'ה', 'more': 'ו', 'cancelled': False}
        self.assertEqual(validate_fields('event', more), more)

    def test_every_text_limit(self):
        limits = {'event': {'name': 120, 'place': 120, 'organisers': 200, 'more': 1000},
                  'mazal': {'occasionOther': 60, 'whoseOther': 60, 'surname': 60, 'firstNames': 120, 'name': 60,
                            'parents': 120, 'blessing': 200},
                  'condolence': {'surname': 60, 'deceased': 80, 'relation': 80, 'address': 200, 'hours': 120,
                                 'prayers': 200}}
        bases = {'event': EVENT,
                 'mazal': {'occasion': 'other', 'occasionOther': 'ב', 'whose': 'other', 'whoseOther': 'ח',
                           'surname': 'ד'},
                 'condolence': {'variant': 'only', 'surname': 'ד', 'deceased': 'י', 'relation': 'א'}}
        for template, keys in limits.items():
            for key, maximum in keys.items():
                with self.subTest(template=template, key=key):
                    ok = {**bases[template], key: 'א' * maximum}
                    self.assertEqual(validate_fields(template, ok)[key], 'א' * maximum)
                    with self.assertRaises(ApiError) as e:
                        validate_fields(template, {**bases[template], key: 'א' * (maximum + 1)})
                    self.assertEqual(e.exception.field, key)

    def test_type_map(self):
        self.assertEqual(TEMPLATE_OF_TYPE, {'event': 'event', 'celebration': 'mazal', 'condolence': 'condolence'})


@mock_aws
class PostFieldsTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.k = self.repo.create_kehila('Beit Test', {})
        ensure_member_channels(self.repo, self.k)
        self.channels = {c['name']: c['sk'][2:] for c in self.repo._query_prefix(self.k, 'C#')}
        user_id = self.call('GET', '/v1/me', sub='gabbai-sub')[1]['userId']
        self.repo.put_membership(self.k, user_id, 'gabbai')

    def call(self, method, path, sub='gabbai-sub', body=None):
        response = handler_module.handler(event(method, path, sub=sub, body=json.dumps(body) if body is not None else None),
                                          Context())
        return response['statusCode'], json.loads(response['body']) if response['body'] else None

    def base(self):
        return f'/v1/kehilot/{self.k}'

    def post(self, channel, **extra):
        return self.call('POST', f'{self.base()}/messages',
                         body={'type': 'weekly', 'title': 'כותרת', 'body': 'גוף', 'channelId': self.channels[channel], **extra})

    def test_post_with_template_stores_and_returns_fields(self):
        with mock.patch.object(push, 'enqueue'):
            status, body = self.post('announcements', type='event', templateId='event', fields=EVENT)
        self.assertEqual(status, 201)
        self.assertEqual((body['templateId'], body['fields']), ('event', EVENT))
        status, got = self.call('GET', f"{self.base()}/messages/{body['messageId']}")
        self.assertEqual(got['fields'], EVENT)

    def test_post_template_must_match_type(self):
        self.assertEqual(self.post('announcements', type='general', templateId='event', fields=EVENT),
                         (400, {'error': 'invalid_template_id'}))
        self.assertEqual(self.post('announcements', type='event', fields=EVENT),
                         (400, {'error': 'invalid_template_id'}))
        self.assertEqual(self.post('announcements', type='event', templateId='event'),
                         (400, {'error': 'invalid_template_id'}))
        self.assertEqual(self.post('announcements', type='event', templateId='bogus', fields=EVENT),
                         (400, {'error': 'invalid_template_id'}))

    def test_post_bad_fields(self):
        status, body = self.post('announcements', type='event', templateId='event', fields={**EVENT, 'x': 1})
        self.assertEqual((status, body['error']), (400, 'invalid_fields'))

    def test_scrub_removes_fields(self):
        with mock.patch.object(push, 'enqueue'):
            _, body = self.post('announcements', type='event', templateId='event', fields=EVENT)
        self.repo.scrub_message(self.k, body['messageId'])
        stored = self.repo.get_message(self.k, body['messageId'])
        self.assertNotIn('fields', stored)
        self.assertNotIn('templateId', stored)
