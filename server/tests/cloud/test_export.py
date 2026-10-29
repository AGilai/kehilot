import io
import json
import os
import time
import zipfile
from unittest import mock
from urllib.parse import parse_qs, urlparse

from botocore.exceptions import ClientError
from moto import mock_aws

from server.cloud import export, media
from server.cloud.repo_messages import local_date
from server.tests.cloud import test_conversation, test_private_replies
from server.tests.cloud.helpers import MEDIA_BUCKET
from server.tests.cloud.test_groups import own_tests_only
from server.tests.cloud.test_media import JPEG, start_media


@own_tests_only
@mock_aws
class ExportTest(test_conversation.ConversationTest):
    """Reuses the conversation fixtures but none of its tests."""

    def setUp(self):
        super().setUp()
        self.s3 = start_media(self)
        self.today = local_date()
        self.key = media.export_key(self.quiet, self.today)

    def post(self, sub='quiet-sub'):
        return self.call('POST', '/v1/me/export', sub=sub)

    def objects(self):
        return [o['Key'] for o in self.s3.list_objects_v2(Bucket=MEDIA_BUCKET, Prefix='x/').get('Contents', [])]

    def markers(self):
        return [i for i in self.repo.table.scan()['Items'] if i['sk'].startswith('EXPORT#')]

    def seed(self):
        self.repo.put_profile(self.quiet, 'Quinn', 'Quiet', 'en')
        self.repo.set_phone(self.quiet, '+972501234567')
        self.repo.put_profile(self.member, 'Mia', 'Member', 'he')
        self.repo.add_consent(self.quiet, 'phoneList', 'on', '2026-10-27', self.k)
        status, g = self.call('POST', f'{self.base()}/uploads', sub='quiet-sub',
                              body={'channelId': self.channels['chat-all'], 'contentType': 'image/jpeg', 'bytes': 100})
        self.s3.put_object(Bucket=MEDIA_BUCKET, Key=media.upload_key(self.k, self.quiet, g['uploadId']), Body=JPEG,
                           ContentType='image/jpeg')
        _, photo = self.chat_post('chat-all', 'quiet-sub', 'my picture', imageUploadId=g['uploadId'])
        _, plain = self.chat_post('chat-all', 'quiet-sub', 'hello chat')
        theirs = self.repo.put_message(
            self.k, self.channels['chat-all'], 'celebration', 't', 'secret words of another', self.gabbai, 'Gabi Gabbai',
            'management', self.member, 'Mia Member')['sk'][4:]
        self.repo.put_reply(self.k, theirs, self.quiet, 'Quinn Quiet', 'my reply')
        self.repo.put_reply(self.k, theirs, self.member, 'Mia Member', 'their private reply')
        own = self.repo.put_message(self.k, self.channels['chat-all'], 'celebration', 'mazal', 'for you', self.quiet,
                                    'Quinn Quiet', 'member', self.other, 'Olly Other')
        self.own_blessing = own['sk'][4:]
        # partner and children
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.quiet}'},
                                    UpdateExpression='SET showPhone = :t', ExpressionAttributeValues={':t': True})
        self.call('POST', f'{self.base()}/family/children', sub='quiet-sub',
                  body={'firstName': 'Noa', 'gender': 'f', 'birthDate': '2018-05-01'})
        self.call('POST', f'{self.base()}/family/children', sub='quiet-sub', body={'firstName': 'Ben', 'gender': 'm'})
        return photo, plain

    def open_zip(self, key=None):
        body = self.s3.get_object(Bucket=MEDIA_BUCKET, Key=key or self.key)['Body'].read()
        return zipfile.ZipFile(io.BytesIO(body))

    def test_export_contents(self):
        photo, plain = self.seed()
        status, out = self.post()
        self.assertEqual(status, 200, out)
        self.assertAlmostEqual(out['expiresAt'], time.time() + 600, delta=10)
        archive = self.open_zip()
        data = json.loads(archive.read('data.json').decode('utf-8'))
        self.assertEqual(data['userId'], self.quiet)
        self.assertEqual(data['email'], 'a@example.test')
        self.assertEqual(data['profile'], {'firstName': 'Quinn', 'lastName': 'Quiet', 'lang': 'en',
                                           'phone': '+972501234567'})
        kehila = data['kehilot'][0]
        self.assertEqual((kehila['kehilaId'], kehila['name'], kehila['role'], kehila['showPhone']),
                         (self.k, 'Beit Test', 'member', True))
        self.assertEqual(sorted(c['firstName'] for c in kehila['family']['children']), ['Ben', 'Noa'])
        self.assertIsNone(kehila['family']['partnerName'])
        self.assertEqual([(c['kind'], c['kehilaId'], c['value']) for c in data['consents']], [('phoneList', self.k, 'on')])
        by_id = {m['messageId']: m for m in data['messages']}
        self.assertEqual(set(by_id), {photo['messageId'], plain['messageId'], self.own_blessing})
        name = f'photos/{self.k}/{photo["messageId"]}.jpg'
        self.assertEqual(by_id[photo['messageId']]['photo'], name)
        self.assertIsNone(by_id[plain['messageId']]['photo'])
        self.assertEqual(archive.read(name), JPEG)
        self.assertEqual([r['body'] for r in data['replies']], ['my reply'])
        self.assertEqual(data['photosOmitted'], 0)
        text = archive.read('data.json').decode('utf-8')
        self.assertNotIn('secret words of another', text)
        self.assertNotIn(self.member, text)
        self.assertNotIn('their private reply', text)
        self.assertNotIn('Mia', text)
        self.assertNotIn('Gabi', text)
        self.assertEqual(by_id[self.own_blessing]['targetName'], 'Olly Other')
        self.assertNotIn(self.other, text)

    def test_templated_message_exports_template_id_and_plain_fields(self):
        self.seed()
        fields = {'name': 'ערב לימוד', 'date': '2026-11-03', 'time': '20:30', 'place': 'בית הכנסת', 'for': 'all',
                  'cancelled': True}
        item = self.repo.put_message(self.k, self.channels['chat-all'], 'event', 'ערב', '', self.quiet, 'Quinn Quiet',
                                     'member', None, template_id='event', fields=fields)
        self.assertEqual(self.post()[0], 200)
        data = json.loads(self.open_zip().read('data.json').decode('utf-8'))
        entry = {m['messageId']: m for m in data['messages']}[item['sk'][4:]]
        self.assertEqual((entry['templateId'], entry['fields']), ('event', fields))
        plain = [m for m in data['messages'] if m['messageId'] != item['sk'][4:]]
        self.assertTrue(plain and all('templateId' not in m and 'fields' not in m for m in plain))

    def test_muted_member_is_a_count_only(self):
        self.repo.put_profile(self.quiet, 'Quinn', 'Quiet', 'en')
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.quiet}'},
                                    UpdateExpression='SET notify = :n',
                                    ExpressionAttributeValues={':n': {'mutedMembers': [self.member],
                                                                      'mutedTypes': ['weekly']}})
        self.post()
        text = self.open_zip().read('data.json').decode('utf-8')
        notify = json.loads(text)['kehilot'][0]['notify']
        self.assertEqual((notify['mutedMembersCount'], notify['mutedTypes']), (1, ['weekly']))
        self.assertNotIn('mutedMembers"', text)
        self.assertNotIn(self.member, text)
        self.assertNotIn('Mia', text)

    def test_photo_s3_error_is_503(self):
        self.seed()
        error = ClientError({'Error': {'Code': 'InternalError', 'Message': 'x'},
                             'ResponseMetadata': {'HTTPStatusCode': 500}}, 'GetObject')
        with mock.patch.object(media.s3_client(), 'get_object', side_effect=error):
            self.assertEqual(self.post(), (503, {'error': 'try_again'}))
        self.assertEqual((self.markers(), self.objects()), ([], []))

    def test_partner_appears_only_as_name(self):
        self.repo.put_profile(self.quiet, 'Quinn', 'Quiet', 'en')
        self.call('POST', f'{self.base()}/family/children', sub='quiet-sub', body={'firstName': 'Noa', 'gender': 'f'})
        family = self.repo.family_of(self.k, self.quiet)
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'F#{family["familyId"]}'},
                                    UpdateExpression='SET adults = :a', ExpressionAttributeValues={
                                        ':a': [self.quiet, self.member]})
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.member}'},
                                    UpdateExpression='SET familyId = :f',
                                    ExpressionAttributeValues={':f': family['familyId']})
        self.post()
        text = self.open_zip().read('data.json').decode('utf-8')
        data = json.loads(text)
        self.assertEqual(data['kehilot'][0]['family']['partnerName'], 'Mia Member')
        self.assertEqual(text.count('Mia Member'), 1)
        self.assertNotIn(self.member, text)

    def test_second_post_same_day_reissues_link(self):
        with mock.patch.object(export, 'build', wraps=export.build) as spy:
            first = self.post()
            second = self.post()
        self.assertEqual((first[0], second[0]), (200, 200))
        self.assertEqual(spy.call_count, 1)
        self.assertEqual(self.objects(), [self.key])
        self.assertEqual(len(self.markers()), 1)
        self.assertEqual(self.markers()[0]['sk'], f'EXPORT#{self.today}')
        self.assertTrue(second[1]['url'].startswith('https://'))

    def test_limit_when_zip_gone(self):
        self.assertEqual(self.post()[0], 200)
        self.s3.delete_object(Bucket=MEDIA_BUCKET, Key=self.key)
        self.assertEqual(self.post(), (429, {'error': 'export_limit'}))

    def test_failed_build_allows_retry(self):
        with mock.patch.object(export, 'build', side_effect=RuntimeError('boom')):
            self.assertEqual(self.post()[0], 500)
        self.assertEqual((self.markers(), self.objects()), ([], []))
        self.assertEqual(self.post()[0], 200)

    def test_temp_file_deleted(self):
        paths = []
        real = export.build

        def spy(*a, **k):
            paths.append(real(*a, **k))
            return paths[-1]
        with mock.patch.object(export, 'build', side_effect=spy):
            self.post()
        self.assertTrue(paths and not os.path.exists(paths[0]))

    def test_get_without_export_404(self):
        self.assertEqual(self.call('GET', '/v1/me/export', sub='quiet-sub'), (404, {'error': 'export_not_found'}))

    def test_get_after_export_200(self):
        self.post()
        status, out = self.call('GET', '/v1/me/export', sub='quiet-sub')
        self.assertEqual(status, 200, out)
        self.assertIn('url', out)

    def test_link_expires_in_600s_and_downloads_as_attachment(self):
        url = urlparse(self.post()[1]['url'])
        query = parse_qs(url.query)
        self.assertEqual(query['X-Amz-Expires'], ['600'])
        self.assertEqual(query['response-content-disposition'], [f'attachment; filename="kehilot-{self.today}.zip"'])
        self.assertEqual(query['response-content-type'], ['application/zip'])
        self.assertTrue(url.path.startswith(f'/x/{self.quiet}/'))

    def test_object_is_private_zip(self):
        self.post()
        head = self.s3.head_object(Bucket=MEDIA_BUCKET, Key=self.key)
        self.assertEqual((head['ContentType'], head['CacheControl']), ('application/zip', 'private, no-store'))

    def test_photos_omitted_near_deadline(self):
        photo, plain = self.seed()
        path = export.build(self.repo, self.quiet, 'a@example.test', remaining_ms=lambda: 1000)
        try:
            with zipfile.ZipFile(path) as archive:
                data = json.loads(archive.read('data.json').decode('utf-8'))
                self.assertEqual(data['photosOmitted'], 1)
                self.assertFalse([n for n in archive.namelist() if n.startswith('photos/')])
                self.assertIsNone(next(m for m in data['messages'] if m['messageId'] == photo['messageId'])['photo'])
        finally:
                os.remove(path)


