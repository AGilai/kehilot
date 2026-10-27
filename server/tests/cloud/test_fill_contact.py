import importlib.util
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('fill_contact', ROOT / 'tools' / 'fill_contact.py')
fill_contact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fill_contact)

PH = '{{PLATFORM_CONTACT}}'
EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+')
GOOD = 'someone@example.test'


class FillContactTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'infra' / 'envs' / 'dev').mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def write_env(self, line):
        (self.root / 'infra' / 'envs' / 'dev' / 'site.env').write_text(line + '\n')

    def make_dist(self, privacy=f'a {PH} b {PH}', terms=f'<p>{PH}</p>'):
        for name, text in (('privacy', privacy), ('terms', terms)):
            d = self.root / 'dist' / name
            d.mkdir(parents=True, exist_ok=True)
            (d / 'index.html').write_text(text)
        return self.root / 'dist'

    def run_main(self, dist, environ):
        return fill_contact.main(['--env', 'dev', '--dist', str(dist)], environ=environ, root=self.root)

    def test_fill_escapes_and_replaces_all(self):
        out = fill_contact.fill(f'{PH} and {PH}', 'a&b@example.test')
        self.assertEqual(out, 'a&amp;b@example.test and a&amp;b@example.test')
        self.assertNotIn(PH, out)

    def test_missing_setting_fails(self):
        with self.assertRaises(fill_contact.ContactError) as cm:
            fill_contact.read_contact('dev', {}, self.root)
        self.assertIn('KEHILOT_PLATFORM_CONTACT', str(cm.exception))
        dist = self.make_dist()
        self.assertEqual(self.run_main(dist, {}), 1)

    def test_invalid_value_fails(self):
        for bad in ('nope', 'a@b', 'a b@c.d', 'a@@c.d', 'a<@c.d', 'a@c.d"'):
            with self.assertRaises(fill_contact.ContactError) as cm:
                fill_contact.read_contact('dev', {'KEHILOT_PLATFORM_CONTACT': bad}, self.root)
            self.assertNotIn(bad, str(cm.exception))
        with self.assertRaises(fill_contact.ContactError):
            fill_contact.fill(PH, 'bad')

    def test_env_overrides_file(self):
        self.write_env('PLATFORM_CONTACT=file@example.test')
        self.assertEqual(fill_contact.read_contact('dev', {}, self.root), 'file@example.test')
        self.assertEqual(
            fill_contact.read_contact('dev', {'KEHILOT_PLATFORM_CONTACT': GOOD}, self.root), GOOD)
        dist = self.make_dist()
        self.assertEqual(self.run_main(dist, {'KEHILOT_PLATFORM_CONTACT': GOOD}), 0)
        self.assertEqual((dist / 'terms' / 'index.html').read_text(), f'<p>{GOOD}</p>')
        self.assertEqual((dist / 'privacy' / 'index.html').read_text(), f'a {GOOD} b {GOOD}')

    def test_page_without_placeholder_fails(self):
        dist = self.make_dist(terms='<p>nothing</p>')
        self.assertEqual(self.run_main(dist, {'KEHILOT_PLATFORM_CONTACT': GOOD}), 1)

    def test_missing_file_fails(self):
        dist = self.make_dist()
        (dist / 'terms' / 'index.html').unlink()
        self.assertEqual(self.run_main(dist, {'KEHILOT_PLATFORM_CONTACT': GOOD}), 1)

    def test_public_pages_have_no_email(self):
        for name in ('privacy', 'terms'):
            text = (ROOT / 'public' / name / 'index.html').read_text()
            self.assertIn(PH, text, name)
            self.assertIsNone(EMAIL.search(text), name)

    def test_terms_version_matches_consents(self):
        sys.path.insert(0, str(ROOT / 'server'))
        from cloud import consents
        text = (ROOT / 'public' / 'terms' / 'index.html').read_text()
        self.assertIn(consents.VERSIONS['kehilaTerms'], text)

    def test_cli_exits_1_without_setting(self):
        r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'fill_contact.py'), '--env', 'nosuchenv',
                            '--dist', str(self.root / 'dist')], capture_output=True, text=True,
                           env={'PATH': '/usr/bin:/bin'})
        self.assertEqual(r.returncode, 1)
        self.assertIn('KEHILOT_PLATFORM_CONTACT', r.stderr)


if __name__ == '__main__':
    unittest.main()
