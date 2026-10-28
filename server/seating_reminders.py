"""Israel-time seating reminders; only the current period is retained."""
from datetime import date, datetime, time, timedelta, timezone
import logging
import os
import secrets
import threading
import time as system_time

from .seating import ISRAEL, current_time, event_value, is_open
from .validation import APIError

MESSAGE_PREFIX = 'seating-reminder-'
SLOTS = (time(7, 30), time(12))
DELIVERY_WINDOW = timedelta(minutes=30)


def initialize(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS seating_reminder_outbox (
            id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL REFERENCES seating_events(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            event_revision INTEGER NOT NULL, allocation_revision INTEGER NOT NULL,
            allocation_snapshot INTEGER NOT NULL, slot TEXT NOT NULL,
            scheduled_at TEXT NOT NULL, expires_at TEXT NOT NULL, read_on TEXT,
            attempts INTEGER NOT NULL DEFAULT 0, available_at REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            UNIQUE(event_id,user_id,event_revision,allocation_revision,slot));
        CREATE INDEX IF NOT EXISTS seating_reminder_pending ON seating_reminder_outbox(status,available_at);
    ''')


def reminder_message(status):
    reminder = status.get('reminder')
    if not reminder:
        return None
    event = status['event']
    text = 'כמה מקומות לא צריך' if event['mode'] == 'unused' else 'כמה מקומות צריך בפועל'
    return dict(id=reminder['id'], kind='seating', category='event',
                title='תזכורת לדיווח מקומות: ' + event['title'],
                body=f'נא לעדכן {text} בתפילת ערבית ובתפילת שחרית עבור {event["title"]}.',
                author='תזכורת אישית', createdAt=reminder['scheduledAt'], pinned=False, replies=[],
                seating=dict(eventId=event['id'], revision=event['revision'], allocationRevision=status['allocationRevision']))


class SeatingReminderStore:
    def _maintain_seating_reminders(self, db, event, now, user_id=None):
        db.execute('DELETE FROM seating_reminder_outbox WHERE event_id!=?', (event['id'],))
        db.execute("UPDATE seating_reminder_outbox SET status='skipped' WHERE status='pending' AND expires_at<=?", (now.astimezone(timezone.utc).isoformat(),))
        accounts = db.execute('SELECT id FROM users' + (' WHERE id=?' if user_id else ''), (user_id,) if user_id else ()).fetchall()
        value = event_value(event, now)
        reminder_day = date.fromisoformat(value['reminderDate'])
        for account in accounts:
            person = self._seating_person(db, account['id'])
            status = self._seating_status(db, event, person, now)
            eligible = status['eligible'] and status['allocatedSeats'] is not None and not status['reported'] and is_open(event, now)
            if not eligible:
                db.execute('DELETE FROM seating_reminder_outbox WHERE user_id=?', (account['id'],))
                continue
            db.execute('''DELETE FROM seating_reminder_outbox WHERE user_id=? AND
                (event_revision!=? OR allocation_revision!=? OR allocation_snapshot!=?)''',
                (account['id'], event['revision'], person['seat_allocation_revision'], person['allocated_seats']))
            if now.astimezone(ISRAEL).date() != reminder_day:
                continue
            for slot in SLOTS:
                scheduled = datetime.combine(reminder_day, slot, ISRAEL).astimezone(timezone.utc)
                if not scheduled <= now < scheduled + DELIVERY_WINDOW:
                    continue
                db.execute('''INSERT OR IGNORE INTO seating_reminder_outbox
                    (id,event_id,user_id,event_revision,allocation_revision,allocation_snapshot,slot,scheduled_at,expires_at,available_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?)''',
                    (MESSAGE_PREFIX + secrets.token_hex(16), event['id'], account['id'], event['revision'],
                     person['seat_allocation_revision'], person['allocated_seats'], slot.strftime('%H:%M'),
                     scheduled.isoformat(), (scheduled + DELIVERY_WINDOW).isoformat(), scheduled.timestamp()))

    def seating_reminder_status(self, db, event, person, status, now, user_id):
        self._maintain_seating_reminders(db, event, now, user_id)
        if not status['eligible'] or status['reported']:
            return None
        row = db.execute('''SELECT * FROM seating_reminder_outbox WHERE event_id=? AND user_id=?
            ORDER BY scheduled_at DESC LIMIT 1''', (event['id'], user_id)).fetchone()
        return dict(id=row['id'], slot=row['slot'], scheduledAt=row['scheduled_at'], read=bool(row['read_on'])) if row else None

    def maintain_seating_reminders(self):
        now = current_time()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            event = self._current_seating_event(db, now)
            self._maintain_seating_reminders(db, event, now)

    def seating_messages(self, user, status=None):
        message = reminder_message(self.seating(user) if status is None else status)
        return [message] if message else []

    def read_seating_message(self, user, identifier):
        error = None
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            now = current_time()
            event = self._current_seating_event(db, now)
            person = self._seating_person(db, user['id'])
            status = self._seating_status(db, event, person, now)
            reminder = self.seating_reminder_status(db, event, person, status, now, user['id'])
            if not reminder or reminder['id'] != identifier:
                error = APIError(404, 'ההודעה אינה קיימת.')
            else:
                db.execute('UPDATE seating_reminder_outbox SET read_on=COALESCE(read_on,?) WHERE id=? AND user_id=?',
                           (now.isoformat(), identifier, user['id']))
        if error:
            raise error


def process_one(store, send=None):
    from .push import send_to_expo
    send = send or send_to_expo
    now = current_time()
    with store.db() as db:
        db.execute('BEGIN IMMEDIATE')
        event = store._current_seating_event(db, now)
        store._maintain_seating_reminders(db, event, now)
        job = db.execute('''SELECT * FROM seating_reminder_outbox WHERE status='pending' AND available_at<=?
            ORDER BY scheduled_at,user_id LIMIT 1''', (now.timestamp(),)).fetchone()
        if not job:
            return False
        tokens = [r['token'] for r in db.execute('''SELECT p.token FROM push_tokens p JOIN sessions s ON s.hash=p.session_hash
            WHERE p.user_id=? AND s.expires>?''', (job['user_id'], system_time.time()))]
        if not tokens:
            db.execute('UPDATE seating_reminder_outbox SET available_at=? WHERE id=?', (now.timestamp() + 60, job['id']))
            return True
    try:
        text = 'נא לעדכן כמה מקומות לא צריך בערבית ובשחרית.' if event['mode'] == 'unused' else 'נא לעדכן כמה מקומות צריך בפועל בערבית ובשחרית.'
        payload = [dict(to=token, title='תזכורת לדיווח מקומות לשבת ולחג', body=text,
                        data=dict(screen='messages', messageId=job['id']), channelId='messages', priority='high', sound='default') for token in tokens]
        tickets = send(payload).get('data', [])
        if len(tickets) != len(tokens):
            raise ValueError('Unexpected Expo response')
        retry = False
        with store.db() as db:
            for token, ticket in zip(tokens, tickets):
                if ticket.get('status') == 'ok':
                    continue
                if ticket.get('details', {}).get('error') == 'DeviceNotRegistered':
                    db.execute('DELETE FROM push_tokens WHERE token=?', (token,))
                else:
                    retry = True
        if retry:
            raise ValueError('Expo rejected a seating reminder ticket')
        with store.db() as db:
            db.execute("UPDATE seating_reminder_outbox SET status='accepted' WHERE id=?", (job['id'],))
    except Exception:
        attempts = job['attempts'] + 1
        with store.db() as db:
            db.execute('UPDATE seating_reminder_outbox SET attempts=?,available_at=?,status=? WHERE id=?',
                       (attempts, now.timestamp() + min(3600, 30 * 2 ** attempts), 'failed' if attempts >= 5 else 'pending', job['id']))
        logging.warning('Seating reminder delivery failed; attempt %d', attempts)
    return True


def start_worker(store, stop):
    def work():
        while not stop.is_set():
            handled = False
            try:
                store.maintain_seating_reminders()
                if os.environ.get('SHUL_ENABLE_PUSH') == '1':
                    handled = process_one(store)
            except Exception:
                logging.exception('Seating reminder worker error')
            stop.wait(0.25 if handled else 15)
    thread = threading.Thread(target=work, name='seating-reminders', daemon=True)
    thread.start()
    return thread
