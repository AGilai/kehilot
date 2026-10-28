"""tools/kehila_admin.py set-role (tech-role plan, Task R2): dry run by default, never leaves zero managers."""
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import boto3
from moto import mock_aws

from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'tools'))
import kehila_admin  # noqa: E402


@mock_aws
class SetRoleTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.k = self.repo.create_kehila('קהילת ניסיון', {})
        for user, role in (('u-gabbai', 'gabbai'), ('u-member', 'member'), ('u-tech', 'tech'),
                           ('u-listener', 'listener')):
            self.repo.put_membership(self.k, user, role)
        patcher = mock.patch.object(kehila_admin, 'open_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_cli(self, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            kehila_admin.main(['set-role', '--env', 'dev', '--kehila', self.k, *args])
        return out.getvalue()

    def role(self, user):
        return self.repo.get_membership(self.k, user)['role']

    def test_dry_run_is_the_default_and_changes_nothing(self):
        out = self.run_cli('--user', 'u-member', '--role', 'tech')
        self.assertIn('member -> tech', out)
        self.assertIn('dry run', out)
        self.assertEqual(self.role('u-member'), 'member')

    def test_apply_changes_the_role(self):
        out = self.run_cli('--user', 'u-member', '--role', 'tech', '--apply')
        self.assertIn('member -> tech', out)
        self.assertNotIn('dry run', out)
        self.assertEqual(self.role('u-member'), 'tech')

    def test_gabbai_to_tech_is_a_plain_change(self):
        self.assertIn('gabbai -> tech', self.run_cli('--user', 'u-gabbai', '--role', 'tech', '--apply'))
        self.assertEqual(self.role('u-gabbai'), 'tech')

    def test_no_change_says_so(self):
        self.assertIn('already tech', self.run_cli('--user', 'u-tech', '--role', 'tech', '--apply'))

    def test_refuses_to_leave_zero_managers_even_in_a_dry_run(self):
        self.repo.update_member(self.k, 'u-tech', 'tech', {'role': 'member'})
        for extra in ((), ('--apply',)):
            with self.assertRaises(SystemExit) as raised:
                self.run_cli('--user', 'u-gabbai', '--role', 'member', *extra)
            self.assertIn('last gabbai or tech', str(raised.exception))
        self.assertEqual(self.role('u-gabbai'), 'gabbai')

    def test_demoting_one_of_two_managers_is_allowed(self):
        self.assertIn('tech -> member', self.run_cli('--user', 'u-tech', '--role', 'member', '--apply'))
        self.assertEqual(self.role('u-tech'), 'member')

    def test_the_transaction_guard_still_refuses_after_the_check(self):
        """Another manager left between the dry check and the write: update_member's guard answers last_gabbai."""
        real = self.repo.update_member

        def racing(k, user, seen, fields):
            self.repo.table.delete_item(Key={'pk': f'K#{self.k}', 'sk': 'M#u-tech'})
            return real(k, user, seen, fields)
        with mock.patch.object(self.repo, 'update_member', side_effect=racing):
            with self.assertRaises(SystemExit) as raised:
                self.run_cli('--user', 'u-gabbai', '--role', 'member', '--apply')
        self.assertIn('last gabbai or tech', str(raised.exception))
        self.assertEqual(self.role('u-gabbai'), 'gabbai')

    def test_refusals(self):
        for user, role, text in (('u-nobody', 'tech', 'not a member'),
                                 ('u-listener', 'tech', 'listener'),
                                 ('u-member', 'listener', 'listener'),
                                 ('u-member', 'owner', 'invalid')):
            with self.assertRaises(SystemExit) as raised:
                with mock.patch('sys.stderr', io.StringIO()):  # argparse prints the invalid choices here
                    self.run_cli('--user', user, '--role', role, '--apply')
            self.assertTrue(text in str(raised.exception) or raised.exception.code == 2, (user, role))
        self.assertEqual((self.role('u-member'), self.role('u-listener')), ('member', 'listener'))

    def test_user_given_as_an_email_is_looked_up_in_cognito(self):
        cognito = boto3.client('cognito-idp', region_name='il-central-1')
        pool = cognito.create_user_pool(PoolName='p', UsernameAttributes=['email'])['UserPool']['Id']
        attributes = cognito.admin_create_user(UserPoolId=pool, Username='dana@example.test', UserAttributes=[
            {'Name': 'email', 'Value': 'dana@example.test'}])['User']['Attributes']
        sub = next(a['Value'] for a in attributes if a['Name'] == 'sub')
        self.repo.create_user_id(sub, 'u-dana')
        self.repo.put_membership(self.k, 'u-dana', 'member')
        with mock.patch.object(kehila_admin, 'terraform_output', return_value=pool), \
                mock.patch.object(kehila_admin, 'cognito_client', return_value=cognito):
            out = self.run_cli('--user', 'dana@example.test', '--role', 'tech', '--apply')
        self.assertIn('member -> tech', out)
        self.assertNotIn('dana@example.test', out)  # no email in the output
        self.assertEqual(self.role('u-dana'), 'tech')
        with mock.patch.object(kehila_admin, 'terraform_output', return_value=pool), \
                mock.patch.object(kehila_admin, 'cognito_client', return_value=cognito):
            with self.assertRaises(SystemExit) as raised:
                self.run_cli('--user', 'nobody@example.test', '--role', 'tech')
        self.assertIn('no account', str(raised.exception))
        self.assertNotIn('nobody@example.test', str(raised.exception))
