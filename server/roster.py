"""Gabbai roster and recorded aliyot. Person IDs survive every age transition."""
from datetime import date, datetime, timezone
import json
import secrets
import threading

from .hebrew_calendar import bar_mitzvah_date, hebrew_label, is_shabbat_or_festival, months_before
from .validation import APIError, civil_date, israel_today, profile, text, tribe

from .classifications import classification_value, initialize as initialize_classifications


def stamp():
    return datetime.now(timezone.utc).isoformat()


def initialize(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS roster_people (
            id TEXT PRIMARY KEY,
            source_person_id TEXT UNIQUE REFERENCES community_people(id),
            family_child_id TEXT UNIQUE REFERENCES community_people(id),
            first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '',
            display_name TEXT NOT NULL DEFAULT '', tribe TEXT NOT NULL DEFAULT '',
            torah_name TEXT NOT NULL DEFAULT '', wife_prayer_name TEXT NOT NULL DEFAULT '',
            bar_mitzvah_parasha TEXT NOT NULL DEFAULT '', bar_mitzvah_date TEXT NOT NULL DEFAULT '',
            hebrew_birth_date TEXT, yahrzeits TEXT NOT NULL DEFAULT '[]',
            classification TEXT NOT NULL DEFAULT '', eligible_from TEXT,
            active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            CHECK(source_person_id IS NULL OR source_person_id=id));
        CREATE TABLE IF NOT EXISTS aliyah_services (
            id TEXT PRIMARY KEY, service_date TEXT NOT NULL,
            service TEXT NOT NULL CHECK(service IN ('shacharit','mincha')),
            reading TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0,
            recorded_by TEXT NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(service_date,service));
        CREATE TABLE IF NOT EXISTS aliyah_calls (
            service_id TEXT NOT NULL REFERENCES aliyah_services(id),
            position TEXT NOT NULL, person_id TEXT NOT NULL REFERENCES roster_people(id),
            person_name TEXT NOT NULL, PRIMARY KEY(service_id,position));
        CREATE INDEX IF NOT EXISTS aliyah_calls_person ON aliyah_calls(person_id,service_id);
        CREATE INDEX IF NOT EXISTS aliyah_service_dates ON aliyah_services(service_date,cancelled);
    ''')

    columns = {row['name'] for row in db.execute('PRAGMA table_info(roster_people)')}
    if 'classification_override' not in columns:
        db.execute('ALTER TABLE roster_people ADD COLUMN classification_override TEXT')
    call_columns = {row['name']: row for row in db.execute('PRAGMA table_info(aliyah_calls)')}
    if call_columns['person_id']['notnull']:
        db.executescript('''
            CREATE TABLE aliyah_calls_with_guests (
                service_id TEXT NOT NULL REFERENCES aliyah_services(id), position TEXT NOT NULL,
                person_id TEXT REFERENCES roster_people(id), person_name TEXT NOT NULL,
                PRIMARY KEY(service_id,position));
            INSERT INTO aliyah_calls_with_guests SELECT * FROM aliyah_calls;
            DROP TABLE aliyah_calls;
            ALTER TABLE aliyah_calls_with_guests RENAME TO aliyah_calls;
            CREATE INDEX aliyah_calls_person ON aliyah_calls(person_id,service_id);
        ''')

    initialize_classifications(db)


class RosterStore:
    def _refresh_roster(self, db, today):
        # Retain past roster entries and their history even after a birthday
        # correction, family archival or loss of the source's eligibility.
        db.execute('UPDATE roster_people SET active=0 WHERE source_person_id IS NOT NULL')
        db.execute('UPDATE roster_people SET active=(eligible_from<=?) WHERE source_person_id IS NULL AND eligible_from IS NOT NULL', (today.isoformat(),))
        rows = db.execute("SELECT * FROM community_people WHERE active=1 AND relationship IN ('self','son')").fetchall()
        for row in rows:
            birthday = json.loads(row['hebrew_birth_date']) if row['hebrew_birth_date'] else None
            eligible = bar_mitzvah_date(birthday, today)
            if (eligible is not None and eligible > today) or (row['relationship'] == 'son' and eligible is None):
                continue
            if row['relationship'] == 'self':
                member = json.loads(db.execute('SELECT profile FROM users WHERE id=?', (row['owner_user_id'],)).fetchone()[0])
                first, last = member.get('firstName', ''), member.get('lastName', '')
                status, wife = row['tribe'], member.get('wifePrayerName', '')
                yahrzeits = json.dumps(member.get('yahrzeits', []), ensure_ascii=False)
            else:
                first, last = '', ''
                father = db.execute("SELECT tribe FROM community_people WHERE id=? AND relationship='self'", (row['owner_user_id'],)).fetchone()
                status, wife = (father['tribe'] if father else ''), row['spouse_prayer_name'] if row['married'] else ''
                yahrzeits = '[]'
            timestamp = stamp()
            db.execute('''INSERT INTO roster_people
                (id,source_person_id,display_name,tribe,torah_name,wife_prayer_name,bar_mitzvah_parasha,
                 bar_mitzvah_date,hebrew_birth_date,yahrzeits,eligible_from,created_at,updated_at,first_name,last_name)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                first_name=CASE WHEN excluded.first_name!='' AND excluded.last_name!='' THEN excluded.first_name ELSE roster_people.first_name END,
                last_name=CASE WHEN excluded.first_name!='' AND excluded.last_name!='' THEN excluded.last_name ELSE roster_people.last_name END,
                display_name=excluded.display_name,tribe=excluded.tribe,torah_name=excluded.torah_name,
                wife_prayer_name=excluded.wife_prayer_name,bar_mitzvah_parasha=excluded.bar_mitzvah_parasha,
                bar_mitzvah_date=excluded.bar_mitzvah_date,hebrew_birth_date=excluded.hebrew_birth_date,
                yahrzeits=CASE WHEN ?='self' THEN excluded.yahrzeits ELSE roster_people.yahrzeits END,
                eligible_from=excluded.eligible_from,active=1,updated_at=excluded.updated_at''',
                (row['id'], row['id'], row['name'], status, row['torah_name'], wife,
                 row['bar_mitzvah_parasha'], row['bar_mitzvah_date'], row['hebrew_birth_date'], yahrzeits,
                 eligible.isoformat() if eligible else None, timestamp, timestamp, first, last, row['relationship']))

        db.execute("UPDATE roster_people SET classification='א' WHERE classification='' AND id IN (SELECT id FROM users WHERE role='gabbai')")
        db.execute("""UPDATE roster_people SET classification=COALESCE(classification_override,(
            SELECT CASE WHEN father.classification='א' THEN
                CASE WHEN child.married=1 THEN 'דור ב-נשוי' ELSE 'דור ב' END
                WHEN father.classification!='' THEN 'קבוע' ELSE '' END
            FROM community_people child LEFT JOIN roster_people father ON father.id=child.owner_user_id
            WHERE child.id=roster_people.source_person_id AND child.relationship='son'), classification)
            WHERE source_person_id IN (SELECT id FROM community_people WHERE relationship='son')""")
        # A daughter's permanent identity is kept; her husband gets a distinct,
        # stable roster identity, reusing any pre-existing explicitly linked row.
        daughters = db.execute("""SELECT c.*,r.classification AS household_classification
            FROM community_people c JOIN roster_people r ON r.id=c.owner_user_id
            WHERE c.relationship='daughter'""").fetchall()
        for child in daughters:
            old = db.execute('SELECT id,classification,eligible_from FROM roster_people WHERE family_child_id=?', (child['id'],)).fetchone()
            should_create = child['active'] and child['married'] and child['spouse_name'] and child['household_classification'] == 'א'
            if not old and not should_create:
                continue
            identifier = old['id'] if old else 'person-' + secrets.token_hex(16)
            override = db.execute('SELECT classification_override FROM roster_people WHERE id=?', (identifier,)).fetchone()
            classification = override[0] if override and override[0] else 'חתן' if child['household_classification'] == 'א' else 'קבוע' if child['household_classification'] else old['classification'] if old else ''
            active = int(bool(child['active'] and child['married'] and child['spouse_name']) and
                         (not old or not old['eligible_from'] or old['eligible_from'] <= today.isoformat()))
            timestamp = stamp()
            db.execute("""INSERT INTO roster_people
                (id,family_child_id,display_name,tribe,torah_name,classification,active,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                display_name=excluded.display_name,tribe=excluded.tribe,torah_name=excluded.torah_name,
                classification=excluded.classification,active=excluded.active,updated_at=excluded.updated_at""",
                (identifier,child['id'],child['spouse_name'],child['spouse_tribe'],child['spouse_torah_name'],classification,active,timestamp,timestamp))
        # Derived children/sons-in-law never own an association seat allocation.
        db.execute("""UPDATE roster_people SET allocated_seats=NULL,seat_allocation_revision=seat_allocation_revision+1
            WHERE classification!='א' AND allocated_seats IS NOT NULL""")

    def refresh_roster(self, today=None):
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            self._refresh_roster(db, today or israel_today())
            from .seating import current_time
            self._current_seating_event(db, current_time())

    @staticmethod
    def _roster_value(db, row, today):
        classification = row['classification']
        if not classification and row['source_person_id']:
            source = db.execute('SELECT relationship,owner_user_id,married FROM community_people WHERE id=?', (row['id'],)).fetchone()
            if source['relationship'] == 'son':
                father = db.execute('SELECT classification FROM roster_people WHERE id=?', (source['owner_user_id'],)).fetchone()
                if father and father['classification']:
                    classification = ('דור ב-נשוי' if source['married'] else 'דור ב') if father['classification'] == 'א' else 'קבוע'
        window = 6 if row['tribe'] in ('kohen', 'levi') else 12 if row['tribe'] == 'yisrael' else None
        lower = months_before(today, window).isoformat() if window else None
        count = db.execute('''SELECT COUNT(*) FROM aliyah_calls c JOIN aliyah_services s ON s.id=c.service_id
            WHERE c.person_id=? AND s.cancelled=0 AND s.service_date>=? AND s.service_date<=?''',
            (row['id'], lower, today.isoformat())).fetchone()[0] if window else None
        last = db.execute('''SELECT s.service_date,s.reading FROM aliyah_calls c JOIN aliyah_services s ON s.id=c.service_id
            WHERE c.person_id=? AND s.cancelled=0 AND s.service_date<=?
            ORDER BY s.service_date DESC,CASE s.service WHEN 'mincha' THEN 1 ELSE 0 END DESC LIMIT 1''',
            (row['id'], today.isoformat())).fetchone()
        name = ' '.join(part for part in (row['first_name'], row['last_name']) if part) or row['display_name']
        return dict(id=row['id'], sourcePersonId=row['source_person_id'], familyChildId=row['family_child_id'],
                    firstName=row['first_name'], lastName=row['last_name'], name=name, tribe=row['tribe'],
                    torahName=row['torah_name'], wifePrayerName=row['wife_prayer_name'],
                    barMitzvahParasha=row['bar_mitzvah_parasha'], barMitzvahDate=row['bar_mitzvah_date'],
                    hebrewBirthDate=json.loads(row['hebrew_birth_date']) if row['hebrew_birth_date'] else None,
                    yahrzeits=json.loads(row['yahrzeits']), classification=classification,
                    eligibleFrom=row['eligible_from'], windowMonths=window, aliyahCount=count,
                    allocatedSeats=row['allocated_seats'], seatAllocationRevision=row['seat_allocation_revision'],
                    lastAliyahDate=last['service_date'] if last else None,
                    lastAliyah=f"{hebrew_label(date.fromisoformat(last['service_date']))} · {last['reading']}" if last else 'לא נמצא')

    def roster(self, user, today=None):
        self.require_gabbai(user)
        today = today or israel_today()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            self._refresh_roster(db, today)
            return [self._roster_value(db, row, today) for row in db.execute('SELECT * FROM roster_people WHERE active=1 ORDER BY last_name,first_name,display_name,id').fetchall()]

    def save_roster_person(self, user, value, identifier=None):
        self.require_gabbai(user)
        allowed = {'firstName', 'lastName', 'tribe', 'torahName', 'wifePrayerName', 'barMitzvahParasha',
                   'barMitzvahDate', 'hebrewBirthDate', 'yahrzeits', 'classification', 'familyChildId', 'allocatedSeats'}
        if not isinstance(value, dict) or set(value) - allowed or not value:
            raise APIError(400, 'פרטי המתפלל אינם תקינים.')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            self._refresh_roster(db, israel_today())
            old = db.execute('SELECT * FROM roster_people WHERE id=?', (identifier,)).fetchone() if identifier else None
            if identifier and not old:
                raise APIError(404, 'המתפלל לא נמצא.')
            if old and old['source_person_id'] and set(value) - {'firstName', 'lastName', 'classification', 'yahrzeits', 'allocatedSeats'}:
                raise APIError(400, 'פרטי המשפחה מתעדכנים דרך הפרופיל המקושר.')
            if old and old['source_person_id'] and 'yahrzeits' in value:
                relation = db.execute('SELECT relationship FROM community_people WHERE id=?', (identifier,)).fetchone()[0]
                if relation == 'self':
                    raise APIError(400, 'ימי הזיכרון מתעדכנים דרך הפרופיל המקושר.')
            previous = self._roster_value(db, old, israel_today()) if old else {}
            data = {**dict(firstName='', lastName='', tribe='', torahName='', wifePrayerName='', barMitzvahParasha='',
                           barMitzvahDate='', hebrewBirthDate=None, yahrzeits=[], classification='', familyChildId=None),
                    **previous, **value}
            for key in ('firstName', 'lastName'):
                data[key] = text(data[key], key, required=not old)
            status = tribe(data['tribe'], required=not old)
            classification = value.get('classification', old['classification'] if old else '')
            classification = classification_value(db, classification, allow_empty=bool(old) and 'classification' not in value)
            data['classification'] = classification
            allocation = value.get('allocatedSeats', old['allocated_seats'] if old else None)
            if allocation is not None and (type(allocation) is not int or not 0 <= allocation <= 1000):
                raise APIError(400, 'מכסת המקומות חייבת להיות מספר שלם בין 0 ל־1000.')
            if data['classification'] != 'א':
                if value.get('allocatedSeats') is not None:
                    raise APIError(400, 'מכסת מקומות נשמרת עבור ראש משפחה חבר עמותה בלבד.')
                allocation = None
            allocation_revision = old['seat_allocation_revision'] + int(old['allocated_seats'] != allocation) if old else 1
            # Reuse the profile's bounded names, birthday and yahrzeit validation.
            clean = profile(dict(name=(data['firstName'] + ' ' + data['lastName']).strip() or previous.get('name', ''),
                                 torahName=data['torahName'], wifePrayerName=data['wifePrayerName'],
                                 barMitzvahParasha=data['barMitzvahParasha'], birthDate='',
                                 hebrewBirthDate=data['hebrewBirthDate'], yahrzeits=data['yahrzeits']),
                            existing=dict(tribe=status, hebrewBirthDate=data['hebrewBirthDate']))
            ceremony = civil_date(data['barMitzvahDate'], 'שבת בר המצווה', allow_future=True)
            if ceremony and date.fromisoformat(ceremony).weekday() != 5:
                raise APIError(400, 'תאריך בר המצווה צריך להיות שבת.')
            family = data['familyChildId']
            if family is not None:
                if not isinstance(family, str):
                    raise APIError(400, 'קישור משפחתי אינו תקין.')
                daughter = db.execute("SELECT id FROM community_people WHERE id=? AND relationship='daughter' AND married=1 AND active=1", (family,)).fetchone()
                if not daughter:
                    raise APIError(400, 'יש לבחור בת נשואה מהמשפחה.')
                if db.execute('SELECT id FROM roster_people WHERE family_child_id=? AND id!=?', (family, identifier or '')).fetchone():
                    raise APIError(409, 'לבן הזוג כבר קיימת רשומה. יש לעדכן אותה.')
            identifier = identifier or 'person-' + secrets.token_hex(16)
            timestamp = stamp()
            eligible = bar_mitzvah_date(clean['hebrewBirthDate'], israel_today())
            eligible_from = eligible.isoformat() if eligible else None
            active = int(eligible is None or eligible <= israel_today())
            if old and old['source_person_id']:
                eligible_from, active = old['eligible_from'], old['active']
                if {'firstName', 'lastName'} & set(value):
                    source = db.execute('SELECT relationship FROM community_people WHERE id=?', (identifier,)).fetchone()
                    if source['relationship'] == 'self':
                        if not data['firstName'] or not data['lastName']:
                            raise APIError(400, 'יש להזין שם פרטי ושם משפחה בנפרד.')
                        account = json.loads(db.execute('SELECT profile FROM users WHERE id=?', (identifier,)).fetchone()[0])
                        account.update(firstName=data['firstName'], lastName=data['lastName'], name=clean['name'])
                        db.execute('UPDATE users SET profile=? WHERE id=?', (json.dumps(account, ensure_ascii=False), identifier))
                        self._sync_self(db, identifier, account)
            db.execute('''INSERT INTO roster_people
                (id,first_name,last_name,display_name,tribe,torah_name,wife_prayer_name,bar_mitzvah_parasha,
                 bar_mitzvah_date,hebrew_birth_date,yahrzeits,classification,family_child_id,created_at,updated_at,eligible_from,active)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
                first_name=excluded.first_name,last_name=excluded.last_name,tribe=excluded.tribe,
                torah_name=excluded.torah_name,wife_prayer_name=excluded.wife_prayer_name,
                bar_mitzvah_parasha=excluded.bar_mitzvah_parasha,bar_mitzvah_date=excluded.bar_mitzvah_date,
                hebrew_birth_date=excluded.hebrew_birth_date,yahrzeits=excluded.yahrzeits,
                classification=excluded.classification,family_child_id=excluded.family_child_id,updated_at=excluded.updated_at,
                eligible_from=excluded.eligible_from,active=excluded.active''',
                (identifier, data['firstName'], data['lastName'], clean['name'], status, clean['torahName'], clean['wifePrayerName'],
                 clean['barMitzvahParasha'], ceremony, json.dumps(clean['hebrewBirthDate']), json.dumps(clean['yahrzeits'], ensure_ascii=False),
                 classification, family, timestamp, timestamp, eligible_from, active))
            db.execute('UPDATE roster_people SET allocated_seats=?,seat_allocation_revision=? WHERE id=?', (allocation, allocation_revision, identifier))
            if 'classification' in value:
                self._set_family_classification(db, identifier, classification)
            self._refresh_roster(db, israel_today())
            return self._roster_value(db, db.execute('SELECT * FROM roster_people WHERE id=?', (identifier,)).fetchone(), israel_today())

    def save_aliyah_service(self, user, value, identifier=None):
        self.require_gabbai(user)
        if not isinstance(value, dict) or set(value) - {'date', 'service', 'reading', 'calls', 'cancelled'} or not {'date', 'service', 'reading', 'calls'} <= set(value):
            raise APIError(400, 'רשומת העליות אינה תקינה.')
        day = date.fromisoformat(civil_date(value['date'], 'תאריך העליות', required=True))
        if not is_shabbat_or_festival(day):
            raise APIError(400, 'יש לבחור שבת או חג בלוח ישראל.')
        if value['service'] not in ('shacharit', 'mincha') or type(value.get('cancelled', False)) is not bool:
            raise APIError(400, 'סוג התפילה אינו תקין.')
        reading = text(value['reading'], 'פרשה או קריאה', required=True)
        if not isinstance(value['calls'], list) or len(value['calls']) > 100:
            raise APIError(400, 'רשימת העליות אינה תקינה.')
        calls, positions = [], set()
        for item in value['calls']:
            if not isinstance(item, dict) or set(item) not in ({'position', 'personId'}, {'position', 'guest'}) or ('guest' in item and item['guest'] is not True):
                raise APIError(400, 'פרטי העלייה אינם תקינים.')
            position = text(item['position'], 'עלייה', 50, True)
            person_id = None if item.get('guest') else text(item['personId'], 'מזהה מתפלל', 100, True)
            if position in positions:
                raise APIError(400, 'אין לשייך שני מתפללים לאותה עלייה.')
            positions.add(position)
            calls.append((position, person_id))
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            self._refresh_roster(db, israel_today())
            existing = db.execute('SELECT id FROM aliyah_services WHERE id=?', (identifier,)).fetchone() if identifier else None
            if identifier and not existing:
                raise APIError(404, 'רשומת העליות לא נמצאה.')
            collision = db.execute('SELECT id FROM aliyah_services WHERE service_date=? AND service=?', (day.isoformat(), value['service'])).fetchone()
            if collision and collision['id'] != identifier:
                raise APIError(409, 'כבר קיימת רשומה לתפילה זו. יש לעדכן אותה.')
            participants = []
            for position, person_id in calls:
                if person_id is None:
                    participants.append((position, None, 'אורח'))
                    continue
                person = db.execute('SELECT * FROM roster_people WHERE id=?', (person_id,)).fetchone()
                if not person:
                    raise APIError(400, 'המתפלל לא נמצא ברשימת המתפללים.')
                # Archived people may have genuine historical calls recorded.
                if person['eligible_from'] and day.isoformat() < person['eligible_from']:
                    raise APIError(400, 'תאריך העלייה מוקדם מגיל בר המצווה.')
                name = ' '.join(part for part in (person['first_name'], person['last_name']) if part) or person['display_name']
                participants.append((position, person_id, name))
            identifier = identifier or 'service-' + secrets.token_hex(16)
            timestamp = stamp()
            db.execute('''INSERT INTO aliyah_services
                (id,service_date,service,reading,cancelled,recorded_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET service_date=excluded.service_date,service=excluded.service,
                reading=excluded.reading,cancelled=excluded.cancelled,recorded_by=excluded.recorded_by,updated_at=excluded.updated_at''',
                (identifier, day.isoformat(), value['service'], reading, int(value.get('cancelled', False)), user['id'], timestamp, timestamp))
            db.execute('DELETE FROM aliyah_calls WHERE service_id=?', (identifier,))
            db.executemany('INSERT INTO aliyah_calls VALUES (?,?,?,?)', [(identifier, *item) for item in participants])
            return self._service_value(db, identifier)

    @staticmethod
    def _service_value(db, identifier):
        row = db.execute('SELECT * FROM aliyah_services WHERE id=?', (identifier,)).fetchone()
        calls = db.execute('SELECT position,person_id,person_name FROM aliyah_calls WHERE service_id=? ORDER BY rowid', (identifier,)).fetchall()
        return dict(id=row['id'], date=row['service_date'], hebrewDate=hebrew_label(date.fromisoformat(row['service_date'])),
                    service=row['service'], reading=row['reading'], cancelled=bool(row['cancelled']),
                    calls=[dict(position=call['position'], personId=call['person_id'], nameAtRecording=call['person_name'], guest=call['person_id'] is None) for call in calls])

    def aliyah_services(self, user):
        self.require_gabbai(user)
        with self.db() as db:
            return [self._service_value(db, row['id']) for row in db.execute('SELECT id FROM aliyah_services ORDER BY service_date DESC,service').fetchall()]


def start_roster_worker(store, stop):
    def run():
        import logging
        while not stop.wait(60):
            try:
                store.refresh_roster()
            except Exception:
                logging.exception('Roster refresh failed')
    worker = threading.Thread(target=run, name='roster-birthdays', daemon=True)
    worker.start()
    return worker
