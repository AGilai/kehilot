"""Family seating allocations and event-specific, explicitly typed reports."""
from datetime import date, datetime, time, timedelta, timezone
import secrets
from zoneinfo import ZoneInfo

from pyluach import dates, parshios
from .validation import APIError, text

ISRAEL = ZoneInfo('Asia/Jerusalem')
MODES = {'unused', 'needed'}
OCCASIONS = {'shabbat', 'holiday', 'zachor', 'high_holidays', 'megillah_evening', 'custom'}


def current_time():
    return datetime.now(timezone.utc)


def initialize(db):
    columns = {row['name'] for row in db.execute('PRAGMA table_info(roster_people)')}
    if 'allocated_seats' not in columns:
        db.execute('ALTER TABLE roster_people ADD COLUMN allocated_seats INTEGER CHECK(allocated_seats BETWEEN 0 AND 1000)')
    if 'seat_allocation_revision' not in columns:
        db.execute('ALTER TABLE roster_people ADD COLUMN seat_allocation_revision INTEGER NOT NULL DEFAULT 1')
    report_columns = {row['name'] for row in db.execute('PRAGMA table_info(seating_reports)')}
    if report_columns and 'arvit_value' not in report_columns:
        # A legacy single number cannot be assigned to either prayer by guessing.
        db.execute('DROP TABLE seating_reports')
    db.executescript('''
        CREATE TABLE IF NOT EXISTS seating_events (
            id TEXT PRIMARY KEY, event_date TEXT NOT NULL, title TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('unused','needed')),
            occasion TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
            reporting_open INTEGER NOT NULL DEFAULT 1, closes_at TEXT,
            is_current INTEGER NOT NULL DEFAULT 0, automatic INTEGER NOT NULL DEFAULT 0);
        CREATE UNIQUE INDEX IF NOT EXISTS one_current_seating_event ON seating_events(is_current) WHERE is_current=1;
        CREATE TABLE IF NOT EXISTS seating_reports (
            event_id TEXT NOT NULL REFERENCES seating_events(id),
            person_id TEXT NOT NULL REFERENCES roster_people(id),
            event_revision INTEGER NOT NULL, allocation_revision INTEGER NOT NULL,
            allocation_snapshot INTEGER NOT NULL, arvit_value INTEGER NOT NULL,
            shacharit_value INTEGER NOT NULL, arvit_needed INTEGER NOT NULL,
            shacharit_needed INTEGER NOT NULL, updated_at TEXT NOT NULL,
            submitted_by TEXT NOT NULL REFERENCES users(id),
            PRIMARY KEY(event_id,person_id));
    ''')


def special_occasion(day):
    hebrew = dates.HebrewDate.from_pydate(day)
    if hebrew.month == 7 and hebrew.day in (1, 2, 10):
        return 'high_holidays'
    if day.weekday() == 5 and parshios.four_parshios(hebrew) == 'Zachor':
        return 'zachor'
    return None


def parasha_for(day):
    if day.weekday() != 5:
        return None
    result = parshios.getparsha_string(dates.GregorianDate.from_pydate(day), israel=True, hebrew=True)
    return 'פרשת ' + result if result else None


def event_title(day):
    parasha = parasha_for(day)
    festival = dates.HebrewDate.from_pydate(day).festival(israel=True, hebrew=True, prefix_day=True)
    title = parasha or festival or 'מקומות לתפילה'
    return title + ' · שבת זכור' if special_occasion(day) == 'zachor' else title


def timestamp(value):
    if not isinstance(value, str) or len(value) > 50:
        raise APIError(400, 'מועד סגירת הדיווח אינו תקין.')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc).isoformat()
    except ValueError:
        raise APIError(400, 'מועד סגירת הדיווח חייב לכלול אזור זמן.')


def is_open(event, now):
    today = now.astimezone(ISRAEL).date()
    return bool(event['reporting_open']) and event['event_date'] >= today.isoformat() and (
        not event['closes_at'] or now < datetime.fromisoformat(event['closes_at']))


