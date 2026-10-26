"""Shared, gabbai-managed classification names. Labels never grant admin roles."""
from datetime import datetime, timezone
import sqlite3

from .validation import APIError, text

BUILTINS = ('א', 'דור ב', 'חתן', 'דור ב-נשוי', 'קבוע')


def initialize(db):
    db.execute('''CREATE TABLE IF NOT EXISTS classifications (
        name TEXT PRIMARY KEY COLLATE NOCASE, position INTEGER NOT NULL,
        created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL)''')
    timestamp = datetime.now(timezone.utc).isoformat()
    for index, name in enumerate(BUILTINS):
        db.execute('INSERT OR IGNORE INTO classifications VALUES (?,?,NULL,?)', (name, index, timestamp))
    for row in db.execute("SELECT classification FROM roster_people WHERE classification!='' UNION SELECT classification_override AS classification FROM roster_people WHERE classification_override IS NOT NULL AND classification_override!=''").fetchall():
        db.execute('''INSERT OR IGNORE INTO classifications
            SELECT ?,COALESCE(MAX(position),-1)+1,NULL,? FROM classifications''', (row['classification'], timestamp))


def classification_value(db, value, allow_empty=False):
    if allow_empty and value == '':
        return ''
    if not isinstance(value, str):
        raise APIError(400, 'יש לבחור סיווג מהרשימה.')
    row = db.execute('SELECT name FROM classifications WHERE name=?', (value,)).fetchone()
    if row is None:
        raise APIError(400, 'יש לבחור סיווג קיים או להוסיף סיווג חדש תחילה.')
    return row['name']


def option(name):
    return dict(value=name, label='א — חבר עמותה' if name == 'א' else name)


class ClassificationStore:
    def classifications(self, user):
        self.require_gabbai(user)
        with self.db() as db:
            return [option(row['name']) for row in db.execute('SELECT name FROM classifications ORDER BY position,name')]

    def add_classification(self, user, value):
        self.require_gabbai(user)
        if not isinstance(value, dict) or set(value) != {'name'}:
            raise APIError(400, 'יש להזין את שם הסיווג החדש בלבד.')
        raw = text(value['name'], 'שם הסיווג', 60, True)
        if any(ord(character) < 32 or ord(character) == 127 for character in raw):
            raise APIError(400, 'שם הסיווג אינו תקין.')
        name = ' '.join(raw.split())
        # Do not create look-alike duplicates of the built-in membership labels.
        unquoted = name.replace('׳', '').replace("'", '')
        if unquoted in BUILTINS or name == 'א — חבר עמותה':
            name = 'א' if name == 'א — חבר עמותה' else unquoted
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                db.execute('''INSERT INTO classifications
                    SELECT ?,COALESCE(MAX(position),-1)+1,?,? FROM classifications''',
                    (name, user['id'], datetime.now(timezone.utc).isoformat()))
            except sqlite3.IntegrityError:
                raise APIError(409, 'הסיווג כבר קיים ברשימה.')
        return option(name)
