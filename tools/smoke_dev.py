"""End-to-end check of the deployed dev environment. Usage: .venv/bin/python tools/smoke_dev.py

Creates throwaway Cognito users and Kehilot, checks health, auth rejection, sign-in, tenant isolation, the
invite and membership flow, message visibility, private replies, device routes and the push pipeline, then
deletes everything it created (also on failure). Prints one line per check.
"""
import json
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.cloud.ids import new_id  # noqa: E402
from server.cloud.repo import Repo  # noqa: E402
from tools.kehila_admin import create_kehila  # noqa: E402

HOLD_BACK_SECONDS = 2.5  # /changes holds back changes younger than 2 s


def outputs():
    raw = subprocess.run(['terraform', f'-chdir={ROOT}/infra/envs/dev', 'output', '-json'],
                         check=True, capture_output=True, text=True).stdout
    return {key: value['value'] for key, value in json.loads(raw).items()}


def http(url, token=None, method='GET', body=None):
    """(status, parsed JSON or None). A 409 try_again (transaction conflict) is retried a few times."""
    headers = {'Authorization': token} if token else {}
    data = None
    if body is not None:
        data, headers['content-type'] = json.dumps(body).encode(), 'application/json'
    for attempt in range(4):
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raw = error.read()
            parsed = json.loads(raw) if raw.startswith(b'{') else None
            if error.code == 409 and parsed == {'error': 'try_again'} and attempt < 3:
                time.sleep(0.5)
                continue
            return error.code, parsed


def expect(name, condition, detail=''):
    print(f"{'PASS' if condition else 'FAIL'}  {name}{('  ' + detail) if detail and not condition else ''}")
    if not condition:
        raise SystemExit(1)


