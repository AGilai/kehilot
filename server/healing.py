"""Durable, owner-scoped healing-prayer renewal and cleanup."""
import calendar
from datetime import date, datetime, timedelta, timezone
import logging
import os
import secrets
import threading
import time
from zoneinfo import ZoneInfo

from .validation import APIError, israel_today

MESSAGE_PREFIX = 'healing-reminder-'


def message_id(cycle_id):
    return MESSAGE_PREFIX + cycle_id


def next_month(day):
    year, month = (day.year + 1, 1) if day.month == 12 else (day.year, day.month + 1)
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def initialize(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS healing_cycles (
            prayer_id TEXT PRIMARY KEY REFERENCES healing_prayers(id) ON DELETE CASCADE,
            cycle_id TEXT NOT NULL, started_on TEXT NOT NULL,
            reminder_due_on TEXT NOT NULL, expires_on TEXT NOT NULL,
            reminder_created_on TEXT, confirmed_on TEXT);
        CREATE TABLE IF NOT EXISTS healing_reminder_outbox (
            id TEXT PRIMARY KEY,
            prayer_id TEXT NOT NULL REFERENCES healing_prayers(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            cycle_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
            available_at REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
            UNIQUE(prayer_id,cycle_id));
        CREATE INDEX IF NOT EXISTS healing_reminder_pending ON healing_reminder_outbox(status,available_at);
    ''')
    if 'read_on' not in {row['name'] for row in db.execute('PRAGMA table_info(healing_cycles)')}:
        db.execute('ALTER TABLE healing_cycles ADD COLUMN read_on TEXT')


def begin_cycle(db, identifier, start, confirmed=False):
    db.execute('DELETE FROM healing_reminder_outbox WHERE prayer_id=?', (identifier,))
    db.execute('''INSERT INTO healing_cycles
        (prayer_id,cycle_id,started_on,reminder_due_on,expires_on,confirmed_on)
        VALUES (?,?,?,?,?,?) ON CONFLICT(prayer_id) DO UPDATE SET
        cycle_id=excluded.cycle_id,started_on=excluded.started_on,
        reminder_due_on=excluded.reminder_due_on,expires_on=excluded.expires_on,
        reminder_created_on=NULL,confirmed_on=excluded.confirmed_on,read_on=NULL''',
        (identifier, secrets.token_hex(16), start.isoformat(), (start + timedelta(days=14)).isoformat(),
         next_month(start).isoformat(), start.isoformat() if confirmed else None))


def maintain(db, today, member_id=None):
    """Caller holds a write transaction. Unlinked imports never expire here."""
    scope = ' AND p.member_id=?' if member_id else ''
    parameters = (member_id,) if member_id else ()
    for row in db.execute('''SELECT p.id,p.added_on FROM healing_prayers p
        LEFT JOIN healing_cycles c ON c.prayer_id=p.id
        WHERE p.member_id IS NOT NULL AND c.prayer_id IS NULL''' + scope, parameters).fetchall():
        start = date.fromisoformat(row['added_on'])
        begin_cycle(db, row['id'], start)
    rows = db.execute('''SELECT p.id,p.member_id,c.* FROM healing_prayers p
        JOIN healing_cycles c ON c.prayer_id=p.id
        WHERE p.member_id IS NOT NULL''' + scope, parameters).fetchall()
    reminded = removed = 0
    for row in rows:
        if today.isoformat() >= row['expires_on']:
            db.execute('DELETE FROM healing_prayers WHERE id=? AND member_id=?', (row['id'], row['member_id']))
            removed += 1
        elif not row['reminder_created_on'] and today.isoformat() >= row['reminder_due_on']:
            db.execute('UPDATE healing_cycles SET reminder_created_on=? WHERE prayer_id=?', (today.isoformat(), row['id']))
            db.execute('''INSERT OR IGNORE INTO healing_reminder_outbox
                (id,prayer_id,user_id,cycle_id,available_at) VALUES (?,?,?,?,?)''',
                (secrets.token_hex(16), row['id'], row['member_id'], row['cycle_id'], time.time()))
            reminded += 1
    return dict(reminded=reminded, removed=removed)


def metadata(row, today):
    if not row['cycle_id']:
        return None
    return dict(cycleId=row['cycle_id'], startedOn=row['started_on'],
                dueOn=row['reminder_due_on'], expiresOn=row['expires_on'],
                confirmedOn=row['confirmed_on'], createdOn=row['reminder_created_on'],
                read=bool(row['read_on']), pending=today.isoformat() >= row['reminder_due_on'])


class HealingStore:
    def healing_messages(self, user, prayers=None):
        prayers = self.healing_prayers(user) if prayers is None else prayers
        result = []
        for prayer in prayers:
            reminder = prayer.get('reminder')
            if not reminder or not reminder['pending']:
                continue
            created = datetime.fromisoformat(reminder['createdOn'] or reminder['dueOn']).replace(tzinfo=ZoneInfo('Asia/Jerusalem'))
            introduction = 'חלפו שבועיים מאז שאישרת להשאיר את השם' if reminder['confirmedOn'] else 'חלפו שבועיים מאז שהוספת את השם'
            result.append(dict(id=message_id(reminder['cycleId']), kind='healing', category='event',
                               title='תזכורת למי שברך לחולים: ' + prayer['name'],
                               body=f'{introduction} {prayer["name"]} למי שברך לחולים. האם להשאיר את השם ברשימה או להסירו?',
                               author='תזכורת אישית', createdAt=created.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'), pinned=False, replies=[],
                               healing=dict(prayerId=prayer['id'], cycleId=reminder['cycleId'], expiresOn=reminder['expiresOn'])))
        return result

    def read_healing_message(self, user, identifier):
        error = None
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            maintain(db, israel_today(), user['id'])
            changed = db.execute('''UPDATE healing_cycles SET read_on=COALESCE(read_on,?)
                WHERE cycle_id=? AND reminder_created_on IS NOT NULL
                AND prayer_id IN (SELECT id FROM healing_prayers WHERE member_id=?)''',
                (israel_today().isoformat(), identifier[len(MESSAGE_PREFIX):], user['id']))
            if changed.rowcount != 1:
                error = APIError(404, 'ההודעה אינה קיימת.')
        if error:
            raise error

    def maintain_healing_prayers(self):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            return maintain(db, israel_today())

    def keep_healing_prayer(self, user, identifier, value):
        if not isinstance(value, dict) or set(value) != {'cycleId'} or not isinstance(value['cycleId'], str):
            raise APIError(400, 'יש לענות לתזכורת העדכנית.')
        error = result = None
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            today = israel_today()
            maintain(db, today, user['id'])
            row = db.execute('''SELECT c.* FROM healing_prayers p JOIN healing_cycles c ON c.prayer_id=p.id
                WHERE p.id=? AND p.member_id=?''', (identifier, user['id'])).fetchone()
            if row is None:
                error = APIError(404, 'השם לא נמצא ברשימה שלך. ייתכן שכבר הוסר.')
            elif row['cycle_id'] != value['cycleId'] or today.isoformat() < row['reminder_due_on']:
                error = APIError(409, 'התזכורת כבר עודכנה. יש לרענן את הרשימה.')
            else:
                begin_cycle(db, identifier, today, confirmed=True)
                db.execute('UPDATE healing_prayers SET added_on=? WHERE id=?', (today.isoformat(), identifier))
                updated = db.execute('''SELECT p.*,u.profile,c.* FROM healing_prayers p
                    JOIN users u ON u.id=p.member_id JOIN healing_cycles c ON c.prayer_id=p.id
                    WHERE p.id=?''', (identifier,)).fetchone()
                result = self._healing_value(updated)
        # Commit due cleanup/reminders even if the response is stale or expired.
        if error:
            raise error
        return result


def start_worker(store, stop):
    def work():
        from .push import process_healing_one
        while not stop.is_set():
            handled = False
            try:
                store.maintain_healing_prayers()
                if os.environ.get('SHUL_ENABLE_PUSH') == '1':
                    handled = process_healing_one(store)
            except Exception:
                logging.exception('Healing reminder worker error')
            stop.wait(0.25 if handled else 30)
    thread = threading.Thread(target=work, name='healing-reminders', daemon=True)
    thread.start()
    return thread
