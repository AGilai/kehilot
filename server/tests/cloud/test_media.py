import json
import logging
import os
import time
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlparse

import boto3
from botocore.exceptions import ClientError
from moto import mock_aws

from server.cloud import ids, media, push, routes_changes
from server.tests.cloud import test_conversation, test_delete_account
from server.tests.cloud.helpers import MEDIA_BUCKET, make_bucket
from server.tests.cloud.test_groups import own_tests_only

JPEG = b'\xff\xd8\xff\xe0' + b'0' * 100
PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 100


def client_error(status, code='AccessDenied'):
    return ClientError({'Error': {'Code': code, 'Message': 'x'}, 'ResponseMetadata': {'HTTPStatusCode': status}},
                       'HeadObject')


def start_media(test):
    patcher = mock.patch.dict(os.environ, {})
    patcher.start()
    test.addCleanup(patcher.stop)
    media.s3_client.cache_clear()
    test.addCleanup(media.s3_client.cache_clear)
    return make_bucket()


@own_tests_only
@mock_aws
class MediaTest(test_conversation.ConversationTest):
    """Reuses the conversation fixtures but none of its tests."""

    def setUp(self):
        super().setUp()
        self.s3 = start_media(self)

    def grant(self, channel='chat-all', sub='quiet-sub', content_type='image/jpeg', size=100):
        return self.call('POST', f'{self.base()}/uploads', sub=sub,
                         body={'channelId': self.channels[channel], 'contentType': content_type, 'bytes': size})

    def put_upload(self, user_id, upload_id, data=JPEG, content_type='image/jpeg'):
        self.s3.put_object(Bucket=MEDIA_BUCKET, Key=media.upload_key(self.k, user_id, upload_id), Body=data,
                           ContentType=content_type)

    def keys(self, prefix=''):
        out = self.s3.list_objects_v2(Bucket=MEDIA_BUCKET, Prefix=prefix)
        return [o['Key'] for o in out.get('Contents', [])]

    def chat_with_image(self, sub='quiet-sub', user=None, data=JPEG, content_type='image/jpeg', channel='chat-all',
                        body='shalom', granted_type='image/jpeg'):
        """Grant, then put `data` straight into moto (so it may differ from what was granted), then post."""
        user = user or self.quiet
        status, g = self.grant(channel, sub, granted_type, 100)
        self.assertEqual(status, 201, g)
        self.put_upload(user, g['uploadId'], data, content_type)
        return self.chat_post(channel, sub, body, imageUploadId=g['uploadId'])

    def test_upload_grant_only_for_posters(self):
        self.assertEqual(self.grant(sub='listener-sub'), (404, {'error': 'channel_not_found'}))
        self.assertEqual(self.grant('announcements', 'quiet-sub'), (403, {'error': 'forbidden'}))
        status, body = self.grant('chat-all', 'quiet-sub')
        self.assertEqual(status, 201, body)
        self.assertEqual((body['method'], body['headers']), ('PUT', {'Content-Type': 'image/jpeg'}))
        self.assertTrue(ids.ID_RE.fullmatch(body['uploadId']))
        self.assertAlmostEqual(body['expiresAt'], time.time() + 300, delta=10)
        self.assertEqual(self.grant('simchas', 'member-sub')[0], 201)

    def test_upload_grant_signs_type_and_length_and_is_regional(self):
        url = urlparse(self.grant()[1]['url'])
        query = parse_qs(url.query)
        self.assertEqual(url.hostname, 'kehilot-test-media.s3.il-central-1.amazonaws.com')
        self.assertEqual(query['X-Amz-SignedHeaders'], ['content-length;content-type;host'])
        self.assertEqual(query['X-Amz-Expires'], ['300'])
        self.assertTrue(url.path.startswith(f'/up/{self.k}/{self.quiet}/'))

    def test_upload_limits(self):
        for size in (0, 1048577, '5', True, None):
            self.assertEqual(self.grant(size=size), (400, {'error': 'invalid_bytes'}), size)
        self.assertEqual(self.grant(size=1048576)[0], 201)
        self.assertEqual(self.grant(content_type='image/gif'), (400, {'error': 'invalid_content_type'}))
        self.assertEqual(self.call('POST', f'{self.base()}/uploads', sub='quiet-sub',
                                   body={'channelId': 'nope', 'contentType': 'image/png', 'bytes': 5}),
                         (400, {'error': 'invalid_channel_id'}))

    def test_upload_rate_limit_21st_is_429(self):
        for _ in range(20):
            self.assertEqual(self.grant()[0], 201)
        self.assertEqual(self.grant(), (429, {'error': 'rate_limited'}))
        self.assertEqual(self.grant(sub='member-sub')[0], 201)  # per user

    def test_attach_moves_upload_and_returns_image(self):
        status, body = self.chat_with_image()
        self.assertEqual(status, 201, body)
        self.assertEqual(body['image'], {'contentType': 'image/jpeg', 'bytes': len(JPEG)})
        self.assertEqual(self.keys(), [f'm/{self.k}/{body["messageId"]}'])
        head = self.s3.head_object(Bucket=MEDIA_BUCKET, Key=f'm/{self.k}/{body["messageId"]}')
        self.assertEqual((head['ContentType'], head['CacheControl']), ('image/jpeg', 'private, max-age=300'))
        got = self.call('GET', f'{self.base()}/messages/{body["messageId"]}')[1]
        self.assertEqual(got['image'], body['image'])
        listed = self.call('GET', f'{self.base()}/messages')[1]
        self.assertEqual(listed[0]['image'], body['image'])

    def test_attach_to_announcement_and_invalid_upload_id(self):
        status, g = self.grant('simchas', 'member-sub', 'image/png')
        self.put_upload(self.member, g['uploadId'], PNG, 'image/png')
        status, body = self.post('simchas', 'member-sub', imageUploadId=g['uploadId'])
        self.assertEqual((status, body['image']), (201, {'contentType': 'image/png', 'bytes': len(PNG)}))
        for bad in ('x', 5, ''):
            self.assertEqual(self.post('announcements', imageUploadId=bad), (400, {'error': 'invalid_image_upload_id'}))

    def test_attach_someone_elses_upload_is_image_not_found(self):
        g = self.grant()[1]
        self.put_upload(self.quiet, g['uploadId'])
        status, body = self.chat_post(sub='member-sub', imageUploadId=g['uploadId'])
        self.assertEqual((status, body), (400, {'error': 'image_not_found'}))
        self.assertEqual(self.keys(), [media.upload_key(self.k, self.quiet, g['uploadId'])])

    def test_attach_never_uploaded_is_image_not_found(self):
        self.assertEqual(self.chat_post(imageUploadId=ids.new_id()), (400, {'error': 'image_not_found'}))

    def test_attach_wrong_magic_is_invalid_image_and_deleted(self):
        status, body = self.chat_with_image(data=PNG, content_type='image/jpeg')
        self.assertEqual((status, body), (400, {'error': 'invalid_image'}))
        self.assertEqual(self.keys(), [])
        self.assertEqual(self.call('GET', f'{self.base()}/messages')[1], [])

    def test_attach_oversize_is_invalid_image(self):
        status, body = self.chat_with_image(data=JPEG + b'0' * 1048576)
        self.assertEqual((status, body), (400, {'error': 'invalid_image'}))
        self.assertEqual(self.keys(), [])

    def test_attach_unlisted_type_is_invalid_image(self):
        status, body = self.chat_with_image(data=b'GIF89a' + b'0' * 20, content_type='image/gif')
        self.assertEqual((status, body), (400, {'error': 'invalid_image'}))

    def test_head_403_maps_to_image_not_found(self):
        stub = mock.Mock()
        stub.head_object.side_effect = client_error(403)
        with mock.patch.object(media, 's3_client', return_value=stub):
            self.assertEqual(self.chat_post(imageUploadId=ids.new_id()), (400, {'error': 'image_not_found'}))

    def test_s3_failure_on_attach_is_try_again(self):
        stub = mock.Mock()
        stub.head_object.side_effect = client_error(500, 'InternalError')
        with mock.patch.object(media, 's3_client', return_value=stub):
            self.assertEqual(self.chat_post(imageUploadId=ids.new_id()), (503, {'error': 'try_again'}))

    def test_failed_validation_does_not_claim_the_upload(self):
        g = self.grant()[1]
        self.put_upload(self.quiet, g['uploadId'])
        self.assertEqual(self.chat_post(body='', imageUploadId=g['uploadId'])[0], 201)  # empty body is fine with image
        g2 = self.grant()[1]
        self.put_upload(self.quiet, g2['uploadId'])
        status, _ = self.call('POST', f'{self.base()}/messages', sub='quiet-sub',
                              body={'channelId': self.channels['chat-all'], 'body': 'x' * 1001,
                                    'imageUploadId': g2['uploadId']})
        self.assertEqual(status, 400)
        self.assertIn(media.upload_key(self.k, self.quiet, g2['uploadId']), self.keys())

    def test_image_url_only_after_visibility_check(self):
        status, msg = self.chat_with_image(sub='member-sub', user=self.member, channel='chat-women')
        self.assertEqual(status, 201, msg)
        path = f'{self.base()}/messages/{msg["messageId"]}/image'
        self.assertEqual(self.call('GET', path, sub='other-sub'), (404, {'error': 'message_not_found'}))
        status, body = self.call('GET', path, sub='quiet-sub')
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {'url', 'expiresAt'})
        query = parse_qs(urlparse(body['url']).query)
        self.assertEqual(query['X-Amz-Expires'], ['300'])
        self.assertEqual(query['response-content-type'], ['image/jpeg'])
        self.assertEqual(query['response-content-disposition'], [f'inline; filename="{msg["messageId"]}.jpg"'])
        self.assertEqual(urlparse(body['url']).path, f'/m/{self.k}/{msg["messageId"]}')

    def test_image_url_404_not_found_without_image(self):
        mid = self.chat_post()[1]['messageId']
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{mid}/image'), (404, {'error': 'not_found'}))
        self.assertEqual(self.call('GET', f'{self.base()}/messages/{ids.new_id()}/image'),
                         (404, {'error': 'message_not_found'}))

    def test_remove_message_deletes_image_first(self):
        mid = self.chat_with_image()[1]['messageId']
        order = []
        real = media.delete_image
        with mock.patch.object(media, 'delete_image', side_effect=lambda *a: (order.append('s3'), real(*a))), \
                mock.patch.object(self.repo, 'remove_message',
                                  side_effect=lambda *a: order.append('db')) as removed:
            self.assertEqual(self.call('DELETE', f'{self.base()}/messages/{mid}', sub='quiet-sub'), (204, None))
        self.assertEqual(order, ['s3', 'db'])
        removed.assert_called_once()
        self.assertEqual(self.keys(), [])

    def test_remove_keeps_message_when_s3_delete_fails(self):
        mid = self.chat_with_image()[1]['messageId']
        stub = mock.Mock()
        stub.delete_object.side_effect = client_error(500, 'InternalError')
        with mock.patch.object(media, 's3_client', return_value=stub):
            self.assertEqual(self.call('DELETE', f'{self.base()}/messages/{mid}', sub='quiet-sub'),
                             (503, {'error': 'try_again'}))
        self.assertFalse(self.repo.get_message(self.k, mid)['removed'])
        self.assertEqual(self.call('DELETE', f'{self.base()}/messages/{mid}', sub='quiet-sub'), (204, None))
        self.assertEqual(self.keys(), [])

    def test_remove_message_without_image_never_touches_s3(self):
        mid = self.chat_post()[1]['messageId']
        with mock.patch.object(media, 's3_client', side_effect=AssertionError('no s3')):
            self.assertEqual(self.call('DELETE', f'{self.base()}/messages/{mid}', sub='quiet-sub'), (204, None))

    def test_chat_with_image_may_have_empty_body(self):
        status, body = self.chat_with_image(body='')
        self.assertEqual((status, body['body']), (201, ''))
        self.assertEqual(self.chat_post(body=''), (400, {'error': 'invalid_body'}))

    def test_feed_message_carries_image_meta_not_url(self):
        offset = {'v': 0}
        with mock.patch.object(routes_changes, '_now_ms', side_effect=lambda: int((time.time() + offset['v']) * 1000)):
            start = self.call('GET', f'{self.base()}/changes', sub='member-sub')[1]['cursor']
            status, msg = self.chat_with_image()
            offset['v'] = 10
            status, feed = self.call('GET', f'{self.base()}/changes', sub='member-sub', query={'since': start})
        self.assertEqual(status, 200)
        self.assertEqual(feed['changes'][0]['item']['image'], msg['image'])
        text = json.dumps(feed) + json.dumps(self.call('GET', f'{self.base()}/messages')[1])
        self.assertNotIn('X-Amz-', text)
        self.assertNotIn(f'm/{self.k}', text)

    def test_no_presigned_url_or_key_in_logs(self):
        with self.assertLogs('server', level='DEBUG') as logs:
            logging.getLogger('server.cloud').warning('start')
            stub = mock.Mock()
            stub.head_object.side_effect = client_error(500, 'InternalError')
            with mock.patch.object(media, 's3_client', return_value=stub):
                self.chat_post(imageUploadId=ids.new_id())
            self.grant()
        text = '\n'.join(logs.output)
        self.assertNotIn('X-Amz-', text)
        self.assertNotIn(f'up/{self.k}', text)


