import base64
import json
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

from moto import mock_aws

from server.cloud import handler as handler_module
from server.cloud.identity import Caller, resolve_user_id
from server.cloud.ids import ID_RE
from server.cloud.logo import validate_logo
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table
from server.tests.cloud.test_handler import Context, event

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'tools'))
import kehila_admin  # noqa: E402


def _chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def make_png(width, height=None, pad=0):
    height = width if height is None else height
    raw = b''.join(b'\x00' + b'\x80' * (width * 3) for _ in range(height))
    png = (b'\x89PNG\r\n\x1a\n' + _chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
           + _chunk(b'IDAT', zlib.compress(raw)) + (_chunk(b'tEXt', b'\0' * (pad - 12)) if pad else b'')
           + _chunk(b'IEND', b''))
    return png


class ValidateLogoTest(unittest.TestCase):
    def test_good_png(self):
        self.assertEqual(validate_logo(make_png(64)), (64, 64))
        self.assertEqual(validate_logo(make_png(192)), (192, 192))
        self.assertEqual(validate_logo(make_png(512)), (512, 512))

    def test_bad_signature(self):
        with self.assertRaisesRegex(ValueError, 'PNG'):
            validate_logo(b'GIF89a' + make_png(64)[6:])
        with self.assertRaises(ValueError):
            validate_logo(b'')

    def test_not_square(self):
        with self.assertRaisesRegex(ValueError, 'square'):
            validate_logo(make_png(100, 80))

    def test_too_small_and_too_big_side(self):
        with self.assertRaisesRegex(ValueError, '64'):
            validate_logo(make_png(63))
        with self.assertRaisesRegex(ValueError, '512'):
            validate_logo(make_png(513))

    def test_too_many_bytes(self):
        validate_logo(make_png(64, pad=65536 - len(make_png(64))))
        with self.assertRaisesRegex(ValueError, '65536'):
            validate_logo(make_png(64, pad=65536))

    def test_codes(self):
        from server.cloud.logo import LogoError
        cases = [(b'', 'logo_format'), (make_png(100, 80), 'logo_not_square'), (make_png(63), 'logo_too_small'),
                 (make_png(513), 'logo_too_large'), (make_png(64, pad=65537 - len(make_png(64))), 'logo_too_large')]
        for data, code in cases:
            with self.assertRaises(LogoError) as raised:
                validate_logo(data)
            self.assertEqual(raised.exception.code, code)

    def test_chunk_walk(self):
        png = make_png(64)
        for bad in (png + b'junk',                                   # junk tail
                    png[:-12],                                         # no IEND
                    png[:40] + bytes([png[40] ^ 1]) + png[41:],        # bad CRC / data
                    png[:8] + struct.pack('>I', 12) + png[12:],        # IHDR length 12
                    png[:33] + png[33:-12] [:5]):                      # chunk longer than file
            with self.assertRaises(ValueError):
                validate_logo(bad)
        no_idat = png[:33] + png[-12:]
        with self.assertRaises(ValueError):
            validate_logo(no_idat)

    def test_dev_logo_shape_passes(self):
        data = make_png(384, pad=2000)
        self.assertLess(len(data), 65536)
        self.assertEqual(validate_logo(data), (384, 384))

    def test_first_chunk_not_ihdr(self):
        png = make_png(64)
        with self.assertRaises(ValueError):
            validate_logo(png[:12] + b'IDAT' + png[16:])

    def test_truncated_header(self):
        with self.assertRaises(ValueError):
            validate_logo(make_png(64)[:20])


