"""Gabbai editing with authoritative family synchronization and stable IDs."""
from datetime import date
import json

from pyluach import dates
from .validation import APIError, profile, text, civil_date, israel_today
from .classifications import classification_value
from .phone_auth import check_profile_phone
from .hebrew_calendar import bar_mitzvah_date
from .seating import event_title


def aliyah_template(day):
    hebrew = dates.HebrewDate.from_pydate(day)
    festival = hebrew.festival(israel=True, hebrew=True, include_working_days=False)
    if day.weekday() != 5 and festival is None:
        raise APIError(400, 'יש לבחור שבת או יום טוב בלוח ישראל.')
    total = 7 if day.weekday() == 5 else 6 if hebrew.month == 7 and hebrew.day == 10 else 5
    reading = ('א׳' if hebrew.day == 1 else 'ב׳') + ' ראש השנה' if hebrew.month == 7 and hebrew.day in (1, 2) else event_title(day)
    return dict(date=day.isoformat(), reading=reading, regularCount=total,
                allowExtra=not bool(hebrew.festival(israel=True, include_working_days=True)),
                slots=[dict(position='כהן', tribe='kohen'), dict(position='לוי', tribe='levi')]
                + [dict(position=f'ישראל {index}', tribe='yisrael') for index in range(1, total - 1)]
                + [dict(position='מפטיר', tribe=None)])


