from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from pathlib import Path

from .validation import APIError, DEFAULT_PREFERENCES, email, message, preferences, profile, text
from .validation import israel_today
from .roster import RosterStore, initialize as initialize_roster
from .seating import SeatingStore, initialize as initialize_seating, current_time
from .membership import MembershipStore, initialize as initialize_membership


def now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000).hex()


class Store(RosterStore, SeatingStore, MembershipStore):
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.db() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL,
                    password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('member','gabbai')),
                    profile TEXT NOT NULL, preferences TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (
                    hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, since REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
                    author_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, pinned INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS replies (
                    id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                    author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS replies_message ON replies(message_id, created_at);
                CREATE TABLE IF NOT EXISTS reads (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, PRIMARY KEY(user_id,message_id));
                CREATE TABLE IF NOT EXISTS push_tokens (
                    token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    session_hash TEXT NOT NULL REFERENCES sessions(hash) ON DELETE CASCADE);
                CREATE TABLE IF NOT EXISTS outbox (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                    preference TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                    available_at REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
                CREATE TABLE IF NOT EXISTS community_people (
                    id TEXT PRIMARY KEY,
                    owner_user_id TEXT NOT NULL REFERENCES users(id),
                    relationship TEXT NOT NULL CHECK(relationship IN ('self','son','daughter')),
                    name TEXT NOT NULL, birth_date TEXT NOT NULL DEFAULT '',
                    torah_name TEXT NOT NULL DEFAULT '', bar_mitzvah_parasha TEXT NOT NULL DEFAULT '',
                    bar_mitzvah_date TEXT NOT NULL DEFAULT '', married INTEGER NOT NULL DEFAULT 0,
                    spouse_name TEXT NOT NULL DEFAULT '', spouse_torah_name TEXT NOT NULL DEFAULT '',
                    spouse_prayer_name TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE UNIQUE INDEX IF NOT EXISTS one_self_per_account
                    ON community_people(owner_user_id) WHERE relationship='self';
                CREATE INDEX IF NOT EXISTS people_family ON community_people(owner_user_id, active);
                CREATE TABLE IF NOT EXISTS healing_prayers (
                    id TEXT PRIMARY KEY,
                    member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL, added_on TEXT NOT NULL,
                    UNIQUE(member_id,name));
                CREATE INDEX IF NOT EXISTS healing_prayers_member_date ON healing_prayers(member_id,added_on);
            ''')
            # Additive upgrade: keep permanent IDs and the original Gregorian
            # dates. A yearless Hebrew birthday cannot determine a birth year.
            columns = {row['name'] for row in db.execute('PRAGMA table_info(community_people)')}
            if 'hebrew_birth_date' not in columns:
                db.execute('ALTER TABLE community_people ADD COLUMN hebrew_birth_date TEXT')
            for column in ('tribe', 'spouse_tribe'):
                if column not in columns:
                    db.execute(f"ALTER TABLE community_people ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
            # Idempotent upgrade: existing account IDs also identify their own person.
            # Children get permanent person rows immediately, so no age-triggered
            # migration or guessed Hebrew-age calculation can lose their identity.
            for user in db.execute('SELECT id,profile FROM users').fetchall():
                self._sync_self(db, user['id'], json.loads(user['profile']))
            initialize_roster(db)
            initialize_seating(db)
            initialize_membership(db)
            self._refresh_roster(db, israel_today())
            self._current_seating_event(db, current_time())
        Path(self.path).chmod(0o600)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def create_user(self, address, password, name, role='member'):
        address = email(address)
        name = text(name, 'שם מלא', required=True)
        if not isinstance(password, str) or not 12 <= len(password) <= 128:
            raise APIError(400, 'הסיסמה צריכה להכיל 12–128 תווים.')
        if role not in ('member', 'gabbai'):
            raise APIError(400, 'הרשאה לא תקינה.')
        identifier, salt = secrets.token_hex(16), secrets.token_hex(16)
        initial = dict(name=name, firstName='', lastName='', tribe='', phone='', wifePhone='', torahName='', wifePrayerName='', barMitzvahParasha='', birthDate='', hebrewBirthDate=None, yahrzeits=[], children=[])
        with self.db() as db:
            try:
                db.execute('INSERT INTO users VALUES (?,?,?,?,?,?,?)', (identifier, address, salt, password_hash(password, salt), role, encode(initial), encode(DEFAULT_PREFERENCES)))
                self._sync_self(db, identifier, initial)
            except sqlite3.IntegrityError:
                raise APIError(409, 'כבר קיים חשבון עם כתובת אימייל זו.')
        return identifier

    def reset_password(self, address, password):
        address = email(address)
        if not isinstance(password, str) or not 12 <= len(password) <= 128:
            raise APIError(400, 'הסיסמה צריכה להכיל 12–128 תווים.')
        salt = secrets.token_hex(16)
        digest = password_hash(password, salt)
        with self.db() as db:
            user = db.execute('SELECT id FROM users WHERE email=?', (address,)).fetchone()
            if not user:
                raise APIError(404, 'החשבון אינו קיים.')
            db.execute('UPDATE users SET salt=?, password_hash=? WHERE id=?', (salt, digest, user['id']))
            db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))

    def login(self, address, password, ip):
        address = email(address)
        if not isinstance(password, str) or not 1 <= len(password) <= 128:
            raise APIError(401, 'פרטי הכניסה שגויים.')
        # Independent account/IP limits prevent trivial IP rotation against one account.
        keys = [(token_hash('ip:' + ip), 20), (token_hash('email:' + address), 8)]
        with self.db() as db:
            db.execute('DELETE FROM login_attempts WHERE since<?', (time.time() - 900,))
            for key, limit in keys:
                row = db.execute('SELECT count FROM login_attempts WHERE key=?', (key,)).fetchone()
                if row and row['count'] >= limit:
                    raise APIError(429, 'בוצעו ניסיונות כניסה רבים. נסו שוב בעוד 15 דקות.')
            for key, _ in keys:
                db.execute('INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, time.time()))
            user = db.execute('SELECT * FROM users WHERE email=?', (address,)).fetchone()
        # Even missing accounts take the password derivation path.
        digest = password_hash(password, user['salt'] if user else '00' * 16)
        if not user or not hmac.compare_digest(digest, user['password_hash']):
            raise APIError(401, 'פרטי הכניסה שגויים.')
        token = secrets.token_urlsafe(48)
        with self.db() as db:
            for key, _ in keys:
                db.execute('DELETE FROM login_attempts WHERE key=?', (key,))
            db.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
            db.execute('INSERT INTO sessions VALUES (?,?,?)', (token_hash(token), user['id'], time.time() + 30 * 86400))
        return dict(token=token, user=dict(id=user['id'], email=user['email']))

    def authenticate(self, token):
        if not token or len(token) > 256:
            raise APIError(401, 'יש להתחבר לקהילה.')
        with self.db() as db:
            user = db.execute('SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.hash=? AND s.expires>?', (token_hash(token), time.time())).fetchone()
        if not user:
            raise APIError(401, 'הכניסה פגה. יש להתחבר מחדש.')
        return dict(user)

    def logout(self, token):
        with self.db() as db:
            # Cascades remove only this device's push token.
            db.execute('DELETE FROM sessions WHERE hash=?', (token_hash(token),))

    @staticmethod
    def require_gabbai(user):
        if user['role'] != 'gabbai':
            raise APIError(403, 'הפעולה מיועדת לגבאים בלבד.')

    def save_profile(self, user, value):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            result = profile(value, self._read_profile(db, user['id']))
            self._sync_children(db, user['id'], result['children'])
            # Children are authoritative in community_people, not duplicated JSON.
            account_profile = {key: val for key, val in result.items() if key != 'children'}
            db.execute('UPDATE users SET profile=? WHERE id=?', (encode(account_profile), user['id']))
            self._sync_self(db, user['id'], result)
            self._refresh_roster(db, israel_today())
            self._request_classification(db, user, result)
        return result

    @staticmethod
    def _sync_self(db, user_id, value):
        timestamp = now()
        db.execute('''INSERT INTO community_people
            (id,owner_user_id,relationship,name,birth_date,torah_name,bar_mitzvah_parasha,created_at,updated_at,hebrew_birth_date,tribe)
            VALUES (?,?,'self',?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,birth_date=excluded.birth_date,torah_name=excluded.torah_name,
            bar_mitzvah_parasha=excluded.bar_mitzvah_parasha,updated_at=excluded.updated_at,
            hebrew_birth_date=excluded.hebrew_birth_date,tribe=excluded.tribe''',
            (user_id, user_id, value['name'], value.get('birthDate', ''), value.get('torahName', ''), value.get('barMitzvahParasha', ''), timestamp, timestamp, encode(value.get('hebrewBirthDate')), value.get('tribe', '')))

    @staticmethod
    def _child(row):
        return dict(id=row['id'], gender=row['relationship'], name=row['name'], birthDate=row['birth_date'],
                    hebrewBirthDate=json.loads(row['hebrew_birth_date']) if row['hebrew_birth_date'] else None,
                    torahName=row['torah_name'], barMitzvahParasha=row['bar_mitzvah_parasha'], barMitzvahDate=row['bar_mitzvah_date'],
                    married=bool(row['married']), spouseName=row['spouse_name'], spouseTribe=row['spouse_tribe'],
                    spouseTorahName=row['spouse_torah_name'], spousePrayerName=row['spouse_prayer_name'])

    def _read_profile(self, db, user_id):
        value = json.loads(db.execute('SELECT profile FROM users WHERE id=?', (user_id,)).fetchone()['profile'])
        value.setdefault('phone', '')
        value.setdefault('wifePhone', '')
        value.setdefault('hebrewBirthDate', None)
        value.setdefault('tribe', '')
        value.setdefault('firstName', '')
        value.setdefault('lastName', '')
        if not value['firstName'] and not value['lastName']:
            split = db.execute('SELECT first_name,last_name FROM roster_people WHERE id=?', (user_id,)).fetchone()
            if split and split['first_name'] and split['last_name']:
                value.update(firstName=split['first_name'], lastName=split['last_name'])
        if value['firstName'] and value['lastName']:
            value['name'] = value['firstName'] + ' ' + value['lastName']
        rows = db.execute("SELECT * FROM community_people WHERE owner_user_id=? AND relationship!='self' AND active=1 ORDER BY created_at,id", (user_id,)).fetchall()
        value['children'] = [self._child(row) for row in rows]
        return value

    @staticmethod
    def _sync_children(db, user_id, values):
        for child in values:
            existing = db.execute('SELECT owner_user_id,relationship FROM community_people WHERE id=?', (child['id'],)).fetchone()
            if existing and (existing['owner_user_id'] != user_id or existing['relationship'] == 'self'):
                raise APIError(403, 'אין הרשאה לעדכן רשומה משפחתית זו.')
        # Removal archives the person; a future aliyah FK can continue referencing
        # the same ID. Updates and reactivation never replace the row or its ID.
        db.execute("UPDATE community_people SET active=0 WHERE owner_user_id=? AND relationship!='self'", (user_id,))
        for child in values:
            timestamp = now()
            db.execute('''INSERT INTO community_people
                (id,owner_user_id,relationship,name,birth_date,torah_name,bar_mitzvah_parasha,bar_mitzvah_date,
                 married,spouse_name,spouse_torah_name,spouse_prayer_name,active,created_at,updated_at,hebrew_birth_date,spouse_tribe)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                relationship=excluded.relationship,name=excluded.name,birth_date=excluded.birth_date,
                torah_name=excluded.torah_name,bar_mitzvah_parasha=excluded.bar_mitzvah_parasha,
                bar_mitzvah_date=excluded.bar_mitzvah_date,married=excluded.married,spouse_name=excluded.spouse_name,
                spouse_torah_name=excluded.spouse_torah_name,spouse_prayer_name=excluded.spouse_prayer_name,
                active=1,updated_at=excluded.updated_at,hebrew_birth_date=excluded.hebrew_birth_date,spouse_tribe=excluded.spouse_tribe''',
                (child['id'], user_id, child['gender'], child['name'], child['birthDate'], child['torahName'],
                 child['barMitzvahParasha'], child['barMitzvahDate'], int(child['married']), child['spouseName'],
                 child['spouseTorahName'], child['spousePrayerName'], timestamp, timestamp, encode(child.get('hebrewBirthDate')), child.get('spouseTribe', '')))

    def save_preferences(self, user, value):
        result = preferences(value)
        with self.db() as db:
            db.execute('UPDATE users SET preferences=? WHERE id=?', (encode(result), user['id']))
        return result

    def list_messages(self):
        with self.db() as db:
            messages = db.execute('SELECT m.*, u.profile FROM messages m JOIN users u ON u.id=m.author_id ORDER BY m.pinned DESC,m.created_at DESC').fetchall()
            replies = db.execute('SELECT r.*, u.profile FROM replies r JOIN users u ON u.id=r.author_id ORDER BY r.created_at,r.id').fetchall()
        grouped = {}
        for row in replies:
            grouped.setdefault(row['message_id'], []).append(dict(id=row['id'], author=json.loads(row['profile'])['name'], body=row['body'], createdAt=row['created_at']))
        return [dict(id=row['id'], category=row['category'], title=row['title'], body=row['body'], author=json.loads(row['profile'])['name'], createdAt=row['created_at'], pinned=bool(row['pinned']), replies=grouped.get(row['id'], [])) for row in messages]

    def state(self, user):
        with self.db() as db:
            fresh = db.execute('SELECT profile,preferences FROM users WHERE id=?', (user['id'],)).fetchone()
            member_profile = self._read_profile(db, user['id'])
            classification = db.execute('SELECT classification FROM roster_people WHERE id=?', (user['id'],)).fetchone()
            read_ids = [r['message_id'] for r in db.execute('SELECT message_id FROM reads WHERE user_id=?', (user['id'],))]
        return dict(profile=member_profile, preferences=json.loads(fresh['preferences']), messages=self.list_messages(), readIds=read_ids, healingPrayers=self.healing_prayers(user), seating=self.seating(user), classification=classification['classification'] if classification else '', role=user['role'], membershipRequests=self.membership_requests(user) if user['role'] == 'gabbai' else [])

    @staticmethod
    def _healing_value(row):
        member = json.loads(row['profile'])
        name = (member.get('firstName', '') + ' ' + member.get('lastName', '')).strip() if member.get('firstName') and member.get('lastName') else member['name']
        return dict(id=row['id'], memberId=row['member_id'], memberName=name, name=row['name'], addedOn=row['added_on'])

    def healing_prayers(self, user, all_members=False):
        if all_members:
            self.require_gabbai(user)
        with self.db() as db:
            rows = db.execute('''SELECT p.*,u.profile FROM healing_prayers p JOIN users u ON u.id=p.member_id
                ''' + ('' if all_members else 'WHERE p.member_id=? ') + 'ORDER BY p.added_on DESC,p.rowid DESC',
                () if all_members else (user['id'],)).fetchall()
            return [self._healing_value(row) for row in rows]

    def add_healing_prayer(self, user, value):
        if not isinstance(value, dict) or set(value) != {'name'}:
            raise APIError(400, 'יש להזין את שם החולה ושם האם בלבד.')
        name = text(value['name'], 'שם החולה ושם האם', required=True)
        identifier = 'prayer-' + secrets.token_hex(16)
        with self.db() as db:
            try:
                db.execute('INSERT INTO healing_prayers VALUES (?,?,?,?)', (identifier, user['id'], name, israel_today().isoformat()))
            except sqlite3.IntegrityError:
                raise APIError(409, 'השם כבר מופיע ברשימה שלך.')
            row = db.execute('SELECT p.*,u.profile FROM healing_prayers p JOIN users u ON u.id=p.member_id WHERE p.id=?', (identifier,)).fetchone()
            return self._healing_value(row)

    def delete_healing_prayer(self, user, identifier):
        with self.db() as db:
            deleted = db.execute('DELETE FROM healing_prayers WHERE id=? AND member_id=?', (identifier, user['id']))
            if deleted.rowcount != 1:
                raise APIError(404, 'השם לא נמצא ברשימה שלך.')

    @staticmethod
    def queue(db, user_ids, message_id, preference):
        for user_id in set(user_ids):
            db.execute('INSERT INTO outbox (id,user_id,message_id,preference,available_at) VALUES (?,?,?,?,?)', (secrets.token_hex(16), user_id, message_id, preference, time.time()))

    def publish(self, user, value):
        self.require_gabbai(user)
        value = message(value)
        identifier = secrets.token_hex(16)
        preference = {'weekly': 'weekly', 'celebration': 'community', 'condolence': 'community', 'event': 'events'}[value['category']]
        with self.db() as db:
            db.execute('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', (identifier, value['category'], value['title'], value['body'], user['id'], now(), int(value['pinned'])))
            self.queue(db, [r['id'] for r in db.execute('SELECT id FROM users WHERE id!=?', (user['id'],))], identifier, preference)
        return next(m for m in self.list_messages() if m['id'] == identifier)

    def reply(self, user, message_id, value):
        if set(value) != {'body'}:
            raise APIError(400, 'מבנה התגובה אינו תקין.')
        body = text(value.get('body'), 'תגובה', 1000, True)
        identifier, created = secrets.token_hex(16), now()
        with self.db() as db:
            parent = db.execute('SELECT * FROM messages WHERE id=?', (message_id,)).fetchone()
            if not parent:
                raise APIError(404, 'ההודעה אינה קיימת.')
            if parent['category'] not in ('celebration', 'condolence'):
                raise APIError(403, 'ניתן להגיב להודעות מזל טוב ותנחומים בלבד.')
            previous = db.execute('SELECT MAX(created_at) AS last FROM replies WHERE author_id=?', (user['id'],)).fetchone()['last']
            if previous and time.time() - datetime.fromisoformat(previous.replace('Z', '+00:00')).timestamp() < 2:
                raise APIError(429, 'יש להמתין רגע לפני הוספת תגובה נוספת.')
            participants = {r['author_id'] for r in db.execute('SELECT DISTINCT author_id FROM replies WHERE message_id=?', (message_id,))}
            participants.add(parent['author_id'])
            participants.discard(user['id'])
            db.execute('INSERT INTO replies VALUES (?,?,?,?,?)', (identifier, message_id, user['id'], body, created))
            self.queue(db, participants, message_id, 'replies')
        return dict(id=identifier, author=json.loads(user['profile'])['name'], body=body, createdAt=created)

    def mark_read(self, user, message_id):
        with self.db() as db:
            if not db.execute('SELECT id FROM messages WHERE id=?', (message_id,)).fetchone():
                raise APIError(404, 'ההודעה אינה קיימת.')
            db.execute('INSERT OR IGNORE INTO reads VALUES (?,?)', (user['id'], message_id))

    def set_push_token(self, user, token, value):
        push_token = value.get('token')
        import re
        if set(value) != {'token'} or not isinstance(push_token, str) or not re.fullmatch(r'(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,200}\]', push_token):
            raise APIError(400, 'מזהה ההתראות אינו תקין.')
        with self.db() as db:
            existing = db.execute('SELECT user_id FROM push_tokens WHERE token=?', (push_token,)).fetchone()
            count = db.execute('SELECT COUNT(*) FROM push_tokens WHERE user_id=?', (user['id'],)).fetchone()[0]
            if count >= 20 and (not existing or existing['user_id'] != user['id']):
                raise APIError(400, 'הגעת למספר המכשירים המרבי. פנו לגבאים.')
            db.execute('INSERT INTO push_tokens VALUES (?,?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,session_hash=excluded.session_hash', (push_token, user['id'], token_hash(token)))

    def members(self, user):
        self.require_gabbai(user)
        with self.db() as db:
            return [dict(id=r['id'], email=r['email'], profile=self._read_profile(db, r['id'])) for r in db.execute('SELECT id,email,profile FROM users ORDER BY email').fetchall()]