class Smoke:
    def __init__(self):
        self.out = outputs()
        self.api = self.out['api_url'].rstrip('/')
        region = self.out['region']
        self.idp = boto3.client('cognito-idp', region_name=region)
        self.sqs = boto3.client('sqs', region_name=region)
        self.logs = boto3.client('logs', region_name=region)
        self.repo = Repo(boto3.resource('dynamodb', region_name=region).Table(self.out['table_name']))
        self.users, self.items = [], []
        self.kehilot, self.user_ids, self.subs = [], [], []

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
        sub = next(a['Value'] for a in sub if a['Name'] == 'sub')
        self.subs.append(sub)
        self.items.append((f'U#{sub}', 'SUB'))
        return auth['AuthenticationResult']['IdToken']

    def call(self, token, method, path, body=None):
        return http(f'{self.api}{path}', token, method, body)

    def person(self, label, first, last):
        """A signed-in user with a saved profile: (token, userId)."""
        token = self.make_user(label)
        user_id = self.call(token, 'GET', '/v1/me')[1]['userId']
        self.user_ids.append(user_id)
        status, _ = self.call(token, 'PUT', '/v1/me/profile', {'firstName': first, 'lastName': last, 'lang': 'en'})
        expect(f'profile_saved_{label}', status == 200, str(status))
        return token, user_id

    def run(self):
        status, body = http(f'{self.api}/health')
        expect('check_health', status == 200 and body == {'ok': True}, f'{status} {body}')

        no_token, bad_token = http(f'{self.api}/v1/me')[0], http(f'{self.api}/v1/me', 'Bearer garbage')[0]
        expect('check_unauthenticated', no_token == 401 and bad_token == 401, f'{no_token} {bad_token}')

        token_a, token_b = self.make_user('a'), self.make_user('b')
        (sa, me_a), (sb, me_b) = http(f'{self.api}/v1/me', token_a), http(f'{self.api}/v1/me', token_b)
        expect('check_sign_in', sa == sb == 200 and me_a['userId'] != me_b['userId'], f'{sa} {sb}')
        self.user_ids += [me_a['userId'], me_b['userId']]

        ka, kb = new_id(), new_id()
        self.kehilot += [ka, kb]
        for k, user_id in ((ka, me_a['userId']), (kb, me_b['userId'])):
            self.repo.put_kehila(k, f'smoke {k[-4:]}')
            self.repo.put_membership(k, user_id, 'member')
        a_on_a = http(f'{self.api}/v1/kehilot/{ka}', token_a)[0]
        a_on_b = http(f'{self.api}/v1/kehilot/{kb}', token_a)[0]
        b_on_a = http(f'{self.api}/v1/kehilot/{ka}', token_b)[0]
        listed = [k['kehilaId'] for k in http(f'{self.api}/v1/me', token_a)[1]['kehilot']]
        expect('check_tenant_isolation', (a_on_a, a_on_b, b_on_a) == (200, 404, 404) and listed == [ka],
               f'{a_on_a} {a_on_b} {b_on_a} {listed}')

        self.check_invite_flow()
        self.check_message_visibility()
        self.check_private_reply()
        self.check_devices()
        self.check_push_pipeline()

    def check_invite_flow(self):
        """Admin CLI creates a Kehila; gabbai, a family and a listener join through invites."""
        self.k, gabbai_code = create_kehila(self.repo, 'Smoke Community', 'en', dev=True)
        self.kehilot.append(self.k)
        k = self.k
        self.gab, self.gab_id = self.person('gab', 'Smoke', 'Gabbai')
        status, body = http(f'{self.api}/v1/invites/{gabbai_code}')  # public: no Authorization header
        expect('invite_preview_public', (status, body) == (200, {'kehilaName': 'Smoke Community'}), f'{status} {body}')
        expect('invite_preview_unknown', http(f'{self.api}/v1/invites/NOSUCHCODE')[0] == 404)
        status, body = self.call(self.gab, 'POST', f'/v1/invites/{gabbai_code}/accept')
        expect('gabbai_invite_accepted', (status, body) == (200, {'kehilaId': k, 'role': 'gabbai'}), f'{status} {body}')

        status, body = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/invites', {'uses': 3, 'days': 1})
        expect('member_invite_created', status == 201 and body['code'], f'{status} {body}')
        code = body['code']
        names = {'fam1': ('Test', 'Family'), 'fam2': ('Other', 'Family'), 'lis': ('Test', 'Listener')}
        self.people = {}
        for label, (first, last) in names.items():
            token, user_id = self.person(label, first, last)
            status, body = self.call(token, 'POST', f'/v1/invites/{code}/accept')
            expect(f'{label}_accepted_as_listener', (status, body) == (200, {'kehilaId': k, 'role': 'listener'}),
                   f'{status} {body}')
            self.people[label] = (token, user_id)
        for label in ('fam1', 'fam2'):
            token, user_id = self.people[label]
            status, _ = self.call(token, 'POST', f'/v1/kehilot/{k}/membership-request', {})
            expect(f'{label}_requested', status == 202, str(status))
        status, pending = self.call(self.gab, 'GET', f'/v1/kehilot/{k}/admin/requests')
        expect('gabbai_sees_requests', status == 200 and {r['userId'] for r in pending}
               == {self.people['fam1'][1], self.people['fam2'][1]}, f'{status} {pending}')
        for label in ('fam1', 'fam2'):
            status, _ = self.call(self.gab, 'POST',
                                  f'/v1/kehilot/{k}/admin/requests/{self.people[label][1]}/approve',
                                  {'classification': ''})
            expect(f'{label}_approved', status == 200, str(status))
        roles = {m['userId']: m['role'] for m in self.call(self.gab, 'GET', f'/v1/kehilot/{k}/admin/members')[1]}
        expect('roles_after_approval', roles == {self.gab_id: 'gabbai', self.people['fam1'][1]: 'member',
                                                 self.people['fam2'][1]: 'member', self.people['lis'][1]: 'listener'},
               str(roles))
        status, body = self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/admin/members/{self.people["lis"][1]}',
                                 {'role': 'member'})
        expect('listener_role_change_refused', (status, body) == (409, {'error': 'role_change_not_allowed'}),
               f'{status} {body}')
        status, _ = self.call(self.people['lis'][0], 'GET', f'/v1/kehilot/{k}/admin/members')
        expect('listener_cannot_list_members', status == 403, str(status))
        print('PASS  check_invite_flow')

    def feed(self, token, since):
        status, body = self.call(token, 'GET', f'/v1/kehilot/{self.k}/changes?since={since}')
        expect('changes_ok', status == 200 and 'changes' in body, f'{status} {body}')
        return body

    def cursor(self, token):
        return self.call(token, 'GET', f'/v1/kehilot/{self.k}/changes')[1]['cursor']

    def check_message_visibility(self):
        k = self.k
        channels = {c['name']: c for c in self.call(self.gab, 'GET', f'/v1/kehilot/{k}/channels')[1]}
        lis_channels = [c['name'] for c in self.call(self.people['lis'][0], 'GET', f'/v1/kehilot/{k}/channels')[1]]
        expect('listener_sees_only_announcements', lis_channels == ['announcements'] and set(channels) == {
            'announcements', 'simchas', 'condolences'}, f'{lis_channels} {sorted(channels)}')
        self.channels = channels
        time.sleep(HOLD_BACK_SECONDS)  # the baseline cursor must not precede earlier setup changes
        self.cursors = {label: self.cursor(self.people[label][0]) for label in ('fam1', 'fam2', 'lis')}
        self.cursors['gab'] = self.cursor(self.gab)
        status, msg = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/messages', {
            'channelId': channels['simchas']['channelId'], 'type': 'celebration', 'title': 'Smoke mazal tov',
            'body': 'Test blessing', 'targetMemberId': self.people['fam1'][1]})
        expect('gabbai_posts_targeted_message', status == 201 and msg['targetName'] == 'Test Family'
               and msg['replierCount'] == 0, f'{status} {msg}')
        self.msg = msg['messageId']
        time.sleep(HOLD_BACK_SECONDS)
        lis_feed = self.feed(self.people['lis'][0], self.cursors['lis'])
        fam_feed = self.feed(self.people['fam1'][0], self.cursors['fam1'])
        expect('listener_feed_hides_message', not lis_feed['changes'], str(lis_feed))
        expect('member_feed_has_message', any(c['kind'] == 'message' and c['id'] == self.msg
                                              for c in fam_feed['changes']), str(fam_feed))
        status, _ = self.call(self.people['lis'][0], 'GET', f'/v1/kehilot/{k}/messages/{self.msg}')
        expect('listener_get_message_404', status == 404, str(status))
        print('PASS  check_message_visibility')

    def check_private_reply(self):
        k, m = self.k, self.msg
        fam1, fam2, lis = (self.people[x][0] for x in ('fam1', 'fam2', 'lis'))
        status, reply = self.call(fam2, 'POST', f'/v1/kehilot/{k}/messages/{m}/replies', {'body': 'Mazal tov!'})
        expect('third_user_replies', status == 201 and reply['body'] == 'Mazal tov!', f'{status} {reply}')
        status, body = self.call(fam1, 'POST', f'/v1/kehilot/{k}/messages/{m}/replies', {'body': 'self'})
        expect('target_cannot_reply_to_own', (status, body) == (409, {'error': 'cannot_reply_to_own'}), f'{status} {body}')
        status, _ = self.call(lis, 'POST', f'/v1/kehilot/{k}/messages/{m}/replies', {'body': 'x'})
        expect('listener_cannot_reply', status == 403, str(status))  # role check comes first
        gab_replies = self.call(self.gab, 'GET', f'/v1/kehilot/{k}/messages/{m}/replies')
        expect('gabbai_replies_empty', gab_replies == (200, []), str(gab_replies))
        target_replies = self.call(fam1, 'GET', f'/v1/kehilot/{k}/messages/{m}/replies')
        author_replies = self.call(fam2, 'GET', f'/v1/kehilot/{k}/messages/{m}/replies')
        expect('target_and_author_see_reply', [r['body'] for r in target_replies[1]] == ['Mazal tov!']
               and len(author_replies[1]) == 1, f'{target_replies} {author_replies}')
        seen = self.call(self.gab, 'GET', f'/v1/kehilot/{k}/messages/{m}')[1]
        expect('replier_count_visible_to_gabbai', seen['replierCount'] == 1, str(seen))
        time.sleep(HOLD_BACK_SECONDS)
        gab_kinds = {c['kind'] for c in self.feed(self.gab, self.cursors['gab'])['changes']}
        fam_kinds = {c['kind'] for c in self.feed(fam1, self.cursors['fam1'])['changes']}
        expect('feed_reply_visibility', 'reply_count' in gab_kinds and 'reply' not in gab_kinds
               and {'reply', 'reply_count'} <= fam_kinds, f'{gab_kinds} {fam_kinds}')
        print('PASS  check_private_reply')

    def check_devices(self):
        token = f'ExponentPushToken[smoke-{secrets.token_hex(6)}]'
        fam = self.people['fam1']
        status, _ = self.call(fam[0], 'PUT', '/v1/me/devices', {'token': token, 'platform': 'ios'})
        expect('device_registered', status == 204 and [d['token'] for d in self.repo.list_devices(fam[1])] == [token],
               str(status))
        status, _ = self.call(fam[0], 'DELETE', '/v1/me/devices/' + urllib.parse.quote(token, safe=''))
        expect('device_deleted_percent_encoded', status == 204 and not self.repo.list_devices(fam[1]), str(status))
        print('PASS  check_devices')

    def queue_depth(self, url):
        attrs = self.sqs.get_queue_attributes(QueueUrl=url, AttributeNames=[
            'ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible',
            'ApproximateNumberOfMessagesDelayed'])['Attributes']
        return sum(int(v) for v in attrs.values())

    def check_push_pipeline(self):
        urls = {name: self.sqs.get_queue_url(QueueName=f'kehilot-dev-{name}')['QueueUrl'] for name in ('push', 'push-dlq')}
        fam = self.people['fam1']
        token = f'ExponentPushToken[smoke-{secrets.token_hex(6)}]'
        status, _ = self.call(fam[0], 'PUT', '/v1/me/devices', {'token': token, 'platform': 'android'})
        expect('push_device_registered', status == 204, str(status))
        start_ms = int(time.time() * 1000)
        status, _ = self.call(self.gab, 'POST', f'/v1/kehilot/{self.k}/messages', {
            'channelId': self.channels['simchas']['channelId'], 'type': 'weekly', 'title': 'Smoke push', 'body': ''})
        expect('push_message_posted', status == 201, str(status))
        deadline, trail = time.time() + 60, []
        while time.time() < deadline:
            time.sleep(3)
            depth = self.queue_depth(urls['push'])
            trail.append(depth)
            if depth == 0:
                break
        print(f'INFO  queue depth polls: {trail}')
        expect('push_queue_drained', self.queue_depth(urls['push']) == 0, f'depth trail {trail}')
        time.sleep(5)  # let the worker's log lines reach CloudWatch
        expect('push_dlq_empty', self.queue_depth(urls['push-dlq']) == 0)
        group = '/aws/lambda/kehilot-dev-push-worker'
        since = int((time.time() - 300) * 1000)
        errors = self.logs.filter_log_events(logGroupName=group, startTime=since, filterPattern='ERROR')['events']
        expect('push_worker_no_errors_5min', not errors, '; '.join(e['message'].strip()[:300] for e in errors[:3]))
        # The Lambda runtime drops INFO records (root logger is WARNING), so "ran" means an invocation started.
        ran = self.logs.filter_log_events(logGroupName=group, startTime=start_ms, filterPattern='"START RequestId"')['events']
        expect('push_worker_invoked', bool(ran), 'no worker invocation since the publish')
        left = [d['token'] for d in self.repo.list_devices(fam[1])]
        print(f"INFO  fake token after push: {'kept' if token in left else 'dropped as DeviceNotRegistered'}")
        print('PASS  check_push_pipeline')

    def cleanup(self):
        """Delete everything this run made, found by scanning for its IDs (messages, replies, reads, changes,
        invites and push tickets are not tracked one by one)."""
        ks, uids = set(self.kehilot), set(self.user_ids)
        keys = set(self.items)
        scan = {}
        while True:
            page = self.repo.table.scan(**scan)
            for item in page['Items']:
                pk = item['pk']
                owner = pk.split('#')[1] if '#' in pk else ''
                if (pk.startswith('K#') and owner in ks) or (pk.startswith('U#') and owner in uids) \
                        or (pk.startswith('INV#') and item.get('kehilaId') in ks) \
                        or (pk == 'PUSHTKT' and item.get('userId') in uids):
                    keys.add((pk, item['sk']))
            if 'LastEvaluatedKey' not in page:
                break
            scan['ExclusiveStartKey'] = page['LastEvaluatedKey']
        for pk, sk in keys:
            self.repo.table.delete_item(Key={'pk': pk, 'sk': sk})
        for email in self.users:
            self.idp.admin_delete_user(UserPoolId=self.out['user_pool_id'], Username=email)
        print(f'cleanup: {len(keys)} items, {len(self.users)} users removed')


if __name__ == '__main__':
    smoke = Smoke()
    try:
        smoke.run()
    finally:
        smoke.cleanup()