def event_value(event, now):
    return dict(id=event['id'], date=event['event_date'], title=event['title'],
                parasha=parasha_for(date.fromisoformat(event['event_date'])), mode=event['mode'],
                occasion=event['occasion'], revision=event['revision'], reportingOpen=is_open(event, now),
                configuredOpen=bool(event['reporting_open']), closesAt=event['closes_at'],
                isCurrent=bool(event['is_current']), automatic=bool(event['automatic']))


class SeatingStore:
    @staticmethod
    def _current_seating_event(db, now):
        today = now.astimezone(ISRAEL).date()
        db.execute('DELETE FROM seating_reports WHERE event_id IN (SELECT id FROM seating_events WHERE event_date<?)', (today.isoformat(),))
        db.execute('DELETE FROM seating_events WHERE event_date<?', (today.isoformat(),))
        selected = db.execute('SELECT * FROM seating_events WHERE is_current=1').fetchone()
        if selected:
            db.execute('DELETE FROM seating_reports WHERE event_id!=?', (selected['id'],))
            return selected
        saturday = today + timedelta(days=(5 - today.weekday()) % 7 or 7)
        identifier = 'weekly-' + saturday.isoformat()
        occasion = special_occasion(saturday) or 'shabbat'
        closes = datetime.combine(saturday, time.min, ISRAEL).astimezone(timezone.utc).isoformat()
        db.execute('''INSERT OR IGNORE INTO seating_events
            (id,event_date,title,mode,occasion,closes_at,automatic) VALUES (?,?,?,?,?,?,1)''',
            (identifier, saturday.isoformat(), event_title(saturday), 'needed' if occasion != 'shabbat' else 'unused', occasion, closes))
        db.execute('UPDATE seating_events SET is_current=1 WHERE id=?', (identifier,))
        db.execute('DELETE FROM seating_reports WHERE event_id!=?', (identifier,))
        return db.execute('SELECT * FROM seating_events WHERE id=?', (identifier,)).fetchone()

    @staticmethod
    def _seating_status(db, event, person, now):
        eligible = person is not None and person['active'] == 1 and person['classification'] == 'א'
        allocation = person['allocated_seats'] if eligible else None
        allocation_revision = person['seat_allocation_revision'] if eligible else None
        report = db.execute('SELECT * FROM seating_reports WHERE event_id=? AND person_id=?', (event['id'], person['id'])).fetchone() if eligible else None
        valid = report is not None and allocation is not None and report['event_revision'] == event['revision'] and report['allocation_revision'] == allocation_revision and report['allocation_snapshot'] == allocation
        needed = {prayer: report[prayer + '_needed'] if valid else allocation if event['mode'] == 'unused' else 0 for prayer in ('arvit', 'shacharit')} if allocation is not None else None
        return dict(event=event_value(event, now), eligible=eligible, allocatedSeats=allocation,
                    allocationRevision=allocation_revision, reported=valid,
                    value={prayer: report[prayer + '_value'] for prayer in ('arvit', 'shacharit')} if valid else None, neededSeats=needed,
                    releasedSeats={prayer: allocation - needed[prayer] for prayer in ('arvit', 'shacharit')} if allocation is not None else None,
                    reportInvalidated=report is not None and not valid,
                    updatedAt=report['updated_at'] if valid else None)

    def seating(self, user):
        now = current_time()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            event = self._current_seating_event(db, now)
            person = db.execute('SELECT * FROM roster_people WHERE id=?', (user['id'],)).fetchone()
            return self._seating_status(db, event, person, now)

    def save_seating_report(self, user, value):
        required = {'eventId', 'revision', 'mode', 'allocatedSeats', 'allocationRevision', 'arvit', 'shacharit'}
        if not isinstance(value, dict) or set(value) != required:
            raise APIError(400, 'פרטי דיווח המקומות אינם תקינים.')
        if not isinstance(value['eventId'], str) or len(value['eventId']) > 100 or not isinstance(value['mode'], str):
            raise APIError(400, 'פרטי אירוע הדיווח אינם תקינים.')
        if any(type(value[key]) is not int for key in ('revision', 'allocatedSeats', 'allocationRevision', 'arvit', 'shacharit')):
            raise APIError(400, 'יש לבחור מספר מקומות שלם מתוך הרשימה.')
        now = current_time()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            event = self._current_seating_event(db, now)
            person = db.execute('SELECT * FROM roster_people WHERE id=?', (user['id'],)).fetchone()
            status = self._seating_status(db, event, person, now)
            if not status['eligible']:
                raise APIError(403, 'דיווח משפחתי מתבצע על ידי ראש משפחה חבר עמותה.')
            if status['allocatedSeats'] is None:
                raise APIError(409, 'טרם הוגדרה מכסת מקומות למשפחה. יש לפנות לגבאי.')
            if value['eventId'] != event['id'] or value['revision'] != event['revision'] or value['mode'] != event['mode']:
                raise APIError(409, 'אירוע הדיווח או אופן הדיווח השתנו. יש לרענן ולדווח מחדש.')
            if value['allocatedSeats'] != status['allocatedSeats'] or value['allocationRevision'] != status['allocationRevision']:
                raise APIError(409, 'מכסת המקומות השתנתה. יש לרענן ולבחור שוב.')
            if not is_open(event, now):
                raise APIError(409, 'הדיווח לאירוע זה נסגר. יש לפנות לגבאי.')
            if any(not 0 <= value[prayer] <= status['allocatedSeats'] for prayer in ('arvit', 'shacharit')):
                raise APIError(400, 'מספר המקומות חייב להיות בין אפס למכסה המשפחתית.')
            needed = {prayer: status['allocatedSeats'] - value[prayer] if event['mode'] == 'unused' else value[prayer] for prayer in ('arvit', 'shacharit')}
            db.execute('''INSERT INTO seating_reports
                (event_id,person_id,event_revision,allocation_revision,allocation_snapshot,arvit_value,shacharit_value,arvit_needed,shacharit_needed,updated_at,submitted_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id,person_id) DO UPDATE SET
                event_revision=excluded.event_revision,allocation_revision=excluded.allocation_revision,
                allocation_snapshot=excluded.allocation_snapshot,arvit_value=excluded.arvit_value,
                shacharit_value=excluded.shacharit_value,arvit_needed=excluded.arvit_needed,
                shacharit_needed=excluded.shacharit_needed,updated_at=excluded.updated_at,submitted_by=excluded.submitted_by''',
                (event['id'], user['id'], event['revision'], status['allocationRevision'], status['allocatedSeats'], value['arvit'], value['shacharit'], needed['arvit'], needed['shacharit'], now.isoformat(), user['id']))
            return self._seating_status(db, event, person, now)

    def save_seating_event(self, user, value, identifier=None):
        self.require_gabbai(user)
        allowed = {'date', 'title', 'mode', 'occasion', 'reportingOpen', 'closesAt', 'makeCurrent'}
        if not isinstance(value, dict) or not value or set(value) - allowed:
            raise APIError(400, 'פרטי אירוע המקומות אינם תקינים.')
        now = current_time()
        today = now.astimezone(ISRAEL).date()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT * FROM seating_events WHERE id=?', (identifier,)).fetchone() if identifier else None
            if identifier and old is None:
                raise APIError(404, 'אירוע הדיווח לא נמצא.')
            if not old and not {'date', 'mode'} <= set(value):
                raise APIError(400, 'יש לבחור תאריך ואופן דיווח.')
            raw_date = value.get('date', old['event_date'] if old else '')
            try:
                if not isinstance(raw_date, str) or len(raw_date) != 10:
                    raise ValueError()
                day = date.fromisoformat(raw_date)
                if day.isoformat() != raw_date or day < today:
                    raise ValueError()
            except ValueError:
                raise APIError(400, 'יש לבחור תאריך נוכחי או עתידי תקין.')
            if old and old['event_date'] != raw_date:
                raise APIError(400, 'למועד אחר יש ליצור אירוע חדש כדי לא להעביר אליו דיווחים קיימים.')
            mode = value.get('mode', old['mode'] if old else None)
            occasion = value.get('occasion', old['occasion'] if old else special_occasion(day) or 'custom')
            if not isinstance(mode, str) or mode not in MODES or not isinstance(occasion, str) or occasion not in OCCASIONS:
                raise APIError(400, 'אופן הדיווח או סוג האירוע אינו תקין.')
            if (special_occasion(day) or occasion in ('zachor', 'high_holidays', 'megillah_evening')) and mode != 'needed':
                raise APIError(400, 'באירוע מיוחד זה יש לדווח כמה מקומות צריכים בפועל.')
            title = text(value.get('title', old['title'] if old else event_title(day)), 'כותרת האירוע', required=True)
            opened = value.get('reportingOpen', bool(old['reporting_open']) if old else True)
            activate = value.get('makeCurrent', not old)
            if type(opened) is not bool or type(activate) is not bool:
                raise APIError(400, 'מצב קבלת הדיווחים אינו תקין.')
            closes = value.get('closesAt', old['closes_at'] if old else None)
            closes = timestamp(closes) if closes is not None else None
            revision = old['revision'] + int(old['mode'] != mode or old['title'] != title or old['occasion'] != occasion) if old else 1
            identifier = identifier or 'seating-' + secrets.token_hex(16)
            if activate:
                db.execute('DELETE FROM seating_reports WHERE event_id!=?', (identifier,))
                db.execute('UPDATE seating_events SET is_current=0 WHERE is_current=1')
            db.execute('''INSERT INTO seating_events
                (id,event_date,title,mode,occasion,revision,reporting_open,closes_at,is_current)
                VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,mode=excluded.mode,
                occasion=excluded.occasion,revision=excluded.revision,reporting_open=excluded.reporting_open,
                closes_at=excluded.closes_at,is_current=CASE WHEN ? THEN 1 ELSE seating_events.is_current END''',
                (identifier, day.isoformat(), title, mode, occasion, revision, int(opened), closes, int(activate), int(activate)))
            return event_value(db.execute('SELECT * FROM seating_events WHERE id=?', (identifier,)).fetchone(), now)

    def seating_events(self, user):
        self.require_gabbai(user)
        now = current_time()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            self._current_seating_event(db, now)
            return [event_value(row, now) for row in db.execute('SELECT * FROM seating_events ORDER BY event_date DESC,id').fetchall()]

    def seating_summary(self, user, identifier):
        self.require_gabbai(user)
        now = current_time()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            self._current_seating_event(db, now)
            event = db.execute('SELECT * FROM seating_events WHERE id=?', (identifier,)).fetchone()
            if event is None:
                raise APIError(404, 'אירוע הדיווח לא נמצא.')
            rows = db.execute("SELECT * FROM roster_people WHERE classification='א' AND active=1 ORDER BY last_name,first_name,display_name,id").fetchall()
            households = []
            for row in rows:
                status = self._seating_status(db, event, row, now)
                name = ' '.join(part for part in (row['first_name'], row['last_name']) if part) or row['display_name']
                households.append(dict(personId=row['id'], name=name, **{key: status[key] for key in
                    ('allocatedSeats', 'allocationRevision', 'reported', 'value', 'neededSeats', 'releasedSeats', 'reportInvalidated', 'updatedAt')}))
            return dict(event=event_value(event, now), households=households,
                        totalAllocated=sum(row['allocatedSeats'] or 0 for row in households),
                        totalNeeded={prayer: sum((row['neededSeats'] or {}).get(prayer, 0) for row in households) for prayer in ('arvit', 'shacharit')},
                        totalReleased={prayer: sum((row['releasedSeats'] or {}).get(prayer, 0) for row in households) for prayer in ('arvit', 'shacharit')},
                        unreportedHouseholds=sum(not row['reported'] for row in households),
                        unconfiguredHouseholds=sum(row['allocatedSeats'] is None for row in households))