@mock_aws
class LogoRepoAndRouteTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.k = self.repo.create_kehila('Beit Logo', {})
        self.other = self.repo.create_kehila('Beit Other', {})
        self.member = resolve_user_id(self.repo, Caller('s1', 'a@example.test'))
        self.repo.put_membership(self.k, self.member, 'listener')

    def call(self, path, sub='s1'):
        response = handler_module.handler(event('GET', path, sub=sub), Context())
        return response['statusCode'], json.loads(response['body'])

    def test_set_and_get(self):
        png = make_png(64)
        version = self.repo.set_logo(self.k, png)
        self.assertRegex(version, ID_RE)
        self.assertEqual(self.repo.get_logo(self.k), (version, png))
        again = self.repo.set_logo(self.k, make_png(65))
        self.assertNotEqual(again, version)
        self.assertEqual(self.repo.get_kehila(self.k)['logoVersion'], again)

    def test_no_logo(self):
        self.assertIsNone(self.repo.get_logo(self.k))

    def test_set_on_missing_kehila_fails_and_writes_nothing(self):
        with self.assertRaises(LookupError):
            self.repo.set_logo('0' * 26, make_png(64))
        self.assertIsNone(self.repo.get_kehila('0' * 26))

    def test_member_gets_logo(self):
        png = make_png(64)
        version = self.repo.set_logo(self.k, png)
        status, body = self.call(f'/v1/kehilot/{self.k}/logo')
        self.assertEqual(status, 200)
        self.assertEqual(body, {'logoVersion': version, 'contentType': 'image/png',
                                'data': base64.b64encode(png).decode()})

    def test_non_member_denied_like_kehila_route(self):
        self.repo.set_logo(self.other, make_png(64))
        self.assertEqual(self.call(f'/v1/kehilot/{self.other}/logo'), self.call(f'/v1/kehilot/{self.other}'))
        self.assertEqual(self.call(f'/v1/kehilot/{self.other}/logo')[0], 404)

    def test_no_logo_is_404(self):
        self.assertEqual(self.call(f'/v1/kehilot/{self.k}/logo'), (404, {'error': 'not_found'}))

    def test_logo_version_in_kehila_and_me(self):
        status, body = self.call(f'/v1/kehilot/{self.k}')
        self.assertIsNone(body['logoVersion'])
        self.assertIsNone(self.call('/v1/me')[1]['kehilot'][0]['logoVersion'])
        version = self.repo.set_logo(self.k, make_png(64))
        self.assertEqual(self.call(f'/v1/kehilot/{self.k}')[1]['logoVersion'], version)
        self.assertEqual(self.call('/v1/me')[1]['kehilot'][0]['logoVersion'], version)

    def test_get_kehila_omits_logo_bytes(self):
        version = self.repo.set_logo(self.k, make_png(64))
        item = self.repo.get_kehila(self.k)
        self.assertNotIn('logo', item)
        self.assertEqual((item['logoVersion'], item['name'], item['kehilaId']), (version, 'Beit Logo', self.k))
        self.assertIn('settings', item)
        self.assertEqual(self.repo.get_logo(self.k)[1], make_png(64))

    def test_logo_bytes_live_in_their_own_item_not_in_meta(self):
        png = make_png(64)
        version = self.repo.set_logo(self.k, png)
        meta = self.repo.table.get_item(Key={'pk': f'K#{self.k}', 'sk': 'META'})['Item']
        self.assertNotIn('logo', meta)
        self.assertEqual(meta['logoVersion'], version)
        logo = self.repo.table.get_item(Key={'pk': f'K#{self.k}', 'sk': 'LOGO'})['Item']
        self.assertEqual((bytes(logo['logo'].value), logo['logoVersion']), (png, version))

    def test_logo_route_rejects_invalid_kehila_id(self):
        self.assertEqual(self.call('/v1/kehilot/not-an-id/logo'), (400, {'error': 'invalid_kehila_id'}))


