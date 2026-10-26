"""End-to-end check of the deployed dev environment. Usage: .venv/bin/python tools/smoke_dev.py

Creates two throwaway Cognito users and two Kehilot, checks health, auth rejection, sign-in and tenant
isolation, then deletes everything it created (also on failure). Prints one line per check.
"""
import json
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.cloud.ids import new_id  # noqa: E402
from server.cloud.repo import Repo  # noqa: E402


def outputs():
    raw = subprocess.run(['terraform', f'-chdir={ROOT}/infra/envs/dev', 'output', '-json'],
                         check=True, capture_output=True, text=True).stdout
    return {key: value['value'] for key, value in json.loads(raw).items()}


def http(url, token=None):
    request = urllib.request.Request(url, headers={'Authorization': token} if token else {})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.loads(response.read() or b'null')
    except urllib.error.HTTPError as error:
        body = error.read()
        return error.code, json.loads(body) if body.startswith(b'{') else None


def expect(name, condition, detail=''):
    print(f"{'PASS' if condition else 'FAIL'}  {name}{('  ' + detail) if detail and not condition else ''}")
    if not condition:
        raise SystemExit(1)


class Smoke:
    def __init__(self):
        self.out = outputs()
        self.api = self.out['api_url'].rstrip('/')
        self.idp = boto3.client('cognito-idp', region_name=self.out['region'])
        self.repo = Repo(boto3.resource('dynamodb', region_name=self.out['region']).Table(self.out['table_name']))
        self.users, self.items = [], []

    def make_user(self, label):
        email = f'smoke-{label}+{secrets.token_hex(4)}@example.invalid'
        password = secrets.token_urlsafe(18)
        pool = self.out['user_pool_id']
        self.idp.admin_create_user(UserPoolId=pool, Username=email, MessageAction='SUPPRESS',
                                   UserAttributes=[{'Name': 'email', 'Value': email},
                                                   {'Name': 'email_verified', 'Value': 'true'}])
        self.users.append(email)
        self.idp.admin_set_user_password(UserPoolId=pool, Username=email, Password=password, Permanent=True)
        auth = self.idp.admin_initiate_auth(UserPoolId=pool, ClientId=self.out['smoke_client_id'],
                                            AuthFlow='ADMIN_USER_PASSWORD_AUTH',
                                            AuthParameters={'USERNAME': email, 'PASSWORD': password})
        sub = self.idp.admin_get_user(UserPoolId=pool, Username=email)['UserAttributes']
        self.items.append((f"U#{next(a['Value'] for a in sub if a['Name'] == 'sub')}", 'SUB'))
        return auth['AuthenticationResult']['IdToken']

    def run(self):
        status, body = http(f'{self.api}/health')
        expect('check_health', status == 200 and body == {'ok': True}, f'{status} {body}')

        no_token, bad_token = http(f'{self.api}/v1/me')[0], http(f'{self.api}/v1/me', 'Bearer garbage')[0]
        expect('check_unauthenticated', no_token == 401 and bad_token == 401, f'{no_token} {bad_token}')

        token_a, token_b = self.make_user('a'), self.make_user('b')
        (sa, me_a), (sb, me_b) = http(f'{self.api}/v1/me', token_a), http(f'{self.api}/v1/me', token_b)
        expect('check_sign_in', sa == sb == 200 and me_a['userId'] != me_b['userId'], f'{sa} {sb}')

        ka, kb = new_id(), new_id()
        for k, user_id in ((ka, me_a['userId']), (kb, me_b['userId'])):
            self.repo.put_kehila(k, f'smoke {k[-4:]}')
            self.repo.put_membership(k, user_id, 'member')
            self.items += [(f'K#{k}', 'META'), (f'K#{k}', f'M#{user_id}')]
        a_on_a = http(f'{self.api}/v1/kehilot/{ka}', token_a)[0]
        a_on_b = http(f'{self.api}/v1/kehilot/{kb}', token_a)[0]
        b_on_a = http(f'{self.api}/v1/kehilot/{ka}', token_b)[0]
        listed = [k['kehilaId'] for k in http(f'{self.api}/v1/me', token_a)[1]['kehilot']]
        expect('check_tenant_isolation', (a_on_a, a_on_b, b_on_a) == (200, 404, 404) and listed == [ka],
               f'{a_on_a} {a_on_b} {b_on_a} {listed}')

    def cleanup(self):
        for pk, sk in self.items:
            self.repo.table.delete_item(Key={'pk': pk, 'sk': sk})
        for email in self.users:
            self.idp.admin_delete_user(UserPoolId=self.out['user_pool_id'], Username=email)
        print(f'cleanup: {len(self.items)} items, {len(self.users)} users removed')


if __name__ == '__main__':
    smoke = Smoke()
    try:
        smoke.run()
    finally:
        smoke.cleanup()
