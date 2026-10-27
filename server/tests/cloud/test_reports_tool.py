import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

from moto import mock_aws

from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_bucket, make_table

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'tools'))
import reports  # noqa: E402

CONTEXT = {'appVersion': '1.0', 'build': '7', 'platform': 'ios', 'os': '18', 'screen': 'Inbox', 'lang': 'en'}


@mock_aws
class ReportsToolTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.k = self.repo.create_kehila('Beit Test', {})
        self.s3 = make_bucket()
        self.gabbai = self.member('gabbai')
        self.listener = self.member('listener')

    def member(self, role):
        user_id = f'u-{role}'
        self.repo.put_membership(self.k, user_id, role)
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{user_id}'},
                                    UpdateExpression='SET displayName = :n',
                                    ExpressionAttributeValues={':n': f'Zed {role.title()}Name'})
        return user_id

    def run_tool(self, *argv):
        out = StringIO()
        with mock.patch.object(reports, 'open_repo', return_value=self.repo), \
                mock.patch.object(reports, 'open_s3', return_value=(self.s3, 'kehilot-test-media')), redirect_stdout(out):
            reports.main([argv[0], '--env', 'dev', *argv[1:]])
        return out.getvalue()

    def test_list_roles_without_pii(self):
        self.repo.put_report('r1', 'anon text', CONTEXT, now=100)
        self.repo.put_report('r2', 'gabbai text', {**CONTEXT, 'kehilaId': self.k}, self.gabbai, now=200)
        self.repo.put_report('r3', 'listener text', {**CONTEXT, 'kehilaId': self.k}, self.listener, now=300)
        self.repo.put_report('r4', 'no kehila', CONTEXT, 'u-other', now=400)
        out = self.run_tool('list')
        self.assertIn('anonymous', out)
        self.assertIn(f'gabbai of {self.k}', out)
        self.assertIn(f'listener of {self.k}', out)
        self.assertIn('signed-in user', out)
        self.assertIn('ios/Inbox', out)
        for secret in ('Zed', 'u-gabbai', 'u-listener', 'u-other'):
            self.assertNotIn(secret, out)
        self.assertEqual(len(out.strip().splitlines()), 4)

    def test_list_status_limit_and_truncation(self):
        self.repo.put_report('r1', 'x' * 200, CONTEXT, now=100)
        self.repo.put_report('r2', 'second', CONTEXT, now=200)
        self.repo.mark_report('r2', 'fixed')
        out = self.run_tool('list', '--status', 'new')
        self.assertIn('r1', out)
        self.assertNotIn('r2', out)
        self.assertIn('x' * 80, out)
        self.assertNotIn('x' * 81, out)
        self.assertEqual(len(self.run_tool('list', '--limit', '1').strip().splitlines()), 1)

    def test_control_characters_escaped(self):
        evil = 'hi\x1b[31mRED\x1b]0;title\x07 \x9b2J ‮שלום\nline2'
        self.repo.put_report('r1', evil, CONTEXT, now=100)
        for out in (self.run_tool('list'), self.run_tool('get', 'r1')):
            for ch in ('\x1b', '\x07', '\x9b'):
                self.assertNotIn(ch, out)
            self.assertIn('\\x1b', out)
        got = self.run_tool('get', 'r1')
        self.assertIn('‮שלום', got)  # RTL marks and Hebrew intact
        self.assertIn('\nline2', got)
        self.assertEqual(len(self.run_tool('list').strip().splitlines()), 1)  # newline flattened in the list

    def test_get_shows_text_context_note_no_pii(self):
        self.repo.put_report('r1', 'full <b>text</b> \U0001F600', {**CONTEXT, 'kehilaId': self.k}, self.gabbai, now=100)
        self.repo.mark_report('r1', 'triaged', 'bug', 'looks real')
        out = self.run_tool('get', 'r1')
        for part in ('full <b>text</b> \U0001F600', 'gabbai of ' + self.k, 'triaged', 'bug', 'looks real', 'Inbox', 'appVersion'):
            self.assertIn(part, out)
        self.assertNotIn('Zed', out)
        self.assertNotIn('u-gabbai', out)

    def test_get_missing_exits(self):
        with self.assertRaises(SystemExit):
            self.run_tool('get', 'nope')

    def test_mark(self):
        self.repo.put_report('r1', 't', CONTEXT, now=100)
        self.run_tool('mark', 'r1', '--status', 'owner_decision', '--kind', 'change_request', '--note', 'analysis')
        item = self.repo.get_report('r1')
        self.assertEqual((item['status'], item['kind'], item['triage']), ('owner_decision', 'change_request', 'analysis'))

    def test_mark_validates(self):
        self.repo.put_report('r1', 't', CONTEXT, now=100)
        for argv in (['mark', 'r1', '--status', 'bogus'], ['mark', 'r1', '--status', 'fixed', '--kind', 'bogus']):
            with self.assertRaises(SystemExit), mock.patch('sys.stderr', StringIO()):
                self.run_tool(*argv)
        with self.assertRaises(SystemExit):
            self.run_tool('mark', 'missing', '--status', 'fixed')
        self.assertEqual(self.repo.get_report('r1')['status'], 'new')

    def test_image_only_on_request(self):
        self.s3.put_object(Bucket='kehilot-test-media', Key='reports/r1.png', Body=b'\x89PNG\r\n\x1a\nxx')
        self.repo.put_report('r1', 't', CONTEXT, image={'key': 'reports/r1.png', 'contentType': 'image/png', 'bytes': 10},
                             now=100)
        with tempfile.TemporaryDirectory() as tmp:
            out = self.run_tool('get', 'r1')
            self.assertEqual(os.listdir(tmp), [])
            self.assertIn('image', out)
            out = self.run_tool('get', 'r1', '--image-out', tmp)
            self.assertEqual(Path(tmp, 'r1.png').read_bytes(), b'\x89PNG\r\n\x1a\nxx')
            self.assertIn(str(Path(tmp, 'r1.png')), out)


if __name__ == '__main__':
    unittest.main()
