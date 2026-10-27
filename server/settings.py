"""Community-wide calendar policy, editable only by a gabbai."""
from .validation import APIError

YAHRZEIT_CUSTOMS = {'ashkenaz': 'אשכנז', 'sephardi': 'עדות המזרח'}


def initialize(db):
    db.execute('''CREATE TABLE IF NOT EXISTS community_settings (
        id INTEGER PRIMARY KEY CHECK(id=1),
        yahrzeit_custom TEXT CHECK(yahrzeit_custom IN ('ashkenaz','sephardi')),
        updated_by TEXT REFERENCES users(id), updated_at TEXT)''')
    # An upgrade must not guess which custom this community follows.
    db.execute('INSERT OR IGNORE INTO community_settings VALUES (1,NULL,NULL,NULL)')


class SettingsStore:
    @staticmethod
    def _community_settings(db):
        row = db.execute('SELECT yahrzeit_custom FROM community_settings WHERE id=1').fetchone()
        return dict(yahrzeitCustom=row['yahrzeit_custom'])

    def community_settings(self, user):
        with self.db() as db:
            return self._community_settings(db)

    def save_community_settings(self, user, value):
        from .store import now
        self.require_gabbai(user)
        if not isinstance(value, dict) or set(value) != {'yahrzeitCustom'} or not isinstance(value['yahrzeitCustom'], str) or value['yahrzeitCustom'] not in YAHRZEIT_CUSTOMS:
            raise APIError(400, 'יש לבחור מנהג אשכנז או עדות המזרח.')
        with self.db() as db:
            db.execute('UPDATE community_settings SET yahrzeit_custom=?,updated_by=?,updated_at=? WHERE id=1',
                       (value['yahrzeitCustom'], user['id'], now()))
            return self._community_settings(db)