@own_tests_only
@mock_aws
class MediaAccountDeletionTest(test_delete_account.DeleteAccountTest):
    def setUp(self):
        super().setUp()
        self.s3 = start_media(self)

    def test_account_deletion_keeps_message_image(self):
        chan = self.repo.list_channels(self.k1)[0]['sk'][2:]
        item = self.repo.put_message(self.k1, chan, 'weekly', 't', 'b', self.dana, 'Dana T', 'member', None,
                                     message_id=ids.new_id(), image={'contentType': 'image/png', 'bytes': 7})
        mid = item['sk'][4:]
        key = media.image_key(self.k1, mid)
        self.s3.put_object(Bucket=MEDIA_BUCKET, Key=key, Body=PNG, ContentType='image/png')
        self.assertEqual(self.call('DELETE', '/v1/me', 'sub-dana'), (204, None))
        message = self.repo.get_message(self.k1, mid)
        self.assertEqual(message['authorName'], '')
        self.assertEqual(message['image'], {'contentType': 'image/png', 'bytes': 7})
        self.assertEqual(self.s3.head_object(Bucket=MEDIA_BUCKET, Key=key)['ContentLength'], len(PNG))
        status, body = self.call('GET', f'/v1/kehilot/{self.k1}/messages/{mid}/image', 'sub-gab')
        self.assertEqual(status, 200, body)


if __name__ == '__main__':
    unittest.main()