class GabbaiStore:
    @staticmethod
    def _set_family_classification(db, identifier, classification):
        row = db.execute('SELECT * FROM roster_people WHERE id=?', (identifier,)).fetchone()
        source = db.execute('SELECT * FROM community_people WHERE id=?', (row['source_person_id'],)).fetchone() if row['source_person_id'] else None
        db.execute('UPDATE roster_people SET classification_override=? WHERE id=?', (classification, identifier))
        if source and source['relationship'] == 'son' and classification in ('דור ב', 'דור ב-נשוי'):
            if classification == 'דור ב-נשוי':
                db.execute('UPDATE community_people SET married=1 WHERE id=?', (identifier,))
            else:
                db.execute("UPDATE community_people SET married=0,spouse_name='',spouse_prayer_name='' WHERE id=?", (identifier,))
        db.execute('UPDATE roster_people SET classification=? WHERE id=?', (classification, identifier))

    def person_details(self, user, identifier):
        self.require_gabbai(user)
        with self.db() as db:
            self._refresh_roster(db, israel_today())
            row = db.execute('SELECT * FROM roster_people WHERE id=?', (identifier,)).fetchone()
            if row is None:
                raise APIError(404, 'המתפלל לא נמצא.')
            source = db.execute('SELECT * FROM community_people WHERE id=?', (row['source_person_id'],)).fetchone() if row['source_person_id'] else None
            kind = source['relationship'] if source else 'son_in_law' if row['family_child_id'] else 'independent'
            person = self._roster_value(db, row, israel_today())
            if kind == 'self':
                details = self._read_profile(db, identifier)
            else:
                details = dict(name=person['name'], firstName=person['firstName'], lastName=person['lastName'],
                    tribe=person['tribe'], phone='', wifePhone='', birthDate=source['birth_date'] if source else '',
                    torahName=person['torahName'], wifePrayerName=person['wifePrayerName'],
                    barMitzvahParasha=person['barMitzvahParasha'], hebrewBirthDate=person['hebrewBirthDate'],
                    yahrzeits=person['yahrzeits'], children=[])
            owner = source['owner_user_id'] if source else None
            account = db.execute('SELECT email,role FROM users WHERE id=?', (identifier,)).fetchone() if kind == 'self' else None
            return dict(person=person, profile=details, kind=kind, ownerId=owner, account=dict(email='' if account['email'].endswith('@phone.invalid') else account['email'], role=account['role']) if account else None,
                        verifiedPhone=self.verified_phone(dict(id=identifier)) if kind == 'self' else None)

    def save_person_details(self, user, identifier, value):
        self.require_gabbai(user)
        if not isinstance(value, dict) or set(value) != {'profile', 'classification', 'allocatedSeats', 'barMitzvahDate'}:
            raise APIError(400, 'פרטי המתפלל אינם תקינים.')
        classification, allocation = value['classification'], value['allocatedSeats']
        with self.db() as db:
            classification = classification_value(db, classification)
        if allocation is not None and (type(allocation) is not int or not 0 <= allocation <= 1000 or classification != 'א'):
            raise APIError(400, 'מכסת מקומות ניתנת לחבר עמותה בלבד, בין 0 ל־1000.')
        previous = self.person_details(user, identifier)
        clean = profile(value['profile'], previous['profile'])
        if previous['kind'] != 'self' and clean['children']:
            raise APIError(400, 'עריכת המשפחה מתבצעת דרך ראש המשפחה.')
        ceremony = civil_date(value['barMitzvahDate'], 'שבת בר המצווה', allow_future=True)
        if ceremony and date.fromisoformat(ceremony).weekday() != 5:
            raise APIError(400, 'תאריך בר המצווה צריך להיות שבת.')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT * FROM roster_people WHERE id=?', (identifier,)).fetchone()
            if previous['kind'] == 'self':
                check_profile_phone(db, identifier, clean)
                self._sync_children(db, identifier, clean['children'])
                db.execute('UPDATE users SET profile=? WHERE id=?', (json.dumps({k: v for k, v in clean.items() if k != 'children'}, ensure_ascii=False), identifier))
                self._sync_self(db, identifier, clean)
                db.execute('UPDATE community_people SET bar_mitzvah_date=? WHERE id=?', (ceremony, identifier))
            elif previous['kind'] == 'son':
                father = self._read_profile(db, previous['ownerId'])
                if clean['tribe'] != father['tribe']:
                    raise APIError(400, 'מעמד הבן נקבע לפי האב; יש לערוך את האב כדי לשנותו.')
                child = next(child for child in father['children'] if child['id'] == identifier)
                child.update(name=clean['name'], birthDate=clean['birthDate'], hebrewBirthDate=clean['hebrewBirthDate'],
                    torahName=clean['torahName'], barMitzvahParasha=clean['barMitzvahParasha'], barMitzvahDate=ceremony,
                    spousePrayerName=clean['wifePrayerName'] if child['married'] or classification == 'דור ב-נשוי' else '')
                self._sync_children(db, previous['ownerId'], father['children'])
            elif previous['kind'] == 'son_in_law':
                db.execute('UPDATE community_people SET spouse_name=?,spouse_tribe=?,spouse_torah_name=? WHERE id=?',
                           (clean['name'], clean['tribe'], clean['torahName'], old['family_child_id']))
            db.execute('''UPDATE roster_people SET first_name=?,last_name=?,display_name=?,tribe=?,torah_name=?,wife_prayer_name=?,
                bar_mitzvah_parasha=?,bar_mitzvah_date=?,hebrew_birth_date=?,yahrzeits=?,allocated_seats=?,
                seat_allocation_revision=seat_allocation_revision+? WHERE id=?''',
                (clean['firstName'], clean['lastName'], clean['name'], clean['tribe'], clean['torahName'], clean['wifePrayerName'],
                 clean['barMitzvahParasha'], ceremony, json.dumps(clean['hebrewBirthDate']), json.dumps(clean['yahrzeits'], ensure_ascii=False),
                 allocation, int(old['allocated_seats'] != allocation), identifier))
            if previous['kind'] in ('independent', 'son_in_law'):
                eligible = bar_mitzvah_date(clean['hebrewBirthDate'], israel_today())
                db.execute('UPDATE roster_people SET eligible_from=?,active=? WHERE id=?', (eligible.isoformat() if eligible else None, int(eligible is None or eligible <= israel_today()), identifier))
            self._set_family_classification(db, identifier, classification)
            self._refresh_roster(db, israel_today())
        return self.person_details(user, identifier)

    def aliyah_template(self, user, raw_date):
        self.require_gabbai(user)
        day = date.fromisoformat(civil_date(raw_date, 'תאריך העליות', required=True))
        return aliyah_template(day)

    def save_complete_aliyot(self, user, value, identifier=None):
        self.require_gabbai(user)
        if not isinstance(value, dict) or set(value) - {'date', 'reading', 'calls', 'cancelled'} or not {'date', 'reading', 'calls'} <= set(value):
            raise APIError(400, 'פרטי העליות אינם תקינים.')
        template = self.aliyah_template(user, value['date'])
        calls = value['calls']
        if not isinstance(calls, list) or not len(template['slots']) <= len(calls) <= 100:
            raise APIError(400, 'יש למלא את כל העליות, כולל מפטיר.')
        extra = len(calls) - len(template['slots'])
        if extra and not template['allowExtra']:
            raise APIError(400, 'בחג אין להוסיף עליות מעבר למספר הקבוע.')
        slots = template['slots'][:-1] + [dict(position=f"ישראל {template['regularCount'] - 1 + index}", tribe='yisrael') for index in range(extra)] + template['slots'][-1:]
        with self.db() as db:
            for item, slot in zip(calls, slots):
                if not isinstance(item, dict) or item.get('position') != slot['position']:
                    raise APIError(400, 'סדר העליות חייב לכלול כהן, לוי, ישראלים ומפטיר.')
                if item.get('guest') is True and set(item) == {'position', 'guest'}:
                    continue
                person = db.execute('SELECT tribe FROM roster_people WHERE id=?', (item.get('personId'),)).fetchone() if isinstance(item.get('personId'), str) else None
                if not person or (slot['tribe'] and person['tribe'] != slot['tribe']):
                    raise APIError(400, 'יש לבחור מתפלל במעמד המתאים לעלייה או אורח.')
        return self.save_aliyah_service(user, {**value, 'service': 'shacharit'}, identifier)
