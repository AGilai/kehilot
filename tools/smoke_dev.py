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
        self.users, self.items, self.emails = [], [], {}
        self.kehilot, self.user_ids, self.subs = [], [], []

    def make_user(self, label):
        email = f'smoke-{label}+{secrets.token_hex(4)}@example.invalid'
        password = secrets.token_urlsafe(18)
        pool = self.out['user_pool_id']
        self.idp.admin_create_user(UserPoolId=pool, Username=email, MessageAction='SUPPRESS',
                                   UserAttributes=[{'Name': 'email', 'Value': email},
                                                   {'Name': 'email_verified', 'Value': 'true'}])
        self.users.append(email)
        self.emails[label] = email
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
        status, me = self.call(token, 'GET', '/v1/me')
        expect(f'me_{label}', status == 200, str(status))
        user_id = me['userId']
        self.user_ids.append(user_id)
        status, _ = self.call(token, 'PUT', '/v1/me/profile', {'firstName': first, 'lastName': last, 'lang': 'en'})
        expect(f'profile_saved_{label}', status == 200, str(status))
        return token, user_id

    def run(self):
        self.started_ms = int(time.time() * 1000)
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
        self.check_cors()
        self.check_import()
        self.check_revoke_on_leave()
        self.check_listener_cap()
        self.check_push_pipeline()
        self.check_account_deletion()

    def check_invite_flow(self):
        """Admin CLI creates a Kehila; gabbai, a family and a listener join through invites."""
        self.k, gabbai_code = create_kehila(self.repo, 'Smoke Community', 'en', dev=True)
        self.kehilot.append(self.k)
        k = self.k
        self.gab, self.gab_id = self.person('gab', 'Smoke', 'Gabbai')
        status, body = http(f'{self.api}/v1/invites/{gabbai_code}')  # public: no Authorization header
        expect('invite_preview_public', status == 200 and body.get('kehilaName') == 'Smoke Community'
               and body.get('role') == 'gabbai' and set(body) == {'kehilaName', 'role', 'expiresAt'}, f'{status} {body}')
        expect('invite_preview_unknown', http(f'{self.api}/v1/invites/NOSUCHCODE')[0] == 404)
        expect('invite_accept_needs_auth',
               http(f'{self.api}/v1/invites/{gabbai_code}/accept', method='POST', body={})[0] == 401)
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

    def feed_until(self, token, since, kind, timeout=10):
        """Poll the feed until `kind` appears (the positive control), then return its changes."""
        deadline = time.time() + timeout
        while True:
            body = self.feed(token, since)
            if any(c['kind'] == kind for c in body['changes']) or time.time() > deadline:
                return body
            time.sleep(1.5)

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
        fam_feed = self.feed_until(self.people['fam1'][0], self.cursors['fam1'], 'message')
        lis_feed = self.feed(self.people['lis'][0], self.cursors['lis'])  # after the positive control
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
        gab_kinds = {c['kind'] for c in self.feed_until(self.gab, self.cursors['gab'], 'reply_count')['changes']}
        fam_kinds = {c['kind'] for c in self.feed_until(fam1, self.cursors['fam1'], 'reply')['changes']}
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

    def check_cors(self):
        request = urllib.request.Request(
            f'{self.api}/v1/me', method='OPTIONS',
            headers={'Origin': 'http://localhost:8081', 'Access-Control-Request-Method': 'GET',
                     'Access-Control-Request-Headers': 'authorization'})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                status, headers = response.status, response.headers
        except urllib.error.HTTPError as error:
            status, headers = error.code, error.headers
        expect('cors_preflight_localhost', status == 204
               and headers.get('access-control-allow-origin') == 'http://localhost:8081'
               and 'authorization' in (headers.get('access-control-allow-headers') or '').lower(),
               f'{status} {dict(headers)}')
        print('PASS  check_cors')

    def user_state(self, email):
        user = self.idp.admin_get_user(UserPoolId=self.out['user_pool_id'], Username=email)
        attrs = {a['Name']: a['Value'] for a in user['UserAttributes']}
        return user['UserStatus'], attrs.get('email_verified'), attrs['sub']

    def check_import(self):
        """Two invented rows: one new, one UNCONFIRMED self-sign-up. Both end CONFIRMED and verified."""
        pool, k = self.out['user_pool_id'], self.k
        new_email = f'smoke-imp-new+{secrets.token_hex(4)}@example.invalid'
        old_email = f'smoke-imp-old+{secrets.token_hex(4)}@example.invalid'
        old_password = secrets.token_urlsafe(18) + 'aA1!'
        self.users += [new_email, old_email]
        self.idp.sign_up(ClientId=self.out['app_client_id'], Username=old_email, Password=old_password,
                         UserAttributes=[{'Name': 'email', 'Value': old_email}])
        expect('import_precondition_unconfirmed', self.user_state(old_email)[0] == 'UNCONFIRMED')
        rows = [{'email': new_email, 'firstName': 'Dana', 'lastName': 'Example', 'role': 'member'},
                {'email': old_email.upper(), 'firstName': 'Noam', 'lastName': 'Bedayon', 'role': 'listener'}]
        status, body = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/admin/import', {'rows': rows})
        expect('import_ok', status == 200 and [r['status'] for r in body['results']] == ['created', 'added'],
               f'{status} {body}')
        for email in (new_email, old_email):
            state, verified, sub = self.user_state(email)
            self.subs.append(sub)
            expect('import_confirmed_and_verified', (state, verified) == ('CONFIRMED', 'true'), f'{state} {verified}')
        try:
            self.idp.admin_initiate_auth(UserPoolId=pool, ClientId=self.out['smoke_client_id'],
                                         AuthFlow='ADMIN_USER_PASSWORD_AUTH',
                                         AuthParameters={'USERNAME': old_email, 'PASSWORD': old_password})
            worked = True
        except self.idp.exceptions.NotAuthorizedException:
            worked = False
        expect('import_original_password_rejected', not worked)
        status, again = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/admin/import', {'rows': rows})
        expect('reimport_exists', status == 200 and [r['status'] for r in again['results']] == ['exists', 'exists'],
               f'{status} {again}')
        print('PASS  check_import')

    def check_revoke_on_leave(self):
        """A member's listener links stop working when they leave."""
        k = self.k
        status, body = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/invites', {'role': 'member', 'uses': 1, 'days': 1})
        expect('member_invite_for_leaver', status == 201, f'{status} {body}')
        token, _ = self.person('leaver', 'Leah', 'Leaver')
        status, body = self.call(token, 'POST', f'/v1/invites/{body["code"]}/accept')
        expect('leaver_joined_as_member', (status, body.get('role')) == (200, 'member'), f'{status} {body}')
        status, body = self.call(token, 'POST', f'/v1/kehilot/{k}/invites', {})
        expect('leaver_creates_link', status == 201, f'{status} {body}')
        code = body['code']
        expect('link_works_before_leave', http(f'{self.api}/v1/invites/{code}')[0] == 200)
        status, _ = self.call(token, 'DELETE', f'/v1/kehilot/{k}/membership')
        expect('leaver_left', status == 204, str(status))
        status, _ = http(f'{self.api}/v1/invites/{code}')
        expect('link_dead_after_leave', status in (404, 410), str(status))
        print('PASS  check_revoke_on_leave')

    def check_listener_cap(self):
        """maxListeners=1 and the smoke Kehila already has one listener: the next one gets 409 kehila_full."""
        k = self.k
        status, body = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/invites', {'uses': 5, 'days': 1})
        expect('listener_invite_for_cap', status == 201, f'{status} {body}')
        code = body['code']
        token, _ = self.person('capped', 'Cap', 'Listener')
        try:
            status, _ = self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/admin/settings', {'maxListeners': 1})
            expect('max_listeners_set', status == 200, str(status))
            status, body = self.call(token, 'POST', f'/v1/invites/{code}/accept')
            expect('listener_cap_409', (status, body) == (409, {'error': 'kehila_full'}), f'{status} {body}')
        finally:
            self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/admin/settings', {'maxListeners': 500})
        print('PASS  check_listener_cap')

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
        deadline, trail, zeros = time.time() + 90, [], 0
        while time.time() < deadline:
            time.sleep(3)
            depth = self.queue_depth(urls['push'])
            trail.append(depth)
            zeros = zeros + 1 if depth == 0 else 0
            if zeros >= 2 and not self.repo.list_devices(fam[1]):
                break
        dropped = not self.repo.list_devices(fam[1])
        print(f'INFO  queue depth polls: {trail}')
        if zeros < 2 or not dropped:
            self.diagnose(urls, start_ms)
        expect('push_queue_drained', zeros >= 2, f'depth trail {trail}')
        # The worker deletes the fake token on DeviceNotRegistered: proves queue, worker, SSM decrypt and Expo.
        expect('push_token_dropped', dropped, 'fake token still registered after 90 s')
        expect('push_dlq_empty', self.queue_depth(urls['push-dlq']) == 0)
        group = '/aws/lambda/kehilot-dev-push-worker'
        time.sleep(5)  # let the worker's log lines reach CloudWatch
        # First page only: the worker is quiet, so a handful of events is all there can be.
        errors = self.logs.filter_log_events(logGroupName=group, startTime=self.started_ms - 30_000,
                                             filterPattern='ERROR')['events']
        expect('push_worker_no_errors_since_start', not errors, '; '.join(e['message'].strip()[:300] for e in errors[:3]))
        ran = self.logs.filter_log_events(logGroupName=group, startTime=start_ms, filterPattern='"START RequestId"')['events']
        print(f"INFO  worker invocations since publish (diagnostic): {len(ran)}")
        print('PASS  check_push_pipeline')

    def items_of_user(self, user_id):
        """Items whose pk, sk, gsi1pk or gsi1sk carries the user id, or whose userId attribute is it (full scan)."""
        found, scan = [], {}
        while True:
            page = self.repo.table.scan(ConsistentRead=True, **scan)
            for item in page['Items']:
                if item.get('userId') == user_id or any(user_id in item.get(f, '') for f in ('pk', 'sk', 'gsi1pk', 'gsi1sk')):
                    found.append((item['pk'], item['sk']))
            if 'LastEvaluatedKey' not in page:
                return found
            scan['ExclusiveStartKey'] = page['LastEvaluatedKey']

    def check_account_deletion(self):
        """DELETE /v1/me for one user: proves the API's Scan and AdminDeleteUser permissions against AWS."""
        email, (token, user_id) = self.emails['fam2'], self.people['fam2']
        expect('deletion_target_has_items', bool(self.items_of_user(user_id)))
        status, _ = self.call(token, 'DELETE', '/v1/me')
        expect('delete_account_204', status == 204, str(status))
        try:
            self.idp.admin_get_user(UserPoolId=self.out['user_pool_id'], Username=email)
            gone = False
        except self.idp.exceptions.UserNotFoundException:
            gone = True
        expect('cognito_user_deleted', gone)
        left = self.items_of_user(user_id)
        expect('no_items_left_for_deleted_user', not left, f'{len(left)} items, e.g. {left[:3]}')
        print('PASS  check_account_deletion')

    def diagnose(self, urls, start_ms):
        """Print what explains a push failure: queue state, DLQ depth and the worker's WARNING+ lines."""
        attrs = self.sqs.get_queue_attributes(QueueUrl=urls['push'], AttributeNames=['All'])['Attributes']
        print('DIAG  push queue', {k: v for k, v in attrs.items() if k.startswith('ApproximateNumber')},
              'dlq depth', self.queue_depth(urls['push-dlq']))
        try:
            events = self.logs.filter_log_events(logGroupName='/aws/lambda/kehilot-dev-push-worker',
                                                 startTime=start_ms,
                                                 filterPattern='?WARNING ?ERROR ?"Task timed out"')['events']
        except Exception as error:
            print('DIAG  could not read worker logs:', type(error).__name__)
            return
        for event in events[:10]:
            print('DIAG  worker log:', event['message'].strip()[:300])

    def delete_items(self):
        ks, uids = set(self.kehilot), set(self.user_ids)
        for sub in self.subs:  # a user whose /v1/me failed has a SUB row but no tracked id
            try:
                uid = self.repo.get_user_id(sub)
                if uid:
                    uids.add(uid)
            except Exception as error:
                print('cleanup: user id lookup failed', type(error).__name__)
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
        removed = 0
        for pk, sk in sorted(keys, key=lambda key: key[0] == 'PUSHTKT'):  # push tickets last
            try:
                self.repo.table.delete_item(Key={'pk': pk, 'sk': sk})
                removed += 1
            except Exception as error:
                print('cleanup: delete failed', type(error).__name__)
        return removed

    def cleanup(self):
        """Delete everything this run made, found by scanning for its IDs. Every step continues on failure and
        the Cognito users are deleted last, in a finally, so one error never leaves the pool dirty."""
        removed, users = 0, 0
        try:
            removed = self.delete_items()
        except Exception as error:
            print('cleanup: item cleanup failed', type(error).__name__)
        finally:
            for email in self.users:
                try:
                    self.idp.admin_delete_user(UserPoolId=self.out['user_pool_id'], Username=email)
                    users += 1
                except self.idp.exceptions.UserNotFoundException:
                    users += 1
                except Exception as error:
                    print('cleanup: user delete failed', type(error).__name__)
        print(f'cleanup: {removed} items, {users} users removed')


if __name__ == '__main__':
    smoke = Smoke()
    try:
        smoke.run()
    finally:
        smoke.cleanup()
