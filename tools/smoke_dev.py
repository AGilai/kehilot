"""End-to-end check of the deployed dev environment. Usage: .venv/bin/python tools/smoke_dev.py

Creates throwaway Cognito users and Kehilot, checks health, auth rejection, sign-in, tenant isolation, the
invite and membership flow, message visibility, private replies, device routes and the push pipeline, then
the media bucket's settings, group channels, conversation channels and image uploads, then deletes everything it
created (also on failure). Also checks the group admin and join-request flow, the chat limit, push texts, member
invite roles, the import (twice) and the served web app. Also checks family links and private replies, the phone list, hidden children, the data export,
"delete my posts" account deletion, and the age and terms consents. Prints one line per check.
"""
import base64
import io
import json
import secrets
import subprocess
import sys
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import boto3
from boto3.dynamodb.conditions import Key
from pyluach import dates as hebdates, hebrewcal

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.cloud import sheet_rules  # noqa: E402
from server.cloud.ids import new_id  # noqa: E402
from server.cloud.repo import Repo  # noqa: E402
from server.cloud.repo_messages import local_date  # noqa: E402
from server.hebrew_calendar import MONTH_NUMBERS, bar_mitzvah_date  # noqa: E402
from tools.kehila_admin import create_kehila  # noqa: E402

MONTH_KEYS = {number: key for key, number in MONTH_NUMBERS.items() if not key.startswith('adar')}
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