@own_tests_only
@mock_aws
class ExportRepliesTest(test_private_replies.ReplyFlowTest):
    """The export of private replies: what the person wrote, and what reached them. Invented names."""

    def setUp(self):
        super().setUp()
        self.s3 = start_media(self)

    def export(self, sub):
        status, out = self.call('POST', '/v1/me/export', sub=sub)
        self.assertEqual(status, 200, out)
        key = media.export_key(self.ids[sub], local_date())
        body = self.s3.get_object(Bucket=MEDIA_BUCKET, Key=key)['Body'].read()
        archive = zipfile.ZipFile(io.BytesIO(body))
        return json.loads(archive.read('data.json').decode('utf-8')), archive.read('data.json').decode('utf-8')

    def test_export_own_replies_have_title_and_to(self):
        general, family, personal = self.general(), self.blessing(), self.blessing()
        self.sent('rotem-sub', general, 'אחד')
        self.sent('rotem-sub', family, 'שניים')
        self.sent('rotem-sub', personal, 'שלושה', to=self.shul)
        data, _ = self.export('rotem-sub')
        title = self.card('rotem-sub', general)['title']
        got = {r['messageId']: r for r in data['replies']}
        self.assertEqual({m: (r['to'], r['title']) for m, r in got.items()},
                         {general: ('author', title), family: ('family', self.card('rotem-sub', family)['title']),
                          personal: ('שולמית ברקן', self.card('rotem-sub', personal)['title'])})
        self.assertNotIn(self.shul, json.dumps(data, ensure_ascii=False))

    def test_export_reply_to_gone_adult_has_empty_to_and_gone_message_empty_title(self):
        mid = self.blessing()
        self.sent('rotem-sub', mid, 'סוד', to=self.shul)
        self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.shul}'})
        self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': f'MSG#{mid}'})
        data, _ = self.export('rotem-sub')
        self.assertEqual([(r['to'], r['title']) for r in data['replies']], [('', '')])

    def test_export_replies_received_for_both_adults(self):
        mid = self.blessing()
        self.sent('rotem-sub', mid, 'מזל טוב')
        for sub in ('shul-sub', 'yigal-sub'):
            data, _ = self.export(sub)
            (got,) = data['repliesReceived']
            self.assertEqual((got['kehilaId'], got['messageId'], got['authorName'], got['body'], got['personal']),
                             (self.k, mid, 'רותם אלמוג', 'מזל טוב', False), sub)
            self.assertEqual(got['title'], self.card(sub, mid)['title'])
            self.assertIn('createdAt', got)
        self.assertEqual(self.export('rotem-sub')[0]['repliesReceived'], [])

    def test_export_personal_reply_only_in_chosen_adults_export(self):
        mid = self.blessing()
        self.sent('rotem-sub', mid, 'סוד-גדול', to=self.shul)
        data, _ = self.export('shul-sub')
        self.assertEqual([(r['body'], r['personal']) for r in data['repliesReceived']], [('סוד-גדול', True)])
        for sub in ('yigal-sub', 'gabbai-sub', 'tech-sub', 'ron-sub'):
            data, text = self.export(sub)
            self.assertEqual(data['repliesReceived'], [], sub)
            self.assertNotIn('סוד-גדול', text, sub)

    def test_export_received_author_replies(self):
        mid = self.general()
        self.sent('rotem-sub', mid, 'שלום לך')
        data, _ = self.export('member-sub')
        self.assertEqual([(r['body'], r['authorName'], r['personal']) for r in data['repliesReceived']],
                         [('שלום לך', 'רותם אלמוג', False)])
        self.assertEqual(self.export('gabbai-sub')[0]['repliesReceived'], [])
