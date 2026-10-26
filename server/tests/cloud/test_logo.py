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
           + _chunk(b'IDAT', zlib.compress(raw)) + _chunk(b'IEND', b''))
    return png + b'\0' * pad


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
        self.assertNotIn('logo', self.call(f'/v1/kehilot/{self.k}')[1])


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
        import logging
        from server.cloud import jobs, push_worker  # noqa: F401
        self.assertLessEqual(logging.getLogger().level, logging.INFO)
