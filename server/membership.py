"""Self-registration and gabbai-only household classification review."""
import json
import secrets
import time

from .validation import APIError, email, text


def initialize(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS membership_requests (
            member_id TEXT PRIMARY KEY REFERENCES users(id), submitted_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS membership_outbox (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
            member_id TEXT NOT NULL REFERENCES users(id),
            attempts INTEGER NOT NULL DEFAULT 0, available_at REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', UNIQUE(user_id,member_id));
    ''')


class MembershipStore:
    def register(self, value, ip):
        from .store import token_hash
        if not isinstance(value, dict) or set(value) != {'email', 'password', 'firstName', 'lastName'}:
            raise APIError(400, 'יש להזין שם פרטי, שם משפחה, אימייל וסיסמה.')
        address = email(value['email'])
        first = text(value['firstName'], 'שם פרטי', required=True)
        last = text(value['lastName'], 'שם משפחה', required=True)
        if len(first + ' ' + last) > 200:
            raise APIError(400, 'השם ארוך מדי.')
        key = token_hash('registration:' + ip)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM login_attempts WHERE since<?', (time.time() - 900,))
            row = db.execute('SELECT count FROM login_attempts WHERE key=?', (key,)).fetchone()
            if row and row['count'] >= 5:
                raise APIError(429, 'בוצעו ניסיונות הרשמה רבים. נסו שוב בעוד 15 דקות.')
            db.execute('INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, time.time()))
        identifier = self.create_user(address, value['password'], first + ' ' + last)
        with self.db() as db:
            account = json.loads(db.execute('SELECT profile FROM users WHERE id=?', (identifier,)).fetchone()[0])
            account.update(firstName=first, lastName=last)
            db.execute('UPDATE users SET profile=? WHERE id=?', (json.dumps(account, ensure_ascii=False), identifier))
            self._sync_self(db, identifier, account)
        return self.login(address, value['password'], ip)

    @staticmethod
    def _request_classification(db, user, profile):
        if user['role'] != 'member' or not all(profile.get(key) for key in ('firstName', 'lastName', 'tribe')):
            return
        person = db.execute('SELECT classification FROM roster_people WHERE id=?', (user['id'],)).fetchone()
        if not person or person['classification']:
            return
        from .store import now
        inserted = db.execute('INSERT OR IGNORE INTO membership_requests VALUES (?,?)', (user['id'], now())).rowcount
        if inserted:
            for gabbai in db.execute("SELECT id FROM users WHERE role='gabbai'").fetchall():
                db.execute('INSERT OR IGNORE INTO membership_outbox (id,user_id,member_id,available_at) VALUES (?,?,?,?)',
                           (secrets.token_hex(16), gabbai['id'], user['id'], time.time()))

    def membership_requests(self, user):
        self.require_gabbai(user)
        with self.db() as db:
            rows = db.execute('''SELECT q.member_id,q.submitted_at,u.email FROM membership_requests q
                JOIN users u ON u.id=q.member_id JOIN roster_people r ON r.id=q.member_id
                WHERE r.classification='' AND r.active=1 ORDER BY q.submitted_at,q.member_id''').fetchall()
            return [dict(id=row['member_id'], email=row['email'], submittedAt=row['submitted_at'],
                         profile=self._read_profile(db, row['member_id'])) for row in rows]
