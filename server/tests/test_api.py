import copy
import io
import json
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

from server.app import make_handler
from server.push import process_one
from server.store import Store, token_hash
from server.validation import APIError, DEFAULT_PREFERENCES


PASSWORD = 'test-only-password-123'


class FakeSocket:
    """Run the actual HTTP request parser/handler without opening a network port."""
    def __init__(self, raw):
        self.input = io.BytesIO(raw)
        self.output = bytearray()

    def makefile(self, *args, **kwargs):
        return self.input

    def sendall(self, data):
        self.output.extend(data)

    def settimeout(self, value):
        pass


class CommunityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template_dir = tempfile.TemporaryDirectory()
        cls.template = Path(cls.template_dir.name) / 'template.db'
        store = Store(cls.template)
        cls.member_id = store.create_user('member@example.test', PASSWORD, 'חבר לדוגמה')
        cls.other_id = store.create_user('other@example.test', PASSWORD, 'חבר נוסף')
        cls.gabbai_id = store.create_user('gabbai@example.test', PASSWORD, 'גבאי לדוגמה', 'gabbai')
        # The fixture names are explicit; production never splits a full name.
        with store.db() as db:
            for identifier, first, last in [(cls.member_id, 'חבר', 'לדוגמה'), (cls.other_id, 'חבר', 'נוסף'), (cls.gabbai_id, 'גבאי', 'לדוגמה')]:
                saved = json.loads(db.execute('SELECT profile FROM users WHERE id=?', (identifier,)).fetchone()[0])
                saved.update(firstName=first, lastName=last)
                db.execute('UPDATE users SET profile=? WHERE id=?', (json.dumps(saved), identifier))


    @classmethod
    def tearDownClass(cls):
        cls.template_dir.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        path = Path(self.temp.name) / 'community.db'
        shutil.copyfile(self.template, path)
        self.store = Store(path)
        with self.store.db() as db:
            self.member = dict(db.execute('SELECT * FROM users WHERE id=?', (self.member_id,)).fetchone())
            self.other = dict(db.execute('SELECT * FROM users WHERE id=?', (self.other_id,)).fetchone())
            self.gabbai = dict(db.execute('SELECT * FROM users WHERE id=?', (self.gabbai_id,)).fetchone())
            # Tests seed already-authenticated sessions; dedicated tests cover password login.
            for token, user in [('member-token', self.member), ('other-token', self.other), ('gabbai-token', self.gabbai)]:
                db.execute('INSERT INTO sessions VALUES (?,?,?)', (token_hash(token), user['id'], time.time() + 3600))
        self.handler = make_handler(self.store, ['http://localhost:8081'])

    def tearDown(self):
        self.temp.cleanup()

    def http(self, method, path, body=None, token=None, origin=None, raw=None, extra=None):
        data = raw if raw is not None else json.dumps(body).encode() if body is not None else b''
        headers = {'Host': 'localhost', 'Content-Type': 'application/json', 'Content-Length': str(len(data))}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if origin:
            headers['Origin'] = origin
        headers.update(extra or {})
        request = f'{method} {path} HTTP/1.0\r\n' + ''.join(f'{k}: {v}\r\n' for k, v in headers.items()) + '\r\n'
        sock = FakeSocket(request.encode() + data)
        self.handler(sock, ('127.0.0.1', 1234), SimpleNamespace())
        head, response = bytes(sock.output).split(b'\r\n\r\n', 1)
        status = int(head.split(b' ')[1])
        return status, json.loads(response) if response else {}, head.decode()

    def publish(self, category='celebration'):
        return self.store.publish(self.gabbai, dict(category=category, title='בדיקה', body='הודעת בדיקה', pinned=False))

    def test_health_and_authentication(self):
        self.assertEqual(self.http('GET', '/health')[0], 200)
        self.assertEqual(self.http('GET', '/api/me')[0], 401)
        self.assertEqual(self.http('GET', '/api/me', token='wrong')[0], 401)
        status, state, headers = self.http('GET', '/api/me', token='member-token')
        self.assertEqual(status, 200)
        self.assertEqual(state['profile']['name'], 'חבר לדוגמה')
        self.assertNotIn('password_hash', json.dumps(state))
        self.assertIn('Cache-Control: no-store', headers)

    def test_login_password_and_session_hash(self):
        result = self.store.login('MEMBER@example.test', PASSWORD, '127.0.0.2')
        self.assertEqual(self.store.authenticate(result['token'])['id'], self.member_id)
        with self.store.db() as db:
            self.assertIsNone(db.execute('SELECT * FROM sessions WHERE hash=?', (result['token'],)).fetchone())
        status, _, _ = self.http('POST', '/api/login', dict(email='member@example.test', password='wrong'))
        self.assertEqual(status, 401)

    def test_login_rate_limit(self):
        with self.store.db() as db:
            db.execute('INSERT INTO login_attempts VALUES (?,?,?)', (token_hash('email:member@example.test'), 8, time.time()))
        with self.assertRaises(APIError) as error:
            self.store.login('member@example.test', PASSWORD, 'new-ip')
        self.assertEqual(error.exception.status, 429)

    def test_profile_isolation_and_persistence(self):
        profile = json.loads(self.member['profile'])
        profile.update(tribe='yisrael', torahName='ישראל בן אברהם', wifePrayerName='שרה בת רבקה', birthDate='1980-02-29', barMitzvahParasha='ויקהל־פקודי')
        profile['yahrzeits'] = [dict(id='one', name='אברהם', relationship='father', day=30, month='adar_i', year='5784')]
        self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 200)
        restarted = Store(self.store.path)
        self.assertEqual(restarted.state(self.member)['profile'], profile)
        self.assertEqual(restarted.state(self.other)['profile']['torahName'], '')
        profile['role'] = 'gabbai'
        self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 400)

    def test_invalid_dates_and_yahrzeits(self):
        profile = json.loads(self.member['profile'])
        for invalid in ['2025-02-29', '2100-01-01', '2020-13-01', '20200101']:
            profile['birthDate'] = invalid
            self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 400, invalid)
        profile['birthDate'] = ''
        valid = dict(id='a', name='שם', relationship='sister', day=29, month='adar_ii', year='')
        for patch in [dict(day=30), dict(day=True), dict(day=0), dict(relationship='uncle'), dict(month='bad'), dict(year='9999')]:
            profile['yahrzeits'] = [{**valid, **patch}]
            self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 400, patch)
        profile['yahrzeits'] = [valid, copy.deepcopy(valid)]
        self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 400)

    def test_only_gabbai_can_publish_or_read_member_directory(self):
        body = dict(category='weekly', title='לו״ז', body='בדיקה')
        self.assertEqual(self.http('POST', '/api/admin/messages', body, 'member-token')[0], 403)
        self.assertEqual(self.http('GET', '/api/admin/members', token='member-token')[0], 403)
        self.assertEqual(self.http('GET', '/api/admin/members', token='gabbai-token')[0], 200)
        self.assertEqual(self.http('POST', '/api/admin/messages', body, 'gabbai-token')[0], 201)
        status, messages, _ = self.http('GET', '/api/messages', token='member-token')
        self.assertEqual(status, 200)
        self.assertEqual(len(messages), 1)

    def test_replies_allowed_only_on_celebrations_and_condolences(self):
        for category in ['weekly', 'event', 'celebration', 'condolence']:
            message = self.publish(category)
            status, reply, _ = self.http('POST', f'/api/messages/{message["id"]}/replies', dict(body='מילה מהקהילה'), 'member-token')
            self.assertEqual(status, 201 if category in ['celebration', 'condolence'] else 403)
            if status == 201:
                self.assertEqual(reply['author'], 'חבר לדוגמה')
                # Keep test independent of the anti-spam delay without a sleep.
                with self.store.db() as db:
                    db.execute("UPDATE replies SET created_at='2000-01-01T00:00:00Z'")
        self.assertEqual(self.http('POST', '/api/messages/missing/replies', dict(body='תגובה'), 'member-token')[0], 404)

    def test_reply_validation_and_author_cannot_be_spoofed(self):
        identifier = self.publish()['id']
        for invalid in [dict(body=' '), dict(body='x' * 1001), dict(body='תגובה', author='מישהו אחר')]:
            self.assertEqual(self.http('POST', f'/api/messages/{identifier}/replies', invalid, 'member-token')[0], 400)

    def test_read_status_is_idempotent_and_per_member(self):
        identifier = self.publish()['id']
        for _ in range(2):
            self.assertEqual(self.http('POST', f'/api/messages/{identifier}/read', {}, 'member-token')[0], 200)
        self.assertEqual(self.store.state(self.member)['readIds'], [identifier])
        self.assertEqual(self.store.state(self.other)['readIds'], [])

    def test_preferences_do_not_hide_messages(self):
        self.publish()
        prefs = {k: False for k in DEFAULT_PREFERENCES}
        self.assertEqual(self.http('PUT', '/api/preferences', prefs, 'member-token')[0], 200)
        state = self.store.state(self.member)
        self.assertEqual(state['preferences'], prefs)
        self.assertEqual(len(state['messages']), 1)
        prefs['weekly'] = 'false'
        self.assertEqual(self.http('PUT', '/api/preferences', prefs, 'member-token')[0], 400)

    def test_request_validation_and_cors(self):
        self.assertEqual(self.http('POST', '/api/login', raw=b'{bad')[0], 400)
        self.assertEqual(self.http('POST', '/api/login', raw=b'[]')[0], 400)
        self.assertEqual(self.http('POST', '/api/login', {}, extra={'Content-Length': '999999'})[0], 413)
        self.assertEqual(self.http('POST', '/api/login', {}, extra={'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.http('OPTIONS', '/api/me', origin='https://unknown.test')[0], 403)
        status, _, headers = self.http('OPTIONS', '/api/me', origin='http://localhost:8081')
        self.assertEqual(status, 204)
        self.assertIn('Access-Control-Allow-Origin: http://localhost:8081', headers)

    def test_logout_removes_only_this_device_push_token(self):
        push_token = 'ExpoPushToken[device_token_12345]'
        self.store.set_push_token(self.member, 'member-token', {'token': push_token})
        self.assertEqual(self.http('POST', '/api/logout', {}, 'member-token')[0], 200)
        self.assertEqual(self.http('GET', '/api/me', token='member-token')[0], 401)
        self.assertEqual(self.http('GET', '/api/me', token='other-token')[0], 200)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM push_tokens').fetchone()[0], 0)

    def test_password_reset_revokes_sessions(self):
        self.store.reset_password('member@example.test', 'new-test-password-123')
        self.assertEqual(self.http('GET', '/api/me', token='member-token')[0], 401)
        self.assertEqual(self.store.login('member@example.test', 'new-test-password-123', 'reset-test')['user']['id'], self.member_id)

    def test_expired_session_is_rejected(self):
        with self.store.db() as db:
            db.execute('UPDATE sessions SET expires=0 WHERE hash=?', (token_hash('member-token'),))
        self.assertEqual(self.http('GET', '/api/me', token='member-token')[0], 401)

    def test_push_respects_preferences_and_never_sends_private_content(self):
        self.store.set_push_token(self.member, 'member-token', {'token': 'ExpoPushToken[device_token_12345]'})
        message = self.publish()
        sent = []
        def send(payload):
            sent.extend(payload)
            return {'data': [{'status': 'ok', 'id': 'ticket'} for _ in payload]}
        while process_one(self.store, send):
            pass
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]['data'], {'messageId': message['id']})
        self.assertNotIn('הודעת בדיקה', json.dumps(sent, ensure_ascii=False))
        self.store.save_preferences(self.member, {**DEFAULT_PREFERENCES, 'community': False})
        self.publish()
        while process_one(self.store, send):
            pass
        self.assertEqual(len(sent), 1)

    def test_push_retry_and_invalid_token_cleanup(self):
        self.store.set_push_token(self.member, 'member-token', {'token': 'ExpoPushToken[device_token_12345]'})
        self.publish()
        with self.store.db() as db:
            db.execute('DELETE FROM outbox WHERE user_id!=?', (self.member_id,))
        def failure(payload):
            raise OSError('offline')
        process_one(self.store, failure)
        with self.store.db() as db:
            row = db.execute('SELECT * FROM outbox').fetchone()
            self.assertEqual(row['attempts'], 1)
            self.assertEqual(row['status'], 'pending')
            self.assertGreater(row['available_at'], time.time())
            db.execute('UPDATE outbox SET available_at=0')
        process_one(self.store, lambda payload: {'data': [{'status': 'error', 'details': {'error': 'DeviceNotRegistered'}}]})
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM push_tokens').fetchone()[0], 0)

    def test_reply_notifications_only_go_to_other_participants(self):
        identifier = self.publish()['id']
        with self.store.db() as db:
            db.execute('DELETE FROM outbox')
        self.store.reply(self.member, identifier, {'body': 'מזל טוב'})
        with self.store.db() as db:
            jobs = db.execute('SELECT user_id,preference FROM outbox').fetchall()
            self.assertEqual([(r['user_id'], r['preference']) for r in jobs], [(self.gabbai_id, 'replies')])
            db.execute('DELETE FROM outbox')
        self.store.reply(self.other, identifier, {'body': 'בשמחות'})
        with self.store.db() as db:
            targets = {r['user_id'] for r in db.execute('SELECT user_id FROM outbox')}
            self.assertEqual(targets, {self.gabbai_id, self.member_id})


    @staticmethod
    def family_child(identifier='child-one', gender='son', **changes):
        result = dict(id=identifier, gender=gender, name='ילד לדוגמה', birthDate='2005-10-10', hebrewBirthDate=None, torahName='',
                      barMitzvahParasha='', barMitzvahDate='', married=False,
                      spouseName='', spouseTribe='', spouseTorahName='', spousePrayerName='')
        result.update(changes)
        return result

    def family_profile(self, children):
        result = self.store.state(self.member)['profile']
        result.update(tribe='yisrael', phone='050-1234567', wifePhone='+972501234568', children=children)
        return result

    def test_family_children_have_separate_permanent_person_rows(self):
        son = self.family_child(torahName='יעקב בן ישראל', barMitzvahParasha='נח', barMitzvahDate='2018-10-13')
        daughter = self.family_child('child-two', 'daughter', name='בת לדוגמה', birthDate='2020-05-04')
        profile = self.family_profile([son, daughter])
        status, saved, _ = self.http('PUT', '/api/profile', profile, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual(saved, profile)
        with self.store.db() as db:
            people = db.execute('SELECT id,relationship FROM community_people WHERE owner_user_id=? AND active=1', (self.member_id,)).fetchall()
            self.assertEqual({(r['id'], r['relationship']) for r in people}, {(self.member_id, 'self'), ('child-one', 'son'), ('child-two', 'daughter')})
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0], 3)
            account_json = json.loads(db.execute('SELECT profile FROM users WHERE id=?', (self.member_id,)).fetchone()[0])
            self.assertNotIn('children', account_json)
        son['name'] = 'שם מעודכן'
        son['torahName'] = 'יעקב ישראל בן ישראל'
        status, _, _ = self.http('PUT', '/api/profile', profile, 'member-token')
        self.assertEqual(status, 200)
        restarted = Store(self.store.path)
        self.assertEqual(restarted.state(self.member)['profile'], profile)
        with restarted.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM community_people WHERE owner_user_id=?', (self.member_id,)).fetchone()[0], 3)

    def test_child_identity_survives_edits_archival_and_future_history_references(self):
        child = self.family_child()
        profile = self.family_profile([child])
        self.store.save_profile(self.member, profile)
        with self.store.db() as db:
            # A stand-in foreign key demonstrates future history compatibility;
            # this is deliberately not an implementation of the aliyah schema.
            db.execute('CREATE TABLE test_history (person_id TEXT REFERENCES community_people(id), note TEXT)')
            db.execute('INSERT INTO test_history VALUES (?,?)', (child['id'], 'היסטוריה לדוגמה'))
            created = db.execute('SELECT created_at FROM community_people WHERE id=?', (child['id'],)).fetchone()[0]
        child['birthDate'] = '2005-10-11'
        self.store.save_profile(self.member, profile)
        profile['children'] = []
        self.store.save_profile(self.member, profile)
        self.assertEqual(self.store.state(self.member)['profile']['children'], [])
        with self.store.db() as db:
            row = db.execute('SELECT active,created_at FROM community_people WHERE id=?', (child['id'],)).fetchone()
            self.assertEqual(row['active'], 0)
            self.assertEqual(row['created_at'], created)
            self.assertEqual(db.execute('SELECT person_id FROM test_history').fetchone()[0], child['id'])
        profile['children'] = [child]
        self.store.save_profile(self.member, profile)
        self.assertEqual(self.store.state(self.member)['profile']['children'][0]['id'], child['id'])

    def test_other_family_child_and_own_account_id_cannot_be_claimed(self):
        own = self.family_profile([self.family_child('own-child')])
        self.store.save_profile(self.member, own)
        other_profile = self.store.state(self.other)['profile']
        other_profile['tribe'] = 'yisrael'
        other_profile['children'] = [self.family_child('other-child')]
        self.store.save_profile(self.other, other_profile)
        for identifier in ['other-child', self.member_id, self.other_id]:
            attempted = copy.deepcopy(own)
            attempted['phone'] = '050-9999999'
            attempted['children'].append(self.family_child(identifier))
            self.assertEqual(self.http('PUT', '/api/profile', attempted, 'member-token')[0], 403)
            self.assertEqual(self.store.state(self.member)['profile'], own)
        self.assertNotIn('other-child', json.dumps(self.store.state(self.member), ensure_ascii=False))

    def test_married_children_keep_correct_spouse_names(self):
        values = [
            self.family_child('son', married=True, spouseName='שרה', spousePrayerName='שרה בת רבקה'),
            self.family_child('daughter', 'daughter', married=True, spouseName='יצחק', spouseTribe='levi', spouseTorahName='יצחק בן אברהם'),
        ]
        profile = self.family_profile(values)
        self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 200)
        self.assertEqual(self.store.state(self.member)['profile']['children'], values)
        directory = self.http('GET', '/api/admin/members', token='gabbai-token')[1]
        self.assertEqual(next(r for r in directory if r['id'] == self.member_id)['profile'], profile)

    def test_family_validation_rejects_invalid_and_spoofed_values(self):
        patches = [dict(name=' '), dict(birthDate=''), dict(birthDate='2025-02-29'), dict(birthDate='2100-01-01'),
                   dict(gender='unknown'), dict(married='true'), dict(owner_user_id=self.other_id),
                   dict(spouseName='שם בלי סימון נשוי'), dict(married=True, spouseTorahName='שדה לבן זוג של בת'),
                   dict(barMitzvahDate='2018-10-14'), dict(barMitzvahDate='2000-01-01')]
        for patch in patches:
            profile = self.family_profile([self.family_child(**patch)])
            self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 400, patch)
        duplicate = self.family_child()
        self.assertEqual(self.http('PUT', '/api/profile', self.family_profile([duplicate, duplicate]), 'member-token')[0], 400)
        for phone in ['hello', '050', '++972501234567', '1' * 16]:
            profile = self.family_profile([])
            profile['wifePhone'] = phone
            self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 400, phone)

    def test_old_client_update_preserves_children_and_phones(self):
        profile = self.family_profile([self.family_child()])
        self.store.save_profile(self.member, profile)
        legacy = {k: v for k, v in profile.items() if k not in {'phone', 'wifePhone', 'children', 'firstName', 'lastName'}}
        legacy['name'] = 'שם חדש מהגרסה הקודמת'
        status, saved, _ = self.http('PUT', '/api/profile', legacy, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual(saved['children'], profile['children'])
        self.assertEqual(saved['phone'], profile['phone'])
        self.assertEqual(saved['wifePhone'], profile['wifePhone'])
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT name FROM community_people WHERE id=?', (self.member_id,)).fetchone()[0], profile['name'])

    def test_tribes_round_trip_with_independent_son_in_law_and_inherited_sons(self):
        son = self.family_child('tribe-son')
        daughter = self.family_child('tribe-daughter', 'daughter', married=True, spouseName='חתן', spouseTribe='levi')
        profile = self.family_profile([son, daughter])
        for selected in ['kohen', 'levi', 'yisrael']:
            profile['tribe'] = selected
            status, saved, _ = self.http('PUT', '/api/profile', profile, 'member-token')
            self.assertEqual(status, 200)
            self.assertEqual(saved, profile)
            self.assertNotIn('tribe', saved['children'][0])
            restarted = Store(self.store.path)
            self.assertEqual(restarted.state(self.member)['profile'], profile)
            with restarted.db() as db:
                # Sons resolve their father's status through the permanent owner
                # link; no independent or stale status is stored for a son.
                inherited = db.execute('''SELECT father.tribe FROM community_people AS son
                    JOIN community_people AS father ON father.id=son.owner_user_id
                    WHERE son.id=?''', (son['id'],)).fetchone()[0]
                self.assertEqual(inherited, selected)
                self.assertEqual(db.execute('SELECT spouse_tribe FROM community_people WHERE id=?', (daughter['id'],)).fetchone()[0], 'levi')
        for selected in ['kohen', 'levi', 'yisrael']:
            daughter['spouseTribe'] = selected
            self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 200)
            self.assertEqual(self.store.state(self.member)['profile']['children'][1]['spouseTribe'], selected)

    def test_invalid_or_missing_tribe_selections_are_rejected_for_new_clients(self):
        daughter = self.family_child('tribe-daughter', 'daughter', married=True, spouseTribe='levi')
        valid = self.family_profile([daughter])
        self.store.save_profile(self.member, valid)
        for invalid in ['', 'כהן', 'other', None, True, 1, [], {}]:
            body = copy.deepcopy(valid)
            body['tribe'] = invalid
            self.assertEqual(self.http('PUT', '/api/profile', body, 'member-token')[0], 400, invalid)
            body = copy.deepcopy(valid)
            body['children'][0]['spouseTribe'] = invalid
            self.assertEqual(self.http('PUT', '/api/profile', body, 'member-token')[0], 400, invalid)
        for child in [self.family_child(spouseTribe='kohen'), self.family_child('daughter', 'daughter', spouseTribe='kohen'), self.family_child(tribe='levi')]:
            self.assertEqual(self.http('PUT', '/api/profile', self.family_profile([child]), 'member-token')[0], 400)
        self.assertEqual(self.store.state(self.member)['profile'], valid)

    def test_old_clients_preserve_known_tribes_and_clear_inapplicable_spouse_status(self):
        daughter = self.family_child('tribe-daughter', 'daughter', married=True, spouseTribe='kohen')
        profile = self.family_profile([daughter])
        profile['tribe'] = 'levi'
        self.store.save_profile(self.member, profile)
        legacy = copy.deepcopy(profile)
        del legacy['tribe']
        del legacy['children'][0]['spouseTribe']
        legacy['name'] = 'שם מעודכן מלקוח ישן'
        status, saved, _ = self.http('PUT', '/api/profile', legacy, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual(saved['tribe'], 'levi')
        self.assertEqual(saved['children'][0]['spouseTribe'], 'kohen')
        legacy['children'][0]['gender'] = 'son'
        status, saved, _ = self.http('PUT', '/api/profile', legacy, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual(saved['children'][0]['spouseTribe'], '')
        self.assertEqual(saved['children'][0]['id'], daughter['id'])
        self.store.save_profile(self.member, profile)
        legacy['children'][0].update(gender='daughter', married=False)
        status, saved, _ = self.http('PUT', '/api/profile', legacy, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual(saved['children'][0]['spouseTribe'], '')

    def test_legacy_unknown_tribes_are_not_guessed(self):
        profile = self.store.state(self.member)['profile']
        self.assertEqual(profile.pop('tribe'), '')
        daughter = self.family_child('legacy-daughter', 'daughter', married=True)
        del daughter['spouseTribe']
        profile['children'] = [daughter]
        status, saved, _ = self.http('PUT', '/api/profile', profile, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual(saved['tribe'], '')
        self.assertEqual(saved['children'][0]['spouseTribe'], '')
        # A still older client omits the whole child list. Its preservation of
        # stored unknown fields must not be treated as new explicit selections.
        del profile['children']
        status, saved, _ = self.http('PUT', '/api/profile', profile, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual(saved['children'][0]['spouseTribe'], '')

    def test_tribe_schema_upgrade_preserves_archived_person_identity(self):
        child = self.family_child('archived-daughter', 'daughter', married=True, spouseTribe='levi')
        self.store.save_profile(self.member, self.family_profile([child]))
        self.store.save_profile(self.member, self.family_profile([]))
        with self.store.db() as db:
            before = dict(db.execute('SELECT id,active,created_at,birth_date FROM community_people WHERE id=?', (child['id'],)).fetchone())
            old_profile = json.loads(db.execute('SELECT profile FROM users WHERE id=?', (self.member_id,)).fetchone()[0])
            del old_profile['tribe']
            db.execute('UPDATE users SET profile=? WHERE id=?', (json.dumps(old_profile), self.member_id))
            db.execute('ALTER TABLE community_people DROP COLUMN tribe')
            db.execute('ALTER TABLE community_people DROP COLUMN spouse_tribe')
        upgraded = Store(self.store.path)
        Store(self.store.path)
        self.assertEqual(upgraded.state(self.member)['profile']['tribe'], '')
        with upgraded.db() as db:
            after = dict(db.execute('SELECT id,active,created_at,birth_date FROM community_people WHERE id=?', (child['id'],)).fetchone())
            self.assertEqual(after, before)
            self.assertEqual(db.execute('SELECT spouse_tribe FROM community_people WHERE id=?', (child['id'],)).fetchone()[0], '')
        profile = self.family_profile([child])
        upgraded.save_profile(self.member, profile)
        self.assertEqual(upgraded.state(self.member)['profile']['children'][0]['id'], child['id'])

    def test_hebrew_birthdays_round_trip_without_gregorian_dates(self):
        child = self.family_child(birthDate='', hebrewBirthDate=dict(day=30, month='adar_i', year=5784), barMitzvahDate='2030-10-12')
        profile = self.family_profile([child])
        profile['hebrewBirthDate'] = dict(day=30, month='cheshvan', year=5783)
        status, saved, _ = self.http('PUT', '/api/profile', profile, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual(saved, profile)
        restarted = Store(self.store.path)
        self.assertEqual(restarted.state(self.member)['profile'], profile)
        with restarted.db() as db:
            row = db.execute('SELECT id,birth_date,hebrew_birth_date FROM community_people WHERE id=?', (child['id'],)).fetchone()
            self.assertEqual(row['id'], child['id'])
            self.assertEqual(row['birth_date'], '')
            self.assertEqual(json.loads(row['hebrew_birth_date']), child['hebrewBirthDate'])

    def test_hebrew_birthday_month_boundaries_on_member_and_child(self):
        short = {'tevet', 'adar', 'adar_ii', 'iyar', 'tamuz', 'elul'}
        all_months = ['tishrei', 'cheshvan', 'kislev', 'tevet', 'shevat', 'adar', 'adar_i', 'adar_ii', 'nisan', 'iyar', 'sivan', 'tamuz', 'av', 'elul']
        for month in all_months:
            for day in [29, 30, 31]:
                birthday = dict(day=day, month=month, year=5784 if month in ('adar_i', 'adar_ii') else 5783)
                expected = 200 if day <= (29 if month in short else 30) else 400
                parent = self.family_profile([])
                parent['hebrewBirthDate'] = birthday
                self.assertEqual(self.http('PUT', '/api/profile', parent, 'member-token')[0], expected, birthday)
                family = self.family_profile([self.family_child(birthDate='', hebrewBirthDate=birthday)])
                self.assertEqual(self.http('PUT', '/api/profile', family, 'member-token')[0], expected, birthday)

    def test_malformed_hebrew_birthdays_are_rejected(self):
        for birthday in ['', 'כ״ט אדר', [], {}, dict(day=1), dict(month='nisan'), dict(day=True, month='nisan'), dict(day='29', month='adar'), dict(day=1.5, month='nisan'), dict(day=0, month='nisan'), dict(day=1, month='unknown'), dict(day=1, month='nisan', year=5784, extra=True)]:
            profile = self.family_profile([])
            profile['hebrewBirthDate'] = birthday
            self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 400, birthday)
            profile = self.family_profile([self.family_child(hebrewBirthDate=birthday)])
            self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 400, birthday)

    def test_old_clients_do_not_erase_hebrew_birthdays(self):
        child = self.family_child(hebrewBirthDate=dict(day=29, month='adar_ii', year=5784))
        profile = self.family_profile([child])
        profile['birthDate'] = '1980-05-23'
        profile['hebrewBirthDate'] = dict(day=30, month='kislev', year=5783)
        self.store.save_profile(self.member, profile)
        legacy = copy.deepcopy(profile)
        del legacy['hebrewBirthDate']
        del legacy['children'][0]['hebrewBirthDate']
        legacy['children'][0]['name'] = 'שם מעודכן מלקוח ישן'
        status, saved, _ = self.http('PUT', '/api/profile', legacy, 'member-token')
        self.assertEqual(status, 200)
        self.assertEqual(saved['hebrewBirthDate'], profile['hebrewBirthDate'])
        self.assertEqual(saved['children'][0]['hebrewBirthDate'], child['hebrewBirthDate'])
        self.assertEqual(saved['children'][0]['id'], child['id'])
        self.assertEqual(saved['birthDate'], '1980-05-23')
        self.assertEqual(saved['children'][0]['birthDate'], child['birthDate'])

    def test_hebrew_birthday_schema_upgrade_keeps_archived_people_and_ids(self):
        child = self.family_child()
        self.store.save_profile(self.member, self.family_profile([child]))
        self.store.save_profile(self.member, self.family_profile([]))
        with self.store.db() as db:
            before = dict(db.execute('SELECT id,birth_date,active,created_at FROM community_people WHERE id=?', (child['id'],)).fetchone())
            db.execute('ALTER TABLE community_people DROP COLUMN hebrew_birth_date')
        upgraded = Store(self.store.path)
        Store(self.store.path)
        with upgraded.db() as db:
            after = dict(db.execute('SELECT id,birth_date,active,created_at FROM community_people WHERE id=?', (child['id'],)).fetchone())
            self.assertEqual(after, before)
            self.assertIsNone(db.execute('SELECT hebrew_birth_date FROM community_people WHERE id=?', (child['id'],)).fetchone()[0])

    def test_existing_database_upgrade_backfills_people_idempotently(self):
        legacy = {k: v for k, v in json.loads(self.member['profile']).items() if k not in {'phone', 'wifePhone', 'children'}}
        with self.store.db() as db:
            db.execute('DROP TABLE aliyah_calls')
            db.execute('DROP TABLE aliyah_services')
            db.execute('DROP TABLE roster_people')
            db.execute('DROP TABLE community_people')
            db.execute('UPDATE users SET profile=? WHERE id=?', (json.dumps(legacy), self.member_id))
        upgraded = Store(self.store.path)
        self.assertEqual(upgraded.state(self.member)['profile'], {**legacy, 'phone': '', 'wifePhone': '', 'children': []})
        Store(self.store.path)
        with upgraded.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM community_people').fetchone()[0], 3)


if __name__ == '__main__':
    unittest.main()
