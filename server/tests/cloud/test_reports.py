import json
import os
import time
import unittest
import zipfile
from unittest import mock
from urllib.parse import urlparse

import boto3
from moto import mock_aws

from server.cloud import handler as handler_module
from server.cloud import media, routes_reports
from server.cloud.repo import Repo
from server.tests.cloud.helpers import MEDIA_BUCKET, make_table
from server.tests.cloud.test_handler import Context, event
from server.tests.cloud.test_media import JPEG, PNG, client_error, start_media

CONTEXT = {'appVersion': '1.2.0', 'build': '45', 'platform': 'ios', 'os': '17.4', 'screen': 'Inbox', 'lang': 'he'}
TEXT = 'הכפתור לא עובד 🙁 <b>bold</b> ‏'


def anon_event(body, ip='203.0.113.7', auth=False):
    evt = event('POST', '/v1/reports/anonymous', body=json.dumps(body, ensure_ascii=False) if body is not None else None)
    evt['requestContext']['http']['sourceIp'] = ip
    if not auth:
        del evt['requestContext']['authorizer']
    else:
        evt['headers'] = {'authorization': 'Bearer whatever'}
    return evt


@mock_aws
class ReportsTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ, {'REPORT_IP_SALT': 'pepper-1', 'USER_POOL_ID': 'x'})
        env.start()
        self.addCleanup(env.stop)
        self.s3 = start_media(self)
        self.user = self.uid('dana-sub')

    def call(self, method, path, sub='dana-sub', body=None):
        response = handler_module.handler(event(method, path, sub=sub, body=json.dumps(body, ensure_ascii=False) if body is not None else None),
                                          Context())
        return response['statusCode'], json.loads(response['body']) if response['body'] else None

    def anon(self, body, **kw):
        response = handler_module.handler(anon_event(body, **kw), Context())
        return response['statusCode'], json.loads(response['body'])

    def uid(self, sub):
        return self.call('GET', '/v1/me', sub)[1]['userId']

    def report(self, sub='dana-sub', **extra):
        return self.call('POST', '/v1/reports', sub, {'text': TEXT, 'context': CONTEXT, **extra})

    def reports(self):
        return self.repo.list_reports()

    def grant(self, sub='dana-sub', size=100, content_type='image/jpeg'):
        status, out = self.call('POST', '/v1/reports/upload', sub, {'contentType': content_type, 'bytes': size})
        self.assertEqual(status, 201, out)
        return out

    def put_upload(self, user, upload_id, data=JPEG, content_type='image/jpeg'):
        self.s3.put_object(Bucket=MEDIA_BUCKET, Key=media.report_upload_key(user, upload_id), Body=data,
                           ContentType=content_type)

    # validation
    def test_signed_in_report_stored_intact(self):
        status, out = self.report()
        self.assertEqual(status, 201)
        item = self.repo.get_report(out['reportId'])
        self.assertEqual((item['text'], item['context'], item['status'], item['userId']),
                         (TEXT.strip(), CONTEXT, 'new', self.user))
        self.assertEqual(item['expiresAt'] - item['createdAt'], 180 * 86400)
        self.assertNotIn('image', item)
        self.assertEqual(self.report(context={**CONTEXT, 'kehilaId': 'K1'})[0], 201)

    def test_text_bounds(self):
        for text in ('', '   ', 5, None, 'x' * 2001):
            self.assertEqual(self.call('POST', '/v1/reports', body={'text': text, 'context': CONTEXT}),
                             (400, {'error': 'invalid_text'}), repr(text))
        self.assertEqual(self.call('POST', '/v1/reports', body={'context': CONTEXT})[1], {'error': 'invalid_text'})
        self.assertEqual(self.report(text='x' * 2000)[0], 201)
        self.assertEqual(self.report(text='😀' * 2000)[0], 201)  # code points, not UTF-16 units or bytes
        self.assertEqual(self.report(text='😀' * 2001)[0], 400)
        self.assertEqual(self.reports()[0]['text'].strip(), 'x' * 2000)

    def test_context_shape(self):
        bad = [None, 'x', [], {}, {k: v for k, v in CONTEXT.items() if k != 'lang'}, {**CONTEXT, 'extra': 'x'},
               {**CONTEXT, 'build': 45}, {**CONTEXT, 'os': 'x' * 65}, {**CONTEXT, 'screen': None},
               {**CONTEXT, 'kehilaId': 5}]
        for context in bad:
            self.assertEqual(self.call('POST', '/v1/reports', body={'text': 'hi', 'context': context}),
                             (400, {'error': 'invalid_context'}), repr(context))
        self.assertEqual(self.call('POST', '/v1/reports', body={'text': 'hi'})[1], {'error': 'invalid_context'})
        self.assertEqual(self.report(context={**CONTEXT, 'os': 'x' * 64})[0], 201)
        self.assertEqual(self.reports()[0]['context']['os'], 'x' * 64)

    def test_context_empty_required_rejected_kehila_optional(self):
        for key in routes_reports.CONTEXT_KEYS:
            self.assertEqual(self.call('POST', '/v1/reports', body={'text': 'hi', 'context': {**CONTEXT, key: ''}})[1],
                             {'error': 'invalid_context'}, key)
        self.assertEqual(self.report(context={**CONTEXT, 'kehilaId': None})[1], {'error': 'invalid_context'})
        self.assertEqual(self.report(context={**CONTEXT, 'kehilaId': ''})[1], {'error': 'invalid_context'})

    def test_ip_key_ipv4_full_ipv6_prefix64(self):
        h = lambda ip: routes_reports._ip_hash(mock.Mock(source_ip=ip))
        self.assertNotEqual(h('203.0.113.7'), h('203.0.113.8'))
        self.assertEqual(h('2001:db8:1:2::1'), h('2001:db8:1:2:ffff:eeee:dddd:cccc'))
        self.assertNotEqual(h('2001:db8:1:2::1'), h('2001:db8:1:3::1'))
        self.assertEqual(h(None), h('garbage'))
        for n in range(3):
            self.assertEqual(self.anon({'text': 'hi', 'context': CONTEXT}, ip=f'2001:db8:1:2::{n + 1}')[0], 201)
        self.assertEqual(self.anon({'text': 'hi', 'context': CONTEXT}, ip='2001:db8:1:2:9::1')[0], 429)

    def test_bad_upload_costs_no_quota_and_over_limit_leaves_no_picture(self):
        for _ in range(15):
            self.report(imageUploadId='Z' * 26)
        for _ in range(10):
            self.assertEqual(self.report()[0], 201)
        grant = self.grant()
        self.put_upload(self.user, grant['uploadId'])
        self.assertEqual(self.report(imageUploadId=grant['uploadId']), (429, {'error': 'rate_limited'}))
        self.assertEqual(self.s3.list_objects_v2(Bucket=MEDIA_BUCKET).get('KeyCount', 0), 0)

    def test_bad_bodies(self):
        self.assertEqual(self.call('POST', '/v1/reports')[1], {'error': 'invalid_body'})
        self.assertEqual(self.call('POST', '/v1/reports', body=[1])[1], {'error': 'invalid_body'})
        self.assertEqual(self.call('POST', '/v1/reports', body={'text': 'x' * 20000, 'context': CONTEXT})[0], 400)
        self.assertEqual(self.reports(), [])

    # limits
    def test_user_limit_10_per_day_and_per_user(self):
        for _ in range(10):
            self.assertEqual(self.report()[0], 201)
        self.assertEqual(self.report(), (429, {'error': 'rate_limited'}))
        self.assertEqual(self.report(sub='other-sub')[0], 201)
        self.assertEqual(len(self.reports()), 11)

    def test_invalid_does_not_use_quota(self):
        for _ in range(12):
            self.call('POST', '/v1/reports', body={'text': '', 'context': CONTEXT})
        self.assertEqual(self.report()[0], 201)

    def test_anonymous_ip_limit_hashed(self):
        for _ in range(3):
            self.assertEqual(self.anon({'text': 'hi', 'context': CONTEXT})[0], 201)
        self.assertEqual(self.anon({'text': 'hi', 'context': CONTEXT}), (429, {'error': 'rate_limited'}))
        self.assertEqual(self.anon({'text': 'hi', 'context': CONTEXT}, ip='203.0.113.8')[0], 201)
        everything = json.dumps(self.repo.table.scan()['Items'], default=str)
        self.assertNotIn('203.0.113', everything)
        counters = [i for i in self.repo.table.scan()['Items'] if i['sk'].startswith('IP#')]
        self.assertEqual(len(counters), 2)
        self.assertTrue(all(len(i['sk'].split('#')[1]) == 64 for i in counters))
        self.assertTrue(all(0 < float(i['expiresAt']) - time.time() <= 86400 + 5 for i in counters))

    def test_ip_hash_depends_on_salt(self):
        ctx = mock.Mock(source_ip='203.0.113.7')
        first = routes_reports._ip_hash(ctx)
        with mock.patch.dict(os.environ, {'REPORT_IP_SALT': 'pepper-2'}):
            self.assertNotEqual(routes_reports._ip_hash(ctx), first)
        with mock.patch.dict(os.environ):
            del os.environ['REPORT_IP_SALT']
            with self.assertRaises(RuntimeError):
                routes_reports._ip_hash(ctx)

    def test_anonymous_global_daily_limit(self):
        for n in range(50):
            self.assertEqual(self.anon({'text': 'hi', 'context': CONTEXT}, ip=f'198.51.100.{n}')[0], 201)
        self.assertEqual(self.anon({'text': 'hi', 'context': CONTEXT}, ip='198.51.100.200'),
                         (429, {'error': 'rate_limited'}))
        self.assertEqual(self.report()[0], 201)  # signed-in reports are separate

    def test_anonymous_ignores_token_and_stores_no_user(self):
        response = handler_module.handler(anon_event({'text': 'hi', 'context': CONTEXT}, auth=True), Context())
        self.assertEqual(response['statusCode'], 201)
        item = self.repo.get_report(json.loads(response['body'])['reportId'])
        self.assertNotIn('userId', item)
        self.assertNotIn('image', item)
        # no user counter, no account created
        self.assertEqual([i for i in self.repo.table.scan()['Items'] if i['sk'].startswith('USR#')], [])

    def test_anonymous_validation_and_no_image(self):
        self.assertEqual(self.anon({'text': '', 'context': CONTEXT}), (400, {'error': 'invalid_text'}))
        self.assertEqual(self.anon({'text': 'hi', 'context': {}}), (400, {'error': 'invalid_context'}))
        self.assertEqual(self.anon(None), (400, {'error': 'invalid_body'}))
        status, out = self.anon({'text': 'hi', 'context': CONTEXT, 'imageUploadId': 'x' * 26})
        self.assertEqual(status, 201)
        self.assertNotIn('image', self.repo.get_report(out['reportId']))

    def test_anonymous_routes_other_methods(self):
        evt = anon_event(None)
        evt['requestContext']['http']['method'] = 'GET'
        self.assertEqual(handler_module.handler(evt, Context())['statusCode'], 405)

    def test_signed_in_endpoint_needs_caller_but_anonymous_does_not(self):
        self.assertIn(routes_reports.create_anonymous, handler_module.PUBLIC)
        self.assertNotIn(routes_reports.create, handler_module.PUBLIC)
        self.assertNotIn(routes_reports.create_upload, handler_module.PUBLIC)

    # images
    def test_upload_grant_and_report_with_image(self):
        grant = self.grant()
        self.assertEqual(grant['method'], 'PUT')
        self.assertEqual(grant['headers'], {'Content-Type': 'image/jpeg'})
        self.assertIn('/up/reports/' + self.user + '/' + grant['uploadId'], urlparse(grant['url']).path)
        self.put_upload(self.user, grant['uploadId'])
        status, out = self.report(imageUploadId=grant['uploadId'])
        self.assertEqual(status, 201, out)
        item = self.repo.get_report(out['reportId'])
        self.assertEqual(item['image'], {'key': f"reports/{out['reportId']}.jpg", 'contentType': 'image/jpeg', 'bytes': 104})
        self.assertEqual(self.s3.get_object(Bucket=MEDIA_BUCKET, Key=item['image']['key'])['Body'].read(), JPEG)
        keys = [o['Key'] for o in self.s3.list_objects_v2(Bucket=MEDIA_BUCKET).get('Contents', [])]
        self.assertEqual(keys, [item['image']['key']])  # the upload copy is gone

    def test_png_extension(self):
        grant = self.grant(content_type='image/png')
        self.put_upload(self.user, grant['uploadId'], PNG, 'image/png')
        _, out = self.report(imageUploadId=grant['uploadId'])
        self.assertEqual(self.repo.get_report(out['reportId'])['image']['key'], f"reports/{out['reportId']}.png")

    def test_grant_validation(self):
        for body in ({'contentType': 'image/gif', 'bytes': 10}, {'bytes': 10}, {'contentType': 'image/png'}):
            self.assertEqual(self.call('POST', '/v1/reports/upload', body=body)[0], 400)
        self.assertEqual(self.call('POST', '/v1/reports/upload', body={'contentType': 'image/png', 'bytes': 0})[1],
                         {'error': 'invalid_bytes'})
        self.assertEqual(self.call('POST', '/v1/reports/upload',
                                   body={'contentType': 'image/png', 'bytes': 1048577})[1], {'error': 'invalid_bytes'})

    def test_grant_hourly_limit(self):
        for _ in range(10):
            self.grant()
        self.assertEqual(self.call('POST', '/v1/reports/upload', body={'contentType': 'image/png', 'bytes': 5}),
                         (429, {'error': 'rate_limited'}))
        self.grant(sub='other-sub')

    def test_other_users_upload_rejected(self):
        grant = self.grant(sub='other-sub')
        other = self.uid('other-sub')
        self.put_upload(other, grant['uploadId'])
        self.assertEqual(self.report(imageUploadId=grant['uploadId']), (400, {'error': 'invalid_upload'}))
        self.assertEqual(self.report(sub='other-sub', imageUploadId=grant['uploadId'])[0], 201)

    def test_invalid_uploads(self):
        for upload_id in ('nope', 5, None, 'Z' * 26):  # bad shape, or a well-formed id that was never uploaded
            self.assertEqual(self.report(imageUploadId=upload_id), (400, {'error': 'invalid_upload'}), repr(upload_id))
        grant = self.grant()
        self.put_upload(self.user, grant['uploadId'], b'GIF89a' + b'0' * 50)  # wrong magic bytes
        self.assertEqual(self.report(imageUploadId=grant['uploadId']), (400, {'error': 'invalid_upload'}))
        self.assertEqual(self.reports(), [])

    def test_s3_failure_is_503(self):
        grant = self.grant()
        self.put_upload(self.user, grant['uploadId'])
        with mock.patch('server.cloud.media.s3_client') as client:
            client.return_value.head_object.side_effect = client_error(500, 'InternalError')
            self.assertEqual(self.report(imageUploadId=grant['uploadId']), (503, {'error': 'try_again'}))
        self.assertEqual(self.reports(), [])

    # no reading
    def test_no_read_routes(self):
        _, out = self.report()
        for method, path in (('GET', '/v1/reports'), ('GET', f"/v1/reports/{out['reportId']}"),
                             ('GET', '/v1/me/reports'), ('DELETE', f"/v1/reports/{out['reportId']}"),
                             ('GET', '/v1/reports/anonymous'), ('GET', '/v1/reports/upload')):
            status, body = self.call(method, path)
            self.assertIn(status, (404, 405), path)
        self.assertNotIn('text', json.dumps(self.call('GET', '/v1/me')[1]))

    def test_repo_mark_and_list(self):
        _, a = self.report()
        _, b = self.report()
        self.repo.mark_report(a['reportId'], 'triaged', 'bug', 'note')
        item = self.repo.get_report(a['reportId'])
        self.assertEqual((item['status'], item['kind'], item['triage']), ('triaged', 'bug', 'note'))
        self.assertEqual([r['sk'][4:] for r in self.repo.list_reports('new')], [b['reportId']])
        self.assertEqual(len(self.repo.list_reports()), 2)
        with self.assertRaises(ValueError):
            self.repo.mark_report(a['reportId'], 'weird')
        with self.assertRaises(Exception):
            self.repo.mark_report('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'fixed')

    # account deletion and export
    def test_export_includes_own_reports_only_without_triage(self):
        _, mine = self.report()
        self.report(sub='other-sub')
        self.anon({'text': 'anon', 'context': CONTEXT})
        self.repo.mark_report(mine['reportId'], 'triaged', 'bug', 'INTERNAL NOTE')
        from server.cloud import export
        path = export.build(self.repo, self.user, 'd@example.test')
        self.addCleanup(os.remove, path)
        data = json.loads(zipfile.ZipFile(path).read('data.json').decode('utf-8'))
        self.assertEqual(data['reports'], [{'reportId': mine['reportId'], 'text': TEXT.strip(), 'context': CONTEXT,
                                            'status': 'triaged', 'createdAt': int(self.repo.get_report(mine['reportId'])['createdAt'])}])
        self.assertNotIn('INTERNAL NOTE', json.dumps(data))

    def test_account_deletion_removes_reports_and_images(self):
        cognito = boto3.client('cognito-idp', region_name='il-central-1')
        pool = cognito.create_user_pool(PoolName='p')['UserPool']['Id']
        for sub in ('dana-sub', 'other-sub'):
            cognito.admin_create_user(UserPoolId=pool, Username=sub)
        os.environ['USER_POOL_ID'] = pool
        other_user = self.uid('other-sub')
        keys = {}
        for sub, user in (('dana-sub', self.user), ('other-sub', other_user)):
            grant = self.grant(sub=sub)
            self.put_upload(user, grant['uploadId'])
            keys[sub] = self.report(sub=sub, imageUploadId=grant['uploadId'])[1]['reportId']
            self.report(sub=sub)
        self.assertEqual(len(self.reports()), 4)
        self.assertEqual(self.call('DELETE', '/v1/me', 'dana-sub'), (204, None))
        left = self.reports()
        self.assertEqual(len(left), 2)
        self.assertTrue(all(r['userId'] == other_user for r in left))
        s3_keys = [o['Key'] for o in self.s3.list_objects_v2(Bucket=MEDIA_BUCKET).get('Contents', [])]
        self.assertEqual(s3_keys, [f"reports/{keys['other-sub']}.jpg"])
        for item in self.repo.table.scan()['Items']:
            if item['pk'] != 'U#dana-sub':
                self.assertNotIn(self.user, json.dumps(item, default=str))

    def test_account_deletion_s3_failure_keeps_items_for_retry(self):
        cognito = boto3.client('cognito-idp', region_name='il-central-1')
        pool = cognito.create_user_pool(PoolName='p')['UserPool']['Id']
        cognito.admin_create_user(UserPoolId=pool, Username='dana-sub')
        os.environ['USER_POOL_ID'] = pool
        grant = self.grant()
        self.put_upload(self.user, grant['uploadId'])
        self.report(imageUploadId=grant['uploadId'])
        with mock.patch.object(media, 'delete_key', side_effect=media.ApiError(503, 'try_again')):
            self.assertEqual(self.call('DELETE', '/v1/me', 'dana-sub')[0], 503)
        self.assertEqual(len(self.reports()), 1)
        self.assertEqual(self.call('DELETE', '/v1/me', 'dana-sub')[0], 204)
        self.assertEqual(self.reports(), [])
        self.assertEqual(self.s3.list_objects_v2(Bucket=MEDIA_BUCKET).get('Contents', []), [])


if __name__ == '__main__':
    unittest.main()
