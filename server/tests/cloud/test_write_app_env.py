import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('write_app_env', ROOT / 'tools' / 'write_app_env.py')
write_app_env = importlib.util.module_from_spec(spec)
spec.loader.exec_module(write_app_env)

OUTPUTS = {
    'api_url': {'value': 'https://abc123.execute-api.il-central-1.amazonaws.com/'},
    'region': {'value': 'il-central-1'},
    'user_pool_id': {'value': 'il-central-1_Example'},
    'app_client_id': {'value': 'exampleclientid'},
    'cognito_domain': {'value': 'kehilot-dev.auth.il-central-1.amazoncognito.com'},
    'web_url': {'value': 'https://d111example.cloudfront.net'},
    'smoke_client_id': {'value': 'ignored'},
}

EXPECTED = '''EXPO_PUBLIC_API_URL=https://abc123.execute-api.il-central-1.amazonaws.com
EXPO_PUBLIC_REGION=il-central-1
EXPO_PUBLIC_COGNITO_POOL_ID=il-central-1_Example
EXPO_PUBLIC_COGNITO_CLIENT_ID=exampleclientid
EXPO_PUBLIC_COGNITO_DOMAIN=kehilot-dev.auth.il-central-1.amazoncognito.com
EXPO_PUBLIC_WEB_URL=https://d111example.cloudfront.net
EXPO_PUBLIC_FEDERATION=
EXPO_PUBLIC_REPORTS=1
'''


class WriteAppEnvTest(unittest.TestCase):
    def test_render_maps_outputs_to_exact_lines(self):
        self.assertEqual(write_app_env.render(OUTPUTS), EXPECTED)

    def test_missing_output_is_an_error_naming_the_key(self):
        broken = {k: v for k, v in OUTPUTS.items() if k != 'cognito_domain'}
        with self.assertRaises(SystemExit) as ctx:
            write_app_env.render(broken)
        self.assertIn('cognito_domain', str(ctx.exception))

    def test_main_writes_env_file_for_the_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_app_env.write('dev', OUTPUTS, Path(tmp))
            self.assertEqual(path.name, '.env.dev')
            self.assertEqual(path.read_text(), EXPECTED)

    def test_prod_env_has_no_reports_flag(self):
        with tempfile.TemporaryDirectory() as tmp:
            text = write_app_env.write('prod', OUTPUTS, Path(tmp)).read_text()
            self.assertNotIn('EXPO_PUBLIC_REPORTS', text)

    def test_only_dev_and_prod_envs_are_accepted(self):
        with self.assertRaises(SystemExit):
            write_app_env.write('../x', OUTPUTS, Path('.'))


if __name__ == '__main__':
    unittest.main()
