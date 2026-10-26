"""Phone possession verification and first-login membership assignment."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time

from .validation import APIError, DEFAULT_PREFERENCES, israel_today
from . import sms


def mobile(value):
    if not isinstance(value, str) or len(value) > 40 or not re.fullmatch(r'[+0-9()\s-]+', value):
        raise APIError(400, 'יש להזין מספר פלאפון ישראלי תקין.')
    digits = re.sub(r'[()\s-]', '', value)
    if digits.startswith('00972'):
        digits = '+' + digits[2:]
    if re.fullmatch(r'05\d{8}', digits):
        digits = '+972' + digits[1:]
    if not re.fullmatch(r'\+9725\d{8}', digits):
        raise APIError(400, 'יש להזין מספר פלאפון ישראלי תקין.')
    return digits


def initialize(db):
    first_upgrade = not db.execute("SELECT 1 FROM sqlite_master WHERE name='verified_phones'").fetchone()
    db.executescript('''
        CREATE TABLE IF NOT EXISTS verified_phones (
            phone TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id), verified_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS association_members (
            phone TEXT PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
            display_name TEXT NOT NULL, imported_at TEXT NOT NULL, imported_by TEXT NOT NULL REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS phone_challenges (
            id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, digest TEXT NOT NULL,
            expires REAL NOT NULL, requested_at REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
            sent INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS phone_limits (
            key TEXT PRIMARY KEY, count INTEGER NOT NULL, since REAL NOT NULL);
    ''')
    if first_upgrade:
        # Preserve classifications already decided by the gabbai before this upgrade.
        db.execute("""UPDATE roster_people SET classification_override=classification
            WHERE classification!='' AND classification_override IS NULL
            AND id IN (SELECT id FROM users)""")
    # Retire the obsolete review queue without touching any member/person identity.
    db.execute('DELETE FROM membership_requests')
    db.execute("UPDATE membership_outbox SET status='skipped' WHERE status='pending'")


def secret():
    value = os.environ.get('SHUL_OTP_SECRET', '')
    if len(value) < 32:
        raise APIError(503, 'אימות מספרי פלאפון טרם הוגדר. יש לפנות לגבאי.')
    return value.encode()


def digest(identifier, phone, code):
    return hmac.new(secret(), f'{identifier}:{phone}:{code}'.encode(), hashlib.sha256).hexdigest()


def limit(db, keys, seconds):
    timestamp = time.time()
    db.execute('DELETE FROM phone_limits WHERE since<?', (timestamp - 86400,))
    for key, maximum in keys:
        key = hashlib.sha256(key.encode()).hexdigest()
        row = db.execute('SELECT count,since FROM phone_limits WHERE key=?', (key,)).fetchone()
        if row and row['since'] > timestamp - seconds and row['count'] >= maximum:
            raise APIError(429, 'בוצעו ניסיונות רבים. נסו שוב מאוחר יותר.')
    for key, _ in keys:
        key = hashlib.sha256(key.encode()).hexdigest()
        db.execute('''INSERT INTO phone_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET
            count=CASE WHEN since<=? THEN 1 ELSE count+1 END,
            since=CASE WHEN since<=? THEN excluded.since ELSE since END''',
            (key, timestamp, timestamp - seconds, timestamp - seconds))


def assign_membership(db, user_id):
    row = db.execute('SELECT classification_override FROM roster_people WHERE id=?', (user_id,)).fetchone()
    if row and row['classification_override'] is None:
        listed = db.execute('''SELECT 1 FROM association_members a
            JOIN verified_phones p ON a.phone=p.phone WHERE p.user_id=?''', (user_id,)).fetchone()
        db.execute("UPDATE roster_people SET classification=? WHERE id=?", ('א' if listed else 'קבוע', user_id))


def check_profile_phone(db, user_id, value):
    verified = db.execute('SELECT phone FROM verified_phones WHERE user_id=?', (user_id,)).fetchone()
    if verified:
        if mobile(value['phone']) != verified['phone']:
            raise APIError(400, 'מספר הכניסה אומת ב־SMS ואינו ניתן לשינוי במסך הפרטים.')
        value['phone'] = verified['phone']


class PhoneAuthStore:
    def request_phone_code(self, value, ip):
        if not isinstance(value, dict) or set(value) != {'phone'}:
            raise APIError(400, 'יש להזין מספר פלאפון בלבד.')
        phone = mobile(value['phone'])
        secret()
        if self.sms_sender is None:
            sms.settings()
        identifier, code = secrets.token_urlsafe(32), f'{secrets.randbelow(1000000):06d}'
        timestamp = time.time()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM phone_challenges WHERE expires<?', (timestamp,))
            old = db.execute('SELECT requested_at FROM phone_challenges WHERE phone=?', (phone,)).fetchone()
            if old and old['requested_at'] > timestamp - 60:
                raise APIError(429, 'אפשר לבקש קוד נוסף בעוד דקה.')
            limit(db, [('send:phone:' + phone, 5), ('send:ip:' + ip, 20)], 3600)
            limit(db, [('send:global', 200)], 86400)
            db.execute('DELETE FROM phone_challenges WHERE phone=?', (phone,))
            db.execute('INSERT INTO phone_challenges (id,phone,digest,expires,requested_at) VALUES (?,?,?,?,?)',
                (identifier, phone, digest(identifier, phone, code), timestamp + 300, timestamp))
        try:
            (self.sms_sender or sms.send_code)(phone, code)
        except Exception:
            with self.db() as db:
                db.execute('DELETE FROM phone_challenges WHERE id=?', (identifier,))
            raise APIError(503, 'שליחת הקוד נכשלה. נסו שוב מאוחר יותר.') from None
        with self.db() as db:
            db.execute('UPDATE phone_challenges SET sent=1 WHERE id=?', (identifier,))
        return dict(challengeId=identifier, expiresIn=300, retryAfter=60)

    def verify_phone_code(self, value, ip):
        from .store import token_hash, now, encode, password_hash
        if not isinstance(value, dict) or set(value) != {'challengeId', 'code'}:
            raise APIError(400, 'יש להזין את קוד האימות בלבד.')
        identifier, code = value['challengeId'], value['code']
        if not isinstance(identifier, str) or len(identifier) > 128 or not isinstance(code, str) or not re.fullmatch(r'[0-9]{6}', code):
            raise APIError(400, 'יש להזין את הקוד בן שש הספרות שנשלח ב־SMS.')
        secret()
        error, result = None, None
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            limit(db, [('verify:ip:' + ip, 60)], 900)
            row = db.execute('SELECT * FROM phone_challenges WHERE id=?', (identifier,)).fetchone()
            if row:
                limit(db, [('verify:phone:' + row['phone'], 20)], 900)
            if not row or not row['sent'] or row['expires'] <= time.time() or row['attempts'] >= 5:
                error = APIError(401, 'הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.')
            elif not hmac.compare_digest(row['digest'], digest(identifier, row['phone'], code)):
                db.execute('UPDATE phone_challenges SET attempts=attempts+1 WHERE id=?', (identifier,))
                error = APIError(401, 'הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.')
            else:
                phone = row['phone']
                linked = db.execute('SELECT user_id FROM verified_phones WHERE phone=?', (phone,)).fetchone()
                if linked:
                    user_id = linked['user_id']
                else:
                    user_id, salt = secrets.token_hex(16), secrets.token_hex(16)
                    entry = db.execute('SELECT * FROM association_members WHERE phone=?', (phone,)).fetchone()
                    initial = dict(name=entry['display_name'] if entry else 'מתפלל חדש',
                        firstName=entry['first_name'] if entry else '', lastName=entry['last_name'] if entry else '',
                        tribe='', phone=phone, wifePhone='', torahName='', wifePrayerName='', barMitzvahParasha='',
                        birthDate='', hebrewBirthDate=None, yahrzeits=[], children=[])
                    db.execute('INSERT INTO users VALUES (?,?,?,?,?,?,?)',
                        (user_id, user_id + '@phone.invalid', salt, password_hash(secrets.token_urlsafe(48), salt),
                         'member', encode(initial), encode(DEFAULT_PREFERENCES)))
                    self._sync_self(db, user_id, initial)
                    db.execute('INSERT INTO verified_phones VALUES (?,?,?)', (phone, user_id, now()))
                    self._refresh_roster(db, israel_today())
                assign_membership(db, user_id)
                self._refresh_roster(db, israel_today())
                db.execute('DELETE FROM phone_challenges WHERE id=?', (identifier,))
                token = secrets.token_urlsafe(48)
                db.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
                db.execute('INSERT INTO sessions VALUES (?,?,?)', (token_hash(token), user_id, time.time() + 30 * 86400))
                user = db.execute('SELECT email FROM users WHERE id=?', (user_id,)).fetchone()
                result = dict(token=token, user=dict(id=user_id,
                    email='' if user['email'].endswith('@phone.invalid') else user['email'], phone=phone))
        if error:
            raise error
        return result

    def link_phone(self, address, value):
        """Trusted local migration only; never match editable profile phones automatically."""
        from .store import now
        phone = mobile(value)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            user = db.execute('SELECT id,profile FROM users WHERE email=?', (address.strip().lower(),)).fetchone()
            if not user:
                raise APIError(404, 'החשבון אינו קיים.')
            try:
                db.execute('INSERT INTO verified_phones VALUES (?,?,?)', (phone, user['id'], now()))
            except sqlite3.IntegrityError:
                raise APIError(409, 'למספר או לחשבון כבר קיים קישור. אין למזג חשבונות אוטומטית.')
            profile = json.loads(user['profile'])
            profile['phone'] = phone
            db.execute('UPDATE users SET profile=? WHERE id=?', (json.dumps(profile, ensure_ascii=False), user['id']))
            # A trusted migration links the existing identity, not a new signup.
            # Preserve its current category (including a provisioned gabbai's א).
            db.execute("""UPDATE roster_people SET classification_override=classification
                WHERE id=? AND classification!='' AND classification_override IS NULL""", (user['id'],))
            assign_membership(db, user['id'])
            self._refresh_roster(db, israel_today())
        return user['id']