@mock_aws
class LogoRouteTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.k = self.repo.create_kehila('Beit Logo', {})
        self.users = {}
        for sub, role in (('g1', 'gabbai'), ('t1', 'tech'), ('m1', 'member'), ('l1', 'listener')):
            self.users[sub] = resolve_user_id(self.repo, Caller(sub, f'{sub}@example.test'))
            self.repo.put_membership(self.k, self.users[sub], role)
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{self.users["g1"]}'},
                                    UpdateExpression='SET displayName = :n', ExpressionAttributeValues={':n': 'יוסף ניסיון'})

    def call(self, method, path, body=None, sub='g1'):
        response = handler_module.handler(event(method, path, sub=sub, body=body), Context())
        text = response['body']
        return response['statusCode'], (json.loads(text) if text else None)

    def put(self, png, sub='g1'):
        return self.call('PUT', f'/v1/kehilot/{self.k}/admin/logo', json.dumps({'data': base64.b64encode(png).decode()}), sub)

    def kehila(self, sub='g1'):
        return self.call('GET', f'/v1/kehilot/{self.k}', sub=sub)[1]

    def test_gabbai_uploads_and_version_changes(self):
        png = make_png(256)
        before = self.kehila()['logoVersion']
        status, body = self.put(png)
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {'logoVersion'})
        status, got = self.call('GET', f'/v1/kehilot/{self.k}/logo')
        self.assertEqual(base64.b64decode(got['data']), png)
        shown = self.kehila()
        self.assertNotEqual(shown['logoVersion'], before)
        self.assertEqual(shown['logoVersion'], body['logoVersion'])
        self.assertEqual(shown['logoInfo'], {'name': 'יוסף ניסיון', 'at': shown['logoInfo']['at'], 'bytes': len(png), 'side': 256})
        self.assertIsInstance(shown['logoInfo']['at'], int)
        self.assertNotIn('logoInfo', self.kehila('m1'))

    def test_tech_may_upload(self):
        self.assertEqual(self.put(make_png(64), 't1')[0], 200)
        self.assertEqual(self.kehila('t1')['logoInfo']['name'], '')

    def test_limits_map_to_codes(self):
        cases = [(make_png(63), 'logo_too_small'), (make_png(513), 'logo_too_large'),
                 (make_png(64, pad=65537 - len(make_png(64))), 'logo_too_large'),
                 (make_png(100, 80), 'logo_not_square'), (b'GIF89a' + make_png(64)[6:], 'invalid_logo_format')]
        for png, code in cases:
            self.assertEqual(self.put(png), (400, {'error': code}), code)
        status, body = self.call('PUT', f'/v1/kehilot/{self.k}/admin/logo', json.dumps({'data': 'not base64!'}))
        self.assertEqual((status, body), (400, {'error': 'invalid_logo_format'}))
        self.assertEqual(self.put(make_png(64, pad=65536 - len(make_png(64))))[0], 200)

    def test_bad_bodies(self):
        path = f'/v1/kehilot/{self.k}/admin/logo'
        self.assertEqual(self.call('PUT', path, json.dumps({'data': 5}))[1], {'error': 'invalid_body'})
        self.assertEqual(self.call('PUT', path, json.dumps({}))[1], {'error': 'invalid_body'})
        self.assertEqual(self.call('PUT', path, json.dumps({'data': 'A' * (96 * 1024)}))[1], {'error': 'invalid_body'})

    def test_member_forbidden_listener_forbidden(self):
        for sub in ('m1', 'l1'):
            self.assertEqual(self.put(make_png(64), sub)[0], 403)
            self.assertEqual(self.call('DELETE', f'/v1/kehilot/{self.k}/admin/logo', sub=sub)[0], 403)
        self.assertIsNone(self.repo.get_logo(self.k))

    def test_delete_removes_logo_and_version(self):
        self.put(make_png(64))
        status, body = self.call('DELETE', f'/v1/kehilot/{self.k}/admin/logo')
        self.assertEqual((status, body), (204, None))
        self.assertEqual(self.call('GET', f'/v1/kehilot/{self.k}/logo'), (404, {'error': 'not_found'}))
        shown = self.kehila()
        self.assertIsNone(shown['logoVersion'])
        self.assertIsNone(shown['logoInfo'])
        self.assertEqual(self.call('DELETE', f'/v1/kehilot/{self.k}/admin/logo')[0], 204)

    def test_other_kehila_gets_404(self):
        other = self.repo.create_kehila('Beit Other', {})
        body = json.dumps({'data': base64.b64encode(make_png(64)).decode()})
        self.assertEqual(self.call('PUT', f'/v1/kehilot/{other}/admin/logo', body)[0], 404)
        self.assertEqual(self.call('DELETE', f'/v1/kehilot/{other}/admin/logo')[0], 404)
        self.assertIsNone(self.repo.get_logo(other))

    def test_delete_missing_kehila(self):
        self.assertEqual(self.repo.get_kehila('0' * 26), None)
        with self.assertRaises(LookupError):
            self.repo.delete_logo('0' * 26)

    def test_cli_set_logo_has_no_uploader(self):
        self.repo.set_logo(self.k, make_png(64))
        self.assertEqual(self.kehila()['logoInfo']['name'], '')

    def test_logo_bytes_never_logged(self):
        png = make_png(64)
        prefix = base64.b64encode(png).decode()[:40]
        with self.assertLogs(level='INFO') as logs:
            import logging
            logging.getLogger().info('start')
            self.put(b'GIF89a' + png[6:])
            self.put(png)
        self.assertFalse([r for r in logs.output if prefix in r])


