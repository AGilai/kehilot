"""Authenticated weekly PDF attachments, published atomically with announcements."""
import base64
import binascii
import secrets

from .validation import APIError, text

MAX_PDF_BYTES = 10 * 1024 * 1024


def initialize(db):
    db.execute('''CREATE TABLE IF NOT EXISTS weekly_documents (
        id TEXT PRIMARY KEY, message_id TEXT UNIQUE NOT NULL REFERENCES messages(id),
        name TEXT NOT NULL, size INTEGER NOT NULL, content BLOB NOT NULL,
        uploaded_by TEXT NOT NULL REFERENCES users(id), uploaded_at TEXT NOT NULL)''')


class DocumentStore:
    def publish_document(self, user, value):
        self.require_gabbai(user)
        if not isinstance(value, dict) or set(value) != {'name', 'base64', 'title', 'body'}:
            raise APIError(400, 'פרטי קובץ הלו״ז אינם תקינים.')
        name = text(value['name'], 'שם הקובץ', 200, True)
        if '/' in name or '\\' in name or not name.lower().endswith('.pdf'):
            raise APIError(400, 'יש לבחור קובץ PDF בלבד.')
        encoded = value['base64']
        if not isinstance(encoded, str) or len(encoded) > (MAX_PDF_BYTES + 2) // 3 * 4:
            raise APIError(413, 'גודל קובץ הלו״ז המרבי הוא 10MB.')
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise APIError(400, 'תוכן הקובץ אינו תקין.')
        if len(content) > MAX_PDF_BYTES:
            raise APIError(413, 'גודל קובץ הלו״ז המרבי הוא 10MB.')
        if not content.startswith(b'%PDF-') or b'%%EOF' not in content[-1024:]:
            raise APIError(400, 'הקובץ שנבחר אינו קובץ PDF תקין.')
        title = text(value['title'], 'כותרת', 200, True)
        body = text(value['body'], 'תוכן ההודעה', 10000) or 'לו״ז השבוע מצורף בקובץ PDF.'
        from .store import now
        identifier, message_id, uploaded = 'pdf-' + secrets.token_hex(16), secrets.token_hex(16), now()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT INTO messages VALUES (?,?,?,?,?,?,?)', (message_id, 'weekly', title, body, user['id'], uploaded, 0))
            db.execute('INSERT INTO weekly_documents VALUES (?,?,?,?,?,?,?)', (identifier, message_id, name, len(content), content, user['id'], uploaded))
            self.queue(db, [row['id'] for row in db.execute('SELECT id FROM users WHERE id!=?', (user['id'],))], message_id, 'weekly')
        return next(message for message in self.list_messages() if message['id'] == message_id)

    def document(self, user, identifier):
        with self.db() as db:
            row = db.execute('SELECT name,content FROM weekly_documents WHERE id=?', (identifier,)).fetchone()
            if row is None:
                raise APIError(404, 'הקובץ אינו זמין.')
            return row['content']