def raw(url, method='GET', data=None, headers=None):
    """(status, headers, body) of a plain HTTP request, for S3 URLs: HTTP errors are returned, not raised."""
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


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
        self.s3 = boto3.client('s3', region_name=region)
        self.media_bucket = self.out['media_bucket']
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
        self.outsider = token_b  # a member of another smoke Kehila only

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
        self.check_message_types()
        self.check_role_tags()
        self.check_private_reply()
        self.check_devices()
        self.check_media_bucket_private()
        self.check_group_channel()
        self.check_chat_post()
        self.check_image_roundtrip()
        self.check_cors_preflight()
        self.check_member_invite_role()
        self.check_group_admin_and_requests()
        self.check_chat_limit()
        self.check_push_texts()
        self.check_web_served()
        self.check_import_idempotent()
        self.check_revoke_on_leave()
        self.check_listener_cap()
        self.check_push_pipeline()
        self.check_family_link_and_replies()
        self.check_phone_list_rules()
        self.check_children_hidden()
        self.check_tree()
        self.check_simchas()
        self.check_templates_and_sheet()
        self.check_logo()
        self.check_export()
        self.check_delete_posts()
        self.check_terms_and_age()
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
        expect('one_default_channel', lis_channels == ['announcements'] and set(channels) == {'announcements'},
               f'{lis_channels} {sorted(channels)}')
        self.channels = channels
        time.sleep(HOLD_BACK_SECONDS)  # the baseline cursor must not precede earlier setup changes
        self.cursors = {label: self.cursor(self.people[label][0]) for label in ('fam1', 'fam2', 'lis')}
        self.cursors['gab'] = self.cursor(self.gab)
        status, msg = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/messages', {
            'channelId': channels['announcements']['channelId'], 'type': 'celebration', 'title': 'Smoke mazal tov',
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

    def check_message_types(self):
        """Mazal tov is a type in the main channel: guests see it only when the gabbai allows it; a member with
        broadcast permission posts it unless the rule is gabbaim-only, and can always post a general message."""
        k, lis, fam2 = self.k, self.people['lis'][0], self.people['fam2']
        settings = f'/v1/kehilot/{k}/admin/settings'
        channel = self.channels['announcements']['channelId']
        rule = lambda post, listeners: {'post': post, 'listeners': listeners}
        try:
            status, _ = self.call(self.gab, 'PUT', settings, {'typeRules': {'celebration': rule('broadcasters', True)}})
            expect('type_rules_saved', status == 200, str(status))
            status, _ = self.call(lis, 'GET', f'/v1/kehilot/{k}/messages/{self.msg}')
            expect('listener_sees_mazal_tov_when_allowed', status == 200, str(status))
            self.call(self.gab, 'PUT', settings, {'typeRules': {'celebration': rule('broadcasters', False)}})
            status, _ = self.call(lis, 'GET', f'/v1/kehilot/{k}/messages/{self.msg}')
            expect('listener_hidden_again', status == 404, str(status))

            status, _ = self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/admin/members/{fam2[1]}', {'canBroadcast': True})
            expect('member_broadcast_allowed', status == 200, str(status))
            types = {c['name']: c.get('postableTypes') for c in self.call(fam2[0], 'GET', f'/v1/kehilot/{k}/channels')[1]}
            expect('member_postable_types', set(types.get('announcements') or ()) == {'general', 'celebration', 'condolence'},
                   str(types))
            self.call(self.gab, 'PUT', settings, {'typeRules': {'celebration': rule('management', False)}})
            post = lambda type_: self.call(fam2[0], 'POST', f'/v1/kehilot/{k}/messages', {
                'channelId': channel, 'type': type_, 'title': f'Smoke {type_}', 'body': ''})[0]
            expect('member_mazal_tov_refused_when_gabbaim_only', post('celebration') == 403)
            expect('member_general_posted', post('general') == 201)
        finally:
            self.call(self.gab, 'PUT', settings, {'typeRules': {'celebration': rule('broadcasters', False)}})
            self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/admin/members/{fam2[1]}', {'canBroadcast': False})
        print('PASS  check_message_types')

    def check_role_tags(self):
        """A gabbai creates a tag, assigns it, the person sees it; deleting it removes it from everyone."""
        k, fam1 = self.k, self.people['fam1']
        status, tag = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/admin/tags', {'name': 'Smoke tag'})
        expect('tag_created', status == 201, str(status))
        try:
            status, _ = self.call(fam1[0], 'POST', f'/v1/kehilot/{k}/admin/tags', {'name': 'Nope'})
            expect('member_cannot_create_tag', status == 403, str(status))
            status, body = self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/admin/members/{fam1[1]}/tags',
                                     {'tagIds': [tag['tagId']]})
            expect('tag_assigned', status == 200 and [t['tagId'] for t in body['tags']] == [tag['tagId']], str(status))
            mine = self.call(fam1[0], 'GET', f'/v1/kehilot/{k}')[1].get('tags')
            expect('person_sees_own_tag', [t['tagId'] for t in mine or ()] == [tag['tagId']], str(mine))
        finally:
            status, _ = self.call(self.gab, 'DELETE', f'/v1/kehilot/{k}/admin/tags/{tag["tagId"]}')
        mine = self.call(fam1[0], 'GET', f'/v1/kehilot/{k}')[1].get('tags')
        expect('tag_deleted_everywhere', status == 204 and not mine, f'{status} {mine}')
        print('PASS  check_role_tags')

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

    def check_media_bucket_private(self):
        bucket = self.media_bucket
        block = self.s3.get_public_access_block(Bucket=bucket)['PublicAccessBlockConfiguration']
        expect('media_public_access_blocked', len(block) == 4 and all(block.values()), str(block))
        rules = self.s3.get_bucket_encryption(Bucket=bucket)['ServerSideEncryptionConfiguration']['Rules']
        expect('media_encrypted_aes256', [r['ApplyServerSideEncryptionByDefault']['SSEAlgorithm'] for r in rules]
               == ['AES256'], str(rules))
        lifecycle = self.s3.get_bucket_lifecycle_configuration(Bucket=bucket)['Rules']
        up = [r for r in lifecycle if r.get('Filter', {}).get('Prefix') == 'up/']
        expect('media_up_prefix_expires', len(up) == 1 and up[0]['Status'] == 'Enabled'
               and up[0]['Expiration']['Days'] == 1, str(lifecycle))
        url = f'https://{bucket}.s3.{self.out["region"]}.amazonaws.com/m/{self.k}/{new_id()}'
        status = raw(url)[0]
        expect('media_unsigned_get_403', status == 403, str(status))
        print('PASS  check_media_bucket_private')

    def check_group_channel(self):
        """A channel limited to a group is invisible to a member outside it until the member is put in the group."""
        k, fam2 = self.k, self.people['fam2']
        status, group = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/admin/groups', {'name': f'Smoke group {secrets.token_hex(2)}'})
        expect('group_created', status == 201 and group['groupId'], f'{status} {group}')
        status, channel = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/admin/channels', {
            'name': 'smoke-group-channel', 'listenersCanRead': False, 'postPolicy': 'management',
            'groups': [group['groupId']]})
        expect('group_channel_created', status == 201 and channel['channelId'], f'{status} {channel}')
        status, msg = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/messages', {
            'channelId': channel['channelId'], 'type': 'weekly', 'title': 'Smoke group notice', 'body': ''})
        expect('group_message_posted', status == 201, f'{status} {msg}')
        path = f'/v1/kehilot/{k}/messages/{msg["messageId"]}'
        status, _ = self.call(fam2[0], 'GET', path)
        expect('outside_member_get_404', status == 404, str(status))
        status, _ = self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/admin/members/{fam2[1]}', {'groups': [group['groupId']]})
        expect('member_put_into_group', status == 200, str(status))
        status, _ = self.call(fam2[0], 'GET', path)
        expect('group_member_get_200', status == 200, str(status))
        print('PASS  check_group_channel')

    def check_chat_post(self):
        """A member without canBroadcast posts in a conversation channel."""
        k, fam1 = self.k, self.people['fam1']
        status, channel = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/admin/channels', {
            'name': 'smoke-chat', 'listenersCanRead': False, 'postPolicy': 'management', 'conversation': True})
        expect('chat_channel_created', status == 201 and channel['channelId'], f'{status} {channel}')
        status, msg = self.call(fam1[0], 'POST', f'/v1/kehilot/{k}/messages', {
            'channelId': channel['channelId'], 'body': 'Smoke hello'})
        expect('chat_posted_without_broadcast_right', status == 201 and msg['type'] == 'chat', f'{status} {msg}')
        print('PASS  check_chat_post')

    def check_image_roundtrip(self):
        k, channel = self.k, self.channels['announcements']['channelId']
        jpeg = b'\xff\xd8\xff' + secrets.token_bytes(61)
        status, grant = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/uploads', {
            'channelId': channel, 'contentType': 'image/jpeg', 'bytes': len(jpeg)})
        expect('image_grant', status == 201 and grant['method'] == 'PUT', f'{status} {grant}')
        status = raw(grant['url'], 'PUT', jpeg, {'Content-Type': 'image/jpeg'})[0]
        expect('image_put_jpeg_200', status == 200, str(status))
        status = raw(grant['url'], 'PUT', jpeg, {'Content-Type': 'image/png'})[0]
        expect('image_put_wrong_type_403', status == 403, str(status))
        status, msg = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/messages', {
            'channelId': channel, 'type': 'weekly', 'title': 'Smoke image', 'body': '',
            'imageUploadId': grant['uploadId']})
        expect('image_attached', status == 201 and msg.get('image', {}).get('contentType') == 'image/jpeg',
               f'{status} {msg}')
        path = f'/v1/kehilot/{k}/messages/{msg["messageId"]}'
        status, view = self.call(self.gab, 'GET', f'{path}/image')
        expect('image_url_granted', status == 200 and view['url'], f'{status} {view}')
        status, headers, body = raw(view['url'])
        expect('image_fetched', status == 200 and headers.get('content-type') == 'image/jpeg' and body == jpeg,
               f'{status} {headers.get("content-type")}')
        status, _ = self.call(self.gab, 'DELETE', path)
        expect('image_message_removed', status == 204, str(status))
        status = raw(view['url'])[0]
        expect('image_gone_after_removal', status in (403, 404), str(status))
        status, headers, _ = raw(grant['url'].split('?')[0], 'OPTIONS', headers={
            'Origin': 'http://localhost:8081', 'Access-Control-Request-Method': 'PUT',
            'Access-Control-Request-Headers': 'content-type'})
        expect('media_cors_preflight', status == 200 and headers.get('access-control-allow-origin')
               == 'http://localhost:8081', f'{status} {dict(headers)}')
        print('PASS  check_image_roundtrip')

    def check_cors_preflight(self):
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
        print('PASS  check_cors_preflight')

    def check_member_invite_role(self):
        """A gabbai makes a member invite; a plain member may not; bad roles are refused; the preview shows the role."""
        k = self.k
        status, body = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/invites', {'role': 'member', 'uses': 1, 'days': 1})
        expect('gabbai_member_invite', status == 201 and body['code'], f'{status} {body}')
        status, preview = http(f'{self.api}/v1/invites/{body["code"]}')
        expect('member_invite_preview_role', status == 200 and preview.get('role') == 'member', f'{status} {preview}')
        status, _ = self.call(self.people['fam1'][0], 'POST', f'/v1/kehilot/{k}/invites', {'role': 'member'})
        expect('member_cannot_make_member_invite', status == 403, str(status))
        status, _ = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/invites', {'role': 'gabbai'})
        expect('gabbai_role_invite_refused', status == 400, str(status))
        print('PASS  check_member_invite_role')

    def check_group_admin_and_requests(self):
        """A listener asks to join a group; a member appointed group admin approves; the listener reads the group's
        channel; removal from the group takes it away again."""
        k, lis, adm = self.k, self.people['lis'], self.people['fam1']
        status, group = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/admin/groups', {'name': f'Smoke req {secrets.token_hex(2)}'})
        expect('req_group_created', status == 201, f'{status} {group}')
        g = group['groupId']
        status, channel = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/admin/channels', {
            'name': 'smoke-req-channel', 'listenersCanRead': False, 'postPolicy': 'management', 'groups': [g]})
        expect('req_channel_created', status == 201, f'{status} {channel}')
        status, msg = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/messages', {
            'channelId': channel['channelId'], 'type': 'weekly', 'title': 'Smoke req notice', 'body': ''})
        expect('req_message_posted', status == 201, f'{status} {msg}')
        path = f'/v1/kehilot/{k}/messages/{msg["messageId"]}'
        expect('listener_outside_group_404', self.call(lis[0], 'GET', path)[0] == 404)
        status, _ = self.call(lis[0], 'POST', f'/v1/kehilot/{k}/groups/{g}/requests')
        expect('listener_join_requested', status == 202, str(status))
        status, _ = self.call(adm[0], 'GET', f'/v1/kehilot/{k}/groups/{g}/requests')
        expect('plain_member_cannot_list_requests', status == 403, str(status))
        status, _ = self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/admin/groups/{g}/admins/{adm[1]}')
        expect('member_appointed_group_admin', status == 204, str(status))
        status, pending = self.call(adm[0], 'GET', f'/v1/kehilot/{k}/groups/{g}/requests')
        expect('group_admin_sees_request', status == 200 and [r['userId'] for r in pending] == [lis[1]], f'{status} {pending}')
        status, _ = self.call(adm[0], 'POST', f'/v1/kehilot/{k}/groups/{g}/requests/{lis[1]}/approve')
        expect('group_admin_approved', status == 200, str(status))
        expect('listener_reads_group_channel', self.call(lis[0], 'GET', path)[0] == 200)
        status, _ = self.call(adm[0], 'DELETE', f'/v1/kehilot/{k}/groups/{g}/members/{lis[1]}')
        expect('group_admin_removed_listener', status == 204, str(status))
        expect('listener_group_channel_404_after_removal', self.call(lis[0], 'GET', path)[0] == 404)
        print('PASS  check_group_admin_and_requests')

    def check_chat_limit(self):
        """chatHourlyLimit 1: the second post of a non-admin is 429. Limit 0: a non-admin is forbidden."""
        k, fam1 = self.k, self.people['fam1']
        status, channel = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/admin/channels', {
            'name': 'smoke-limit-chat', 'listenersCanRead': False, 'postPolicy': 'management', 'conversation': True})
        expect('limit_channel_created', status == 201, f'{status} {channel}')
        c = channel['channelId']
        status, _ = self.call(fam1[0], 'PUT', f'/v1/kehilot/{k}/channels/{c}/chat-settings', {'chatHourlyLimit': 1})
        expect('non_admin_cannot_set_limit', status == 403, str(status))
        status, _ = self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/channels/{c}/chat-settings', {'chatHourlyLimit': 1})
        expect('limit_set_to_1', status == 200, str(status))
        post = {'channelId': c, 'body': 'Smoke limit'}
        expect('first_chat_post_201', self.call(fam1[0], 'POST', f'/v1/kehilot/{k}/messages', post)[0] == 201)
        status, body = self.call(fam1[0], 'POST', f'/v1/kehilot/{k}/messages', post)
        expect('second_chat_post_429', (status, body) == (429, {'error': 'rate_limited'}), f'{status} {body}')
        expect('admin_not_limited', self.call(self.gab, 'POST', f'/v1/kehilot/{k}/messages', post)[0] == 201)
        status, _ = self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/channels/{c}/chat-settings', {'chatHourlyLimit': 0})
        expect('limit_set_to_0', status == 200, str(status))
        status, body = self.call(fam1[0], 'POST', f'/v1/kehilot/{k}/messages', post)
        expect('limit_0_non_admin_forbidden', (status, body) == (403, {'error': 'forbidden'}), f'{status} {body}')
        print('PASS  check_chat_limit')

    def check_push_texts(self):
        """The gabbai sets, reads and clears a custom push text; a member is refused; a newline is invalid."""
        k, base = self.k, f'/v1/kehilot/{self.k}/admin/push-texts'
        text = f'Smoke text {secrets.token_hex(2)}'
        status, _ = self.call(self.gab, 'PUT', base, {'key': 'weekly', 'lang': 'en', 'text': text})
        expect('push_text_put', status == 200, str(status))
        status, body = self.call(self.gab, 'GET', base)
        expect('push_text_get', status == 200 and body['custom'].get('weekly', {}).get('en') == text
               and 'weekly' in body['defaults'], f'{status} {str(body)[:200]}')
        member = self.people['fam1'][0]
        expect('push_text_get_member_403', self.call(member, 'GET', base)[0] == 403)
        expect('push_text_put_member_403',
               self.call(member, 'PUT', base, {'key': 'weekly', 'lang': 'en', 'text': 'x'})[0] == 403)
        status, body = self.call(self.gab, 'PUT', base, {'key': 'weekly', 'lang': 'en', 'text': 'line one\nline two'})
        expect('push_text_newline_400', (status, body) == (400, {'error': 'invalid_text'}), f'{status} {body}')
        status, _ = self.call(self.gab, 'PUT', base, {'key': 'weekly', 'lang': 'en', 'text': ''})
        expect('push_text_cleared', status == 200 and not self.call(self.gab, 'GET', base)[1]['custom'], str(status))
        print('PASS  check_push_texts')

    def check_web_served(self):
        """The dev CloudFront serves the app and the privacy page, with no-cache on the entry page and the headers."""
        base = self.out['web_url'].rstrip('/')
        status, headers, body = raw(base + '/')
        expect('web_index_200_no_cache', status == 200 and 'no-cache' in (headers.get('cache-control') or '')
               and b'<div id="root">' in body, f'{status} {headers.get("cache-control")}')
        for name in ('strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy'):
            expect(f'web_header_{name}', bool(headers.get(name)), name)
        status, _, body = raw(base + '/privacy/')
        expect('web_privacy_200', status == 200 and len(body) > 500, str(status))
        print('PASS  check_web_served')

    def join_member(self, label, first, last):
        """A new person who joins the smoke Kehila as a member through a one-use member invite: (token, userId)."""
        k = self.k
        status, body = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/invites', {'role': 'member', 'uses': 1, 'days': 1})
        expect(f'member_invite_for_{label}', status == 201, str(status))
        token, user_id = self.person(label, first, last)
        status, body = self.call(token, 'POST', f'/v1/invites/{body["code"]}/accept')
        expect(f'{label}_joined_as_member', (status, body.get('role')) == (200, 'member'), str(status))
        return token, user_id

    def check_family_link_and_replies(self):
        """Two members link (request, confirm) into one family; a blessing to one gets a reply both partners read and
        the gabbai does not; after the unlink the ex-partner reads none."""
        k = self.k
        (t1, u1), (t2, u2), (t3, _) = (self.join_member('fl1', 'Smoke', 'Alef'), self.join_member('fl2', 'Smoke', 'Bet'),
                                      self.join_member('fl3', 'Smoke', 'Gimel'))
        status, _ = self.call(t1, 'POST', f'/v1/kehilot/{k}/family/requests', {'toUserId': u2})
        expect('family_request_sent', status == 201, str(status))
        status, view = self.call(t2, 'GET', f'/v1/kehilot/{k}/family')
        expect('family_request_received', status == 200 and [r['fromUserId'] for r in view['received']] == [u1],
               str(status))
        status, view = self.call(t2, 'POST', f'/v1/kehilot/{k}/family/requests/{u1}/confirm')
        expect('family_request_confirmed', status == 200 and {a['userId'] for a in view['adults']} == {u1, u2},
               str(status))
        family = view['familyId']
        status, other = self.call(t1, 'GET', f'/v1/kehilot/{k}/family')
        expect('partners_share_family_id', status == 200 and other['familyId'] == family, str(status))
        status, msg = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/messages', {
            'channelId': self.channels['announcements']['channelId'], 'type': 'celebration', 'title': 'Smoke family blessing',
            'body': '', 'targetMemberId': u1})
        expect('family_blessing_posted', status == 201, str(status))
        path = f'/v1/kehilot/{k}/messages/{msg["messageId"]}/replies'
        status, _ = self.call(t3, 'POST', path, {'body': 'Smoke mazal tov'})
        expect('family_third_member_replied', status == 201, str(status))
        for label, token in (('first_partner', t1), ('second_partner', t2)):
            status, replies = self.call(token, 'GET', path)
            expect(f'{label}_reads_reply', status == 200 and [r['body'] for r in replies] == ['Smoke mazal tov'],
                   str(status))
        expect('gabbai_reads_no_reply', self.call(self.gab, 'GET', path) == (200, []))
        status, view = self.call(t2, 'POST', f'/v1/kehilot/{k}/family/unlink')
        expect('family_unlinked', status == 200 and view['familyId'] != family
               and [a['userId'] for a in view['adults']] == [u2], str(status))
        status, replies = self.call(t2, 'GET', path)
        expect('ex_partner_reads_no_reply', (status, replies) == (200, []), str(status))
        status, replies = self.call(t1, 'GET', path)
        expect('kept_partner_still_reads_reply', status == 200 and len(replies) == 1, str(status))
        print('PASS  check_family_link_and_replies')

    def phone_list(self, token):
        """(status, parsed phone list of the smoke Kehila)."""
        return self.call(token, 'GET', f'/v1/kehilot/{self.k}/phone-list')

    def check_phone_list_rules(self):
        """A member's number shows to another member only while the switch is on; a listener gets 403, a member of
        another Kehila 404."""
        k = self.k
        self.ph_a = self.join_member('pha', 'Smoke', 'Phonea')
        self.ph_b = self.join_member('phb', 'Smoke', 'Phoneb')
        (ta, ua), tb = self.ph_a, self.ph_b[0]
        phone = '+97250' + ''.join(secrets.choice('0123456789') for _ in range(7))
        status, body = self.call(ta, 'PUT', '/v1/me/phone', {'phone': phone})
        expect('phone_set', status == 200 and body == {'phone': phone}, str(status))
        status, _ = self.call(ta, 'PUT', f'/v1/kehilot/{k}/me/phone-list', {'show': True})
        expect('phone_switch_on', status == 200, str(status))
        status, rows = self.phone_list(tb)
        shown = [p['phone'] for r in rows or [] for p in r['people'] if p['userId'] == ua] if status == 200 else []
        expect('member_sees_phone', shown == [phone], str(status))
        expect('listener_phone_list_403', self.phone_list(self.people['lis'][0])[0] == 403)
        expect('other_kehila_phone_list_404', self.phone_list(self.outsider)[0] == 404)
        status, _ = self.call(ta, 'PUT', f'/v1/kehilot/{k}/me/phone-list', {'show': False})
        expect('phone_switch_off', status == 200, str(status))
        status, rows = self.phone_list(tb)
        expect('phone_gone_at_once', status == 200 and not any(p['userId'] == ua for r in rows for p in r['people']),
               str(status))
        print('PASS  check_phone_list_rules')

    def check_children_hidden(self):
        """A child added to a family shows in neither the phone list nor the family picker (no key, no name)."""
        k = self.k
        (ta, ua), tb = self.ph_a, self.ph_b[0]
        child = 'Kid' + secrets.token_hex(4)
        status, _ = self.call(ta, 'POST', f'/v1/kehilot/{k}/family/children', {'firstName': child, 'gender': 'm'})
        expect('child_added', status == 201, str(status))
        status, _ = self.call(ta, 'PUT', f'/v1/kehilot/{k}/me/phone-list', {'show': True})
        expect('child_check_switch_on', status == 200, str(status))
        try:
            status, rows = self.phone_list(tb)
            text = json.dumps(rows)
            expect('phone_list_has_family', status == 200 and ua in text, str(status))  # positive control
            expect('phone_list_hides_children', '"children"' not in text and child not in text)
            channel = self.channels['announcements']['channelId']
            status, rows = self.call(tb, 'GET', f'/v1/kehilot/{k}/families?channelId={channel}')
            text = json.dumps(rows)
            expect('picker_has_family', status == 200 and any(r['targetMemberId'] == ua for r in rows), str(status))
            expect('picker_hides_children', '"children"' not in text and child not in text)
        finally:
            self.call(ta, 'PUT', f'/v1/kehilot/{k}/me/phone-list', {'show': False})
        print('PASS  check_children_hidden')

    @staticmethod
    def hebrew_of(day, years_back=0):
        """A tree HebDate {day, month, year} of a Gregorian date (the year moved back by `years_back`)."""
        hd = hebdates.HebrewDate.from_pydate(day)
        leap = hebrewcal.Year(hd.year).leap
        key = {12: 'adar_i' if leap else 'adar', 13: 'adar_ii'}.get(hd.month) or MONTH_KEYS[hd.month]
        return {'day': hd.day, 'month': key, 'year': hd.year - years_back}

    def check_tree(self):
        """The family tree: save with server-assigned ids, stale version, ill and deceased, the account figure, other
        families, gabbai read-only, listener refused. Only smoke families, invented names."""
        k = self.k
        t1, u1 = self.join_member('tr1', 'ניסיון', 'דוגמה')
        t2, _ = self.join_member('tr2', 'ניסיון', 'אחר')
        path = f'/v1/kehilot/{k}/family/tree'
        status, body = self.call(t1, 'GET', path)
        expect('tree_member_get', status == 200 and isinstance(body.get('people'), list) and body.get('version', 0) >= 1
               and 'updatedAt' in body, f'{status} {body}')
        v0 = body['version']
        today = date.fromisoformat(local_date())
        saturday = today + timedelta(days=(5 - today.weekday()) % 7 + 70)
        person = lambda id_, relation, gender, first, **extra: {'id': id_, 'relation': relation, 'gender': gender,
                                                               'hebrewFirst': first, 'surname': 'דוגמה', **extra}
        people = [
            person('me', 'self', 'm', 'ניסיון'),
            person('wife', 'spouse', 'f', 'דוגמה', of='me', figure={'headCovering': 'tichel', 'skin': 1}),
            person('dad', 'father', 'm', 'אב', of='me', deceased=True, birth=self.hebrew_of(date(1950, 3, 1)),
                   death=self.hebrew_of(date(2015, 5, 1))),
            person('mom', 'mother', 'f', 'אם', of='me', ill=True),
            person('son', 'child', 'm', 'בן', of='me', birth=self.hebrew_of(today.replace(year=today.year - 10)),
                   barMitzvah={'date': saturday.isoformat(), 'parasha': '', 'manual': False}),
        ]
        status, saved = self.call(t1, 'PUT', path, {'people': people, 'ifVersion': v0})
        me = next((p for p in saved.get('people', []) if p['id'] == 'me'), {}) if status == 200 else {}
        expect('tree_put_ok', status == 200 and saved['version'] > v0 and saved.get('updatedAt')
               and len(saved['people']) == 5 and me.get('userId') == u1, f'{status} {saved}')
        son = next(p for p in saved['people'] if p['id'] == 'son')
        mom = next(p for p in saved['people'] if p['id'] == 'mom')
        expect('tree_suggested_bar_mitzvah_stored', son.get('barMitzvah', {}).get('manual') is False
               and son['barMitzvah']['date'] == saturday.isoformat() and mom.get('ill') is True, str(son))
        status, again = self.call(t1, 'GET', path)
        expect('tree_get_matches_put', status == 200 and again['version'] == saved['version']
               and again['people'] == saved['people'], str(status))
        status, body = self.call(t1, 'PUT', path, {'people': people, 'ifVersion': v0})
        expect('tree_stale_version_409', (status, body) == (409, {'error': 'version_conflict'}), f'{status} {body}')
        current = saved['version']
        ill_dead = [dict(p, ill=True, deceased=True) if p['id'] == 'dad' else p for p in saved['people']]
        status, body = self.call(t1, 'PUT', path, {'people': ill_dead, 'ifVersion': current})
        expect('tree_ill_with_deceased_400', (status, body) == (400, {'error': 'invalid_ill'}), f'{status} {body}')
        no_self = [dict(p, id='me2') if p['id'] == 'me' else dict(p, of='me2') if p.get('of') == 'me' else p
                   for p in saved['people']]
        status, body = self.call(t1, 'PUT', path, {'people': no_self, 'ifVersion': current})
        expect('tree_account_figure_400', (status, body) == (400, {'error': 'account_figure'}), f'{status} {body}')
        status, other = self.call(t2, 'GET', path)
        expect('tree_other_family_not_shown', status == 200 and 'son' not in json.dumps(other)
               and other['people'] != saved['people'], str(status))
        admin = f'/v1/kehilot/{k}/admin/families/{self.family_of(t1)}/tree'
        status, _ = self.call(t2, 'GET', admin)
        expect('tree_other_member_admin_read_refused', status in (403, 404), str(status))
        status, body = self.call(self.gab, 'GET', admin)
        expect('tree_gabbai_reads', status == 200 and body['people'] == saved['people'], str(status))
        status, _ = self.call(self.gab, 'PUT', admin, {'people': saved['people'], 'ifVersion': current})
        expect('tree_gabbai_cannot_write', status == 405, str(status))
        status, _ = self.call(self.people['lis'][0], 'GET', path)
        expect('tree_listener_get_refused', status == 403, str(status))
        status, _ = self.call(self.people['lis'][0], 'PUT', path, {'people': people, 'ifVersion': 1})
        expect('tree_listener_put_refused', status == 403, str(status))
        status, _ = self.call(self.people['lis'][0], 'GET', admin)
        expect('tree_listener_admin_read_refused', status == 403, str(status))
        print('PASS  check_tree')

    def family_of(self, token):
        return self.call(token, 'GET', f'/v1/kehilot/{self.k}/family')[1]['familyId']

    def check_templates_and_sheet(self):
        """A member's templated mazal tov waits on the weekly sheet until a gabbai approves it, then a listener who may
        see celebrations gets it; a templated condolence update with `notify` notifies once, the second within 12 h not."""
        k, lis, fam2 = self.k, self.people['lis'][0], self.people['fam2']
        settings = f'/v1/kehilot/{k}/admin/settings'
        channel = self.channels['announcements']['channelId']
        rule = lambda post, listeners: {'post': post, 'listeners': listeners}
        week = sheet_rules.week_for_post(datetime.now(timezone.utc), 'celebration', None).isoformat()
        sheet = f'/v1/kehilot/{k}/sheet/{week}'
        try:
            self.call(self.gab, 'PUT', settings, {'typeRules': {'celebration': rule('broadcasters', True)}})
            self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/admin/members/{fam2[1]}', {'canBroadcast': True})
            status, msg = self.call(fam2[0], 'POST', f'/v1/kehilot/{k}/messages', {
                'channelId': channel, 'type': 'celebration', 'title': 'Smoke mazal tov', 'body': '', 'templateId': 'mazal',
                'fields': {'occasion': 'birthSon', 'whose': 'parents', 'surname': 'ניסיון'}})
            expect('template_mazal_posted_by_member', status == 201 and msg.get('templateId') == 'mazal', f'{status} {msg}')
            status, listed = self.call(self.gab, 'GET', sheet)
            mine = [i for i in listed['items'] if i.get('messageId') == msg.get('messageId')] if status == 200 else []
            expect('sheet_item_pending_for_gabbai', len(mine) == 1 and mine[0]['state'] == 'pending', f'{status} {mine}')
            status, listed = self.call(lis, 'GET', sheet)
            expect('sheet_pending_hidden_from_listener', status == 200
                   and not [i for i in listed['items'] if i.get('messageId') == msg.get('messageId')], str(status))
            status, _ = self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/admin/sheet/{week}/items/{msg.get("messageId")}',
                                  {'state': 'in'})
            expect('sheet_item_approved', status == 200, str(status))
            status, listed = self.call(lis, 'GET', sheet)
            seen = [i for i in listed['items'] if i.get('messageId') == msg.get('messageId')] if status == 200 else []
            expect('sheet_approved_visible_to_listener', len(seen) == 1 and seen[0]['state'] == 'in', f'{status} {seen}')

            fields = {'variant': 'only', 'surname': 'דוגמה', 'deceased': 'יוסף', 'relation': 'אביו'}
            status, cond = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/messages', {
                'channelId': channel, 'type': 'condolence', 'title': 'Smoke condolence', 'body': '',
                'templateId': 'condolence', 'fields': fields})
            expect('template_condolence_posted', status == 201, f'{status} {cond}')
            path = f'/v1/kehilot/{k}/messages/{cond.get("messageId")}'
            update = lambda: self.call(self.gab, 'PUT', path, {
                'title': 'Smoke condolence', 'body': '', 'fields': {**fields, 'relation': 'אמו'}, 'notify': True})
            status, first = update()
            expect('update_notify_notifies', status == 200 and first.get('notified') is True, f'{status} {first}')
            status, second = update()
            expect('update_notify_second_is_quiet', status == 200 and second.get('notified') is False, f'{status} {second}')
        finally:
            self.call(self.gab, 'PUT', settings, {'typeRules': {'celebration': rule('broadcasters', False)}})
            self.call(self.gab, 'PUT', f'/v1/kehilot/{k}/admin/members/{fam2[1]}', {'canBroadcast': False})
        print('PASS  check_templates_and_sheet')

    @staticmethod
    def png(side):
        """A flat grey square PNG of the given side (64 px is the smallest the API takes)."""
        def chunk(kind, data):
            return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
        raw = b''.join(b'\x00' + b'\x80' * (side * 3) for _ in range(side))
        return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', side, side, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))

    def check_logo(self):
        """The gabbai uploads and removes the Kehila logo; a member may not."""
        k, member = self.k, self.people['fam1'][0]
        path = f'/v1/kehilot/{k}/admin/logo'
        body = {'data': base64.b64encode(self.png(64)).decode()}
        status, _ = self.call(member, 'PUT', path, body)
        expect('logo_member_403', status == 403, str(status))
        status, put = self.call(self.gab, 'PUT', path, body)
        expect('logo_uploaded', status == 200 and put.get('logoVersion'), f'{status}')
        status, got = self.call(self.gab, 'GET', f'/v1/kehilot/{k}/logo')
        expect('logo_served', status == 200 and got.get('logoVersion') == put.get('logoVersion'), str(status))
        status, shown = self.call(self.gab, 'GET', f'/v1/kehilot/{k}')
        expect('logo_info_for_gabbai', status == 200 and (shown.get('logoInfo') or {}).get('side') == 64, str(status))
        status, bad = self.call(self.gab, 'PUT', path, {'data': 'not base64!'})
        expect('logo_bad_base64_400', (status, bad) == (400, {'error': 'invalid_logo_format'}), f'{status} {bad}')
        status, _ = self.call(self.gab, 'DELETE', path)
        expect('logo_removed', status == 204, str(status))
        status, gone = self.call(self.gab, 'GET', f'/v1/kehilot/{k}/logo')
        expect('logo_gone_404', (status, gone) == (404, {'error': 'not_found'}), f'{status} {gone}')
        print('PASS  check_logo')

    def check_simchas(self):
        """The gabbai's simchas list: 8 weeks, members refused, and a son turning 13 (Hebrew) in three weeks shows
        with first name, surname and date only (his birth date is computed backwards from that day)."""
        k = self.k
        today = date.fromisoformat(local_date())
        status, body = self.call(self.gab, 'GET', f'/v1/kehilot/{k}/admin/simchas?weeks=8')
        expect('simchas_gabbai_8_weeks', status == 200 and len(body['weeks']) == 8
               and all({'week', 'shabbat', 'parasha', 'label', 'items'} <= set(w) for w in body['weeks']), f'{status}')
        status, _ = self.call(self.people['fam1'][0], 'GET', f'/v1/kehilot/{k}/admin/simchas?weeks=8')
        expect('simchas_member_403', status == 403, str(status))
        status, _ = self.call(self.people['lis'][0], 'GET', f'/v1/kehilot/{k}/admin/simchas?weeks=8')
        expect('simchas_listener_403', status == 403, str(status))
        status, _ = self.call(self.gab, 'GET', f'/v1/kehilot/{k}/admin/simchas?weeks=99')
        expect('simchas_weeks_validated', status == 400, str(status))
        token, _ = self.join_member('sim', 'ניסיון', 'דוגמה')
        path = f'/v1/kehilot/{k}/family/tree'
        status, tree = self.call(token, 'GET', path)
        expect('simchas_tree_get', status == 200, str(status))
        name = 'ניסיוני' + secrets.token_hex(2)
        target = today + timedelta(days=21)
        birth = self.hebrew_of(target, years_back=13)
        people = [{'id': 'me', 'relation': 'self', 'gender': 'f', 'hebrewFirst': 'דוגמה', 'surname': 'ניסיון'},
                  {'id': 'son', 'relation': 'child', 'of': 'me', 'gender': 'm', 'hebrewFirst': name, 'birth': birth}]
        status, saved = self.call(token, 'PUT', path, {'people': people, 'ifVersion': tree['version']})
        expect('simchas_tree_saved', status == 200, f'{status} {saved}')
        due = bar_mitzvah_date(birth, today)
        status, body = self.call(self.gab, 'GET', f'/v1/kehilot/{k}/admin/simchas?weeks=8')
        items = [i for w in body['weeks'] for i in w['items'] if i['firstName'] == name] if status == 200 else []
        expect('simchas_son_listed', len(items) == 1 and items[0]['kind'] == 'bar' and items[0]['surname'] == 'ניסיון'
               and items[0]['date'] >= due.isoformat() and date.fromisoformat(items[0]['date']) <= due + timedelta(days=6),
               f'{status} {items} due {due}')
        expect('simchas_item_has_no_personal_data', set(items[0]) <= {'kind', 'firstName', 'surname', 'date', 'manual',
                                                                      'label', 'familyId'}, str(sorted(items[0])))
        print('PASS  check_simchas')

    def check_export(self):
        """POST /v1/me/export builds a ZIP with data.json and no other member's name; a second POST re-issues the
        link; the object is under x/<userId>/. Counts and statuses only: no URL or content is printed."""
        token, user_id = self.join_member('exp', 'Smoke', 'Exporter')
        status, body = self.call(token, 'POST', '/v1/me/export')
        expect('export_200', status == 200 and bool(body.get('url')), str(status))
        status, _, data = raw(body['url'])
        expect('export_downloaded', status == 200 and zipfile.is_zipfile(io.BytesIO(data)), str(status))
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = archive.namelist()
            expect('export_has_data_json', 'data.json' in names, f'{len(names)} files')
            text = archive.read('data.json').decode()
        json.loads(text)
        others = [w for w in ('Gabbai', 'Listener', 'Family', 'Phonea', 'Phoneb', 'Alef', 'Bet', 'Gimel') if w in text]
        expect('export_has_no_other_member_name', not others, f'{len(others)} foreign names found')
        status, again = self.call(token, 'POST', '/v1/me/export')
        expect('export_second_post_200', status == 200 and bool(again.get('url')), str(status))
        listing = self.s3.list_objects_v2(Bucket=self.media_bucket, Prefix=f'x/{user_id}/')
        keys = [o['Key'] for o in listing.get('Contents', [])]
        expect('export_object_under_x', len(keys) == 1 and keys[0].endswith('.zip'), f'{len(keys)} objects')
        print('PASS  check_export')

    def check_delete_posts(self):
        """A member posts a chat message with an image, then deletes the account with deletePosts=1: the message is
        gone for others and the image cannot be fetched any more."""
        k = self.k
        token, user_id = self.join_member('del', 'Smoke', 'Deleter')
        status, channel = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/admin/channels', {
            'name': 'smoke-delete-chat', 'listenersCanRead': False, 'postPolicy': 'management', 'conversation': True})
        expect('delete_chat_channel_created', status == 201, str(status))
        c = channel['channelId']
        jpeg = b'\xff\xd8\xff' + secrets.token_bytes(61)
        status, grant = self.call(token, 'POST', f'/v1/kehilot/{k}/uploads', {
            'channelId': c, 'contentType': 'image/jpeg', 'bytes': len(jpeg)})
        expect('delete_image_grant', status == 201, str(status))
        expect('delete_image_put', raw(grant['url'], 'PUT', jpeg, {'Content-Type': 'image/jpeg'})[0] == 200)
        status, msg = self.call(token, 'POST', f'/v1/kehilot/{k}/messages', {
            'channelId': c, 'body': 'Smoke goodbye', 'imageUploadId': grant['uploadId']})
        expect('delete_chat_posted_with_image', status == 201, str(status))
        path = f'/v1/kehilot/{k}/messages/{msg["messageId"]}'
        expect('gabbai_reads_chat_before', self.call(self.gab, 'GET', path)[0] == 200)
        status, view = self.call(self.gab, 'GET', f'{path}/image')
        expect('image_url_before', status == 200 and raw(view['url'])[0] == 200, str(status))
        for attempt in range(3):  # 503 try_again / 500: the same request continues where it stopped
            status, _ = self.call(token, 'DELETE', '/v1/me?deletePosts=1')
            if status == 204:
                break
        expect('delete_with_posts_204', status == 204, str(status))
        expect('message_removed_for_others', self.call(self.gab, 'GET', path)[0] == 404)
        stored = self.repo.get_message(k, msg['messageId'])
        expect('message_text_blanked', bool(stored.get('removed')) and not stored.get('title') and not stored.get('body'))
        status = raw(view['url'])[0]
        expect('image_gone_after_delete_posts', status in (403, 404), str(status))
        print('PASS  check_delete_posts')

    def check_terms_and_age(self):
        """A fresh user needs the age-13 consent until it is given; the gabbai's terms card shows until accepted."""
        token = self.make_user('age')
        status, me = self.call(token, 'GET', '/v1/me')
        expect('age_me_ok', status == 200, str(status))
        self.user_ids.append(me['userId'])
        expect('age13_required_for_fresh_user', me['age13Required'] is True)
        status, _ = self.call(token, 'POST', '/v1/me/consents/age13')
        expect('age13_consent_204', status == 204, str(status))
        status, me = self.call(token, 'GET', '/v1/me')
        expect('age13_not_required_after_consent', status == 200 and me['age13Required'] is False, str(status))
        k = self.k
        status, kehila = self.call(self.gab, 'GET', f'/v1/kehilot/{k}')
        expect('terms_card_before', status == 200 and kehila['cards']['terms'] is True, str(status))
        status, _ = self.call(self.gab, 'POST', f'/v1/kehilot/{k}/admin/terms')
        expect('terms_accepted_200', status == 200, str(status))
        status, kehila = self.call(self.gab, 'GET', f'/v1/kehilot/{k}')
        expect('terms_card_gone_after', status == 200 and kehila['cards']['terms'] is False, str(status))
        print('PASS  check_terms_and_age')

    def user_state(self, email):
        user = self.idp.admin_get_user(UserPoolId=self.out['user_pool_id'], Username=email)
        attrs = {a['Name']: a['Value'] for a in user['UserAttributes']}
        return user['UserStatus'], attrs.get('email_verified'), attrs['sub']

    def check_import_idempotent(self):
        """Two invented rows: one new, one UNCONFIRMED self-sign-up. Both end CONFIRMED and verified. Run twice
        (the second run changes nothing); the Cognito users are deleted by cleanup."""
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
        members = self.call(self.gab, 'GET', f'/v1/kehilot/{k}/admin/members')[1]
        by_id = {m['userId']: m['role'] for m in members}
        imported = sorted(by_id.get(self.repo.get_user_id(self.user_state(e)[2])) or '-' for e in (new_email, old_email))
        expect('reimport_keeps_roles_single', len(by_id) == len(members) and imported == ['listener', 'member'], str(imported))
        print('PASS  check_import_idempotent')

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
            'channelId': self.channels['announcements']['channelId'], 'type': 'weekly', 'title': 'Smoke push', 'body': ''})
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

    def delete_media(self):
        """Delete the smoke Kehilot's m/<k>/ and up/<k>/ objects and the smoke users' x/<userId>/ exports."""
        removed = 0
        prefixes = [p for k in set(self.kehilot) for p in (f'm/{k}/', f'up/{k}/')]
        prefixes += [f'x/{user_id}/' for user_id in set(self.user_ids)]
        for prefix in prefixes:
            keys = []
            for page in self.s3.get_paginator('list_objects_v2').paginate(Bucket=self.media_bucket, Prefix=prefix):
                keys += [{'Key': o['Key']} for o in page.get('Contents', [])]
            for start in range(0, len(keys), 1000):
                self.s3.delete_objects(Bucket=self.media_bucket, Delete={'Objects': keys[start:start + 1000]})
            removed += len(keys)
        return removed

    def cleanup(self):
        """Delete everything this run made, found by scanning for its IDs. Every step continues on failure and
        the Cognito users are deleted last, in a finally, so one error never leaves the pool dirty."""
        removed, users, objects = 0, 0, 0
        try:
            objects = self.delete_media()
        except Exception as error:
            print('cleanup: media cleanup failed', type(error).__name__)
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
        print(f'cleanup: {removed} items, {objects} media objects, {users} users removed')
        try:  # the families (and their trees) live under K#<k>: none may be left
            left = sum(len(self.repo.table.query(KeyConditionExpression=Key('pk').eq(f'K#{k}'), ConsistentRead=True)['Items'])
                       for k in set(self.kehilot))
            print(f"{'PASS' if not left else 'FAIL'}  no_kehila_items_left_after_cleanup" + (f'  {left} items' if left else ''))
        except Exception as error:
            print('cleanup: leftover check failed', type(error).__name__)


if __name__ == '__main__':
    smoke = Smoke()
    try:
        smoke.run()
    finally:
        smoke.cleanup()