@mock_aws
class LogoCliTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def png_file(self, data, name='logo.png'):
        path = Path(self.dir.name) / name
        path.write_bytes(data)
        return str(path)

    def test_set_logo_missing_kehila_exits_clearly(self):
        with mock.patch.object(kehila_admin, 'open_repo', return_value=self.repo):
            with self.assertRaises(SystemExit) as raised:
                kehila_admin.main(['set-logo', '--env', 'dev', '--kehila', '0' * 26,
                                   '--logo', self.png_file(make_png(64))])
        self.assertIn('does not exist', str(raised.exception))

    def test_create_prints_ids_before_a_logo_write_failure(self):
        import io
        from contextlib import redirect_stdout
        out = io.StringIO()
        with mock.patch.object(kehila_admin, 'open_repo', return_value=self.repo), \
                mock.patch.object(self.repo, 'set_logo', side_effect=RuntimeError('boom')), \
                redirect_stdout(out), self.assertRaises(RuntimeError):
            kehila_admin.main(['create', '--env', 'dev', '--name', 'Beit Logo', '--logo', self.png_file(make_png(64))])
        self.assertIn('Kehila ID:', out.getvalue())
        self.assertIn('invite code', out.getvalue())

    def test_invalid_logo_is_rejected_before_any_write(self):
        with mock.patch.object(kehila_admin, 'open_repo', return_value=self.repo):
            with self.assertRaises(SystemExit):
                kehila_admin.main(['create', '--env', 'dev', '--name', 'Beit Bad',
                                   '--logo', self.png_file(make_png(10))])
        self.assertEqual(self.repo.table.scan()['Items'], [])

    def test_create_with_logo_and_set_logo(self):
        with mock.patch.object(kehila_admin, 'open_repo', return_value=self.repo):
            kehila_admin.main(['create', '--env', 'dev', '--name', 'Beit Logo',
                               '--logo', self.png_file(make_png(64))])
            k = next(i['kehilaId'] for i in self.repo.table.scan()['Items'] if i['sk'] == 'META')
            first = self.repo.get_logo(k)[0]
            kehila_admin.main(['set-logo', '--env', 'dev', '--kehila', k, '--logo', self.png_file(make_png(80))])
        self.assertNotEqual(self.repo.get_logo(k)[0], first)


class LambdaLoggingTest(unittest.TestCase):
    def test_entry_modules_enable_info_logging(self):
        import importlib
        import logging
        from server.cloud import handler, jobs, push_worker
        root = logging.getLogger()
        self.addCleanup(root.setLevel, root.level)
        for module in (handler, push_worker, jobs):
            root.setLevel(logging.WARNING)
            importlib.reload(module)
            self.assertEqual(root.level, logging.INFO, module.__name__)
