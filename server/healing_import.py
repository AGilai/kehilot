"""Local roster-linked healing imports; never create or infer login accounts."""
import secrets

from .validation import APIError, civil_date, text


def initialize(db):
    columns = {row['name']: row for row in db.execute('PRAGMA table_info(healing_prayers)')}
    if 'submitter_name' in columns:
        return
    # Preserve existing requests, identities, dates and ordering atomically.
    db.execute('''CREATE TABLE healing_prayers_upgrade (
        id TEXT PRIMARY KEY,
        member_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        roster_person_id TEXT REFERENCES roster_people(id),
        submitter_name TEXT,
        name TEXT NOT NULL, added_on TEXT NOT NULL,
        CHECK ((member_id IS NOT NULL) + (roster_person_id IS NOT NULL) + (submitter_name IS NOT NULL) = 1),
        CHECK (submitter_name IS NULL OR length(trim(submitter_name)) > 0),
        UNIQUE(member_id,name), UNIQUE(roster_person_id,name), UNIQUE(submitter_name,name))''')
    fields = 'id,member_id,roster_person_id,name,added_on' if 'roster_person_id' in columns else 'id,member_id,name,added_on'
    db.execute(f'''INSERT INTO healing_prayers_upgrade ({fields})
        SELECT {fields} FROM healing_prayers ORDER BY rowid''')
    db.execute('DROP TABLE healing_prayers')
    db.execute('ALTER TABLE healing_prayers_upgrade RENAME TO healing_prayers')
    db.execute('CREATE INDEX healing_prayers_member_date ON healing_prayers(member_id,added_on)')
    db.execute('CREATE INDEX healing_prayers_roster_date ON healing_prayers(roster_person_id,added_on)')


def import_requests(db, entries, apply=False):
    """Plan/apply one atomic batch with explicit roster IDs and ISO dates.

    A matched submitter name is required as a second identity check. An explicit
    unmatchedSubmitter:true permits an authorized name-only exception. Identical
    rows are safe to re-run; conflicting dates fail instead of overwriting.
    This is local administrative tooling, not a member-facing endpoint.
    """
    if not isinstance(entries, list) or not entries:
        raise APIError(400, 'יש לספק רשימת שמות לייבוא.')
    result, seen = [], set()
    for item in entries:
        fields = {'rosterPersonId', 'submitter', 'name', 'addedOn'}
        if not isinstance(item, dict) or set(item) not in (fields, fields | {'unmatchedSubmitter'}):
            raise APIError(400, 'מבנה רשומת הייבוא אינו תקין.')
        unmatched = item.get('unmatchedSubmitter', False)
        if type(unmatched) is not bool or (unmatched and item['rosterPersonId'] is not None):
            raise APIError(400, 'רשומה ללא התאמה חייבת להיות מסומנת במפורש וללא מזהה מתפלל.')
        identifier = None if unmatched else text(item['rosterPersonId'], 'מזהה מתפלל', 100, True)
        submitter = text(item['submitter'], 'שם המתפלל', required=True)
        name = text(item['name'], 'שם החולה ושם האם', required=True)
        added_on = civil_date(item['addedOn'], 'תאריך הוספה', required=True)
        person = db.execute('SELECT * FROM roster_people WHERE id=? AND active=1', (identifier,)).fetchone() if identifier else None
        if not unmatched and person is None:
            raise APIError(400, 'המתפלל אינו נמצא ברשימת המתפללים הפעילים.')
        roster_name = ((person['first_name'] + ' ' + person['last_name']).strip() or person['display_name']) if person else submitter
        if submitter != roster_name:
            raise APIError(400, 'שם המכניס אינו תואם למזהה המתפלל שאושר.')
        key = (identifier or submitter, name)
        if key in seen:
            raise APIError(400, 'שם זה מופיע פעמיים לאותו מתפלל בקובץ הייבוא.')
        seen.add(key)
        # A roster row linked to an actual self account uses that account's
        # existing ownership; a standalone imported person retains roster ID.
        member_id = None
        if person and person['source_person_id']:
            owner = db.execute("SELECT owner_user_id FROM community_people WHERE id=? AND relationship='self'", (person['source_person_id'],)).fetchone()
            if owner:
                member_id = owner['owner_user_id']
        existing = db.execute('''SELECT * FROM healing_prayers
            WHERE name=? AND (roster_person_id=? OR member_id=? OR submitter_name=?)''',
            (name, identifier, member_id, submitter if unmatched else None)).fetchall()
        if any(row['added_on'] != added_on for row in existing):
            raise APIError(409, 'שם זה כבר קיים למתפלל עם תאריך הוספה שונה.')
        result.append(dict(rosterPersonId=identifier, memberId=member_id, submitter=roster_name,
                           unmatchedSubmitter=unmatched, name=name, addedOn=added_on, status='existing' if existing else 'new'))
    # Validate the complete batch before inserting anything.
    if apply:
        for row in result:
            if row['status'] == 'new':
                db.execute('''INSERT INTO healing_prayers (id,member_id,roster_person_id,submitter_name,name,added_on)
                    VALUES (?,?,?,?,?,?)''', ('prayer-' + secrets.token_hex(16), row['memberId'],
                    None if row['memberId'] else row['rosterPersonId'],
                    row['submitter'] if row['unmatchedSubmitter'] else None, row['name'], row['addedOn']))
    return result
