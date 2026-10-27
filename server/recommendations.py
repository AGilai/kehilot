"""Date-specific gabbai recommendations; future previews never change the roster."""
from datetime import date, timedelta
from functools import lru_cache
import json
import re

from pyluach import dates, hebrewcal, parshios

from .hebrew_calendar import MONTH_NUMBERS, hebrew_label, months_before
from .validation import APIError, civil_date, israel_today
from .settings import YAHRZEIT_CUSTOMS

RELATIONS = dict(father='אב', mother='אם', son='בן', daughter='בת', brother='אח', sister='אחות', father_in_law='חותן', mother_in_law='חותנת', uncle='דוד', aunt='דודה', unknown='לא ידוע')
MONTH_LABELS = dict(nisan='ניסן', iyar='אייר', sivan='סיון', tamuz='תמוז', av='אב', elul='אלול',
                    tishrei='תשרי', cheshvan='חשוון', kislev='כסלו', tevet='טבת', shevat='שבט',
                    adar='אדר', adar_i='אדר א׳', adar_ii='אדר ב׳')
GROUPS = [('kohen', 'כהנים', 15, 'kohen', None), ('levi', 'לוויים', 15, 'levi', None),
          ('israel_a', 'ישראל', 25, 'yisrael', 'א'),
          ('israel_b', 'ישראל — דור ב׳', 35, 'yisrael', 'דור ב'),
          ('israel_regular', 'ישראל — קבוע', 10, 'yisrael', 'קבוע')]


def service_day(day):
    return day.weekday() == 5 or dates.HebrewDate.from_pydate(day).festival(israel=True, include_working_days=False) is not None


def next_service(today):
    for offset in range(8):
        candidate = today + timedelta(days=offset)
        if service_day(candidate):
            return candidate
    raise ValueError('A week must contain a Shabbat')


def service_value(day, service='shacharit'):
    hebrew = dates.HebrewDate.from_pydate(day)
    parts = parshios.getparsha(hebrew, israel=True) if day.weekday() == 5 else None
    readings = [parshios.PARSHIOS_HEBREW[index] for index in parts] if parts else []
    # The profile spelling and the calendar spelling differ for this parasha.
    readings = ['כי תבוא' if reading == 'כי תבא' else reading for reading in readings]
    reading = '־'.join(readings) if readings else hebrew.festival(israel=True, hebrew=True, prefix_day=True) or 'שבת'
    if not readings and hebrew.month == 7 and hebrew.day == 22:
        reading = 'שמיני עצרת ושמחת תורה'
    if hebrew.month == 7 and hebrew.day == 10:
        reading += ' - מנחה' if service == 'mincha' else ' - שחרית'
    return dict(date=day.isoformat(), key=day.isoformat() + ':' + service, service=service, reading=reading, parashot=readings,
                hebrewDate=hebrew_label(day), year=hebrew.year, yearLabel=hebrew.hebrew_year(),
                title=f"שבת פרשת {reading} - {hebrew.hebrew_year()}" if readings else
                      f"{'שבת ' if day.weekday() == 5 else ''}{reading} - {hebrew.hebrew_year()}")


def normalized_parasha(value):
    value = re.sub(r'[\u0591-\u05bd\u05bf\u05c1-\u05c2\u05c4-\u05c5\u05c7]', '', value).replace('כי תבא', 'כי תבוא')
    for alias, canonical in [('בחקתי', 'בחוקותי'), ('בחוקתי', 'בחוקותי'), ('מצרע', 'מצורע')]:
        value = value.replace(alias, canonical)
    value = re.sub(r'^\s*פרשת\s+', '', value)
    return re.sub(r'[\s,\-־–—]+', ' ', value).strip()


def combined_parts(saved):
    wanted = normalized_parasha(saved)
    for index in (21, 26, 28, 31, 38, 41, 50):
        pair = tuple(parshios.PARSHIOS_HEBREW[index:index + 2])
        if wanted == normalized_parasha(' '.join(pair)):
            return pair
    return None


def parasha_matches(saved, parts):
    if not saved or not parts:
        return False
    wanted = normalized_parasha(saved)
    pair = combined_parts(saved)
    return (wanted == normalized_parasha(' '.join(parts)) or
            wanted in [normalized_parasha(part) for part in parts] or
            bool(pair and len(parts) == 1 and normalized_parasha(parts[0]) in map(normalized_parasha, pair)))


@lru_cache(maxsize=32)
def year_readings(year):
    return tuple((day.to_pydate(), tuple(parshios.PARSHIOS_HEBREW[index] for index in parts))
                 for day, parts in parshios.parshatable(year, israel=True).items() if parts)


def readings_between(first, last):
    for year in range(dates.HebrewDate.from_pydate(first).year, dates.HebrewDate.from_pydate(last).year + 1):
        yield from ((day, parts) for day, parts in year_readings(year) if first <= day <= last)


def bar_mitzvah_event(row, selected, service, called_on=frozenset()):
    ceremony = row['bar_mitzvah_date'] == selected.isoformat()
    matches = parasha_matches(row['bar_mitzvah_parasha'], service['parashot'])
    note = ''
    pair = combined_parts(row['bar_mitzvah_parasha'])
    if matches and pair and len(service['parashot']) == 1:
        if normalized_parasha(service['parashot'][0]) == normalized_parasha(pair[0]):
            note = 'ניתן להעלות גם בשבת הבאה'
        else:
            # Adjacent portions can straddle Rosh Hashanah. Search actual dated
            # readings, not Hebrew-year equality or an assumed seven-day gap.
            first_dates = [day for day, parts in readings_between(selected - timedelta(days=60), selected - timedelta(days=1))
                           if len(parts) == 1 and normalized_parasha(parts[0]) == normalized_parasha(pair[0])]
            if first_dates and max(first_dates).isoformat() in called_on:
                return None
    if ceremony or matches:
        return dict(kind='bar_mitzvah', date=selected.isoformat(), hebrewDate=hebrew_label(selected),
                    description='בר מצווה' + (f' · {note}' if note else ''), needsReview=False)
    return None


def yahrzeit_occurrences(item, year, custom=None):
    """Apply the community's specified policy, retaining unresolved edge cases."""
    month, day = item['month'], item['day']
    leap = hebrewcal.Year(year).leap
    candidates, note = [MONTH_NUMBERS[month]], ''
    if month == 'adar' and leap:
        if custom in YAHRZEIT_CUSTOMS:
            candidates = [12 if custom == 'ashkenaz' else 13]
        else:
            candidates, note = [12, 13], 'אדר בשנה מעוברת — דרוש בירור מנהג'
    elif month in ('adar_i', 'adar_ii') and not leap:
        candidates = [12]
        note = '' if custom in YAHRZEIT_CUSTOMS else 'אדר בשנה רגילה — דרוש בירור מנהג'
    result = []
    for number in candidates:
        try:
            result.append((dates.HebrewDate(year, number, day).to_pydate(), note))
        except ValueError:
            previous = dates.HebrewDate(year, number, 29)
            if custom == 'sephardi' and month in ('cheshvan', 'kislev') and day == 30:
                result.append(((previous + 1).to_pydate(), ''))
                continue
            if custom == 'ashkenaz' and month in ('cheshvan', 'kislev') and day == 30:
                # Only a missing 30th uses the simplified two-date policy.
                note = 'יש לבדוק עם המתפלל כיצד הוא נוהג'
                result.extend([(previous.to_pydate(), note), ((previous + 1).to_pydate(), note)])
                continue
            # Until configured, and for unspecified 30 Adar I edge cases, retain
            # explicit candidates rather than infer an unrequested custom.
            explanation = 'יום ל׳ חסר בחודש השנה — דרוש בירור מנהג'
            result.extend([(previous.to_pydate(), explanation), ((previous + 1).to_pydate(), explanation)])
    return result


def yahrzeit_events(row, selected, end, custom=None):
    first_year = dates.HebrewDate.from_pydate(selected).year
    last_year = dates.HebrewDate.from_pydate(end).year
    for item in json.loads(row['yahrzeits']):
        recorded = f"{dates.HebrewDate(5780, 1, item['day']).hebrew_day()} {MONTH_LABELS[item['month']]}"
        for year in range(first_year, last_year + 1):
            for occurrence, note in yahrzeit_occurrences(item, year, custom):
                if selected <= occurrence <= end:
                    label = hebrew_label(occurrence)
                    hebrew = dates.HebrewDate.from_pydate(occurrence)
                    short_date = f"{hebrew.hebrew_day()} {hebrew.month_name(hebrew=True).replace('חשון', 'חשוון')}"
                    relation = RELATIONS.get(item['relationship'], item['relationship'])
                    yield dict(kind='yahrzeit', date=occurrence.isoformat(), hebrewDate=label,
                        relationship=item['relationship'], relativeName=item['name'],
                        recordedDay=item['day'], recordedMonth=item['month'], recordedHebrewDate=recorded,
                        description=f"יארצייט - {relation} - {short_date}" + (f' · תאריך הפטירה: {recorded} · {note}' if note else ''),
                        needsReview=bool(note))


def person_events(row, selected, service, custom=None, called_on=frozenset()):
    event = bar_mitzvah_event(row, selected, service, called_on)
    return ([event] if event else []) + list(yahrzeit_events(row, selected, selected + timedelta(days=7), custom))


def has_upcoming_event(row, selected, end, custom, called_on):
    if row['bar_mitzvah_date'] and selected.isoformat() <= row['bar_mitzvah_date'] <= end.isoformat():
        return True
    if row['bar_mitzvah_parasha']:
        for day, parts in readings_between(selected, end):
            if bar_mitzvah_event(row, day, dict(parashot=parts), called_on):
                return True
    return next(yahrzeit_events(row, selected, end, custom), None) is not None


def rank(person):
    # Unknown last dates precede known dates, then stable name/ID tiebreakers.
    return (person['aliyahCount'] or 0, person['lastAliyahDate'] or '', person['lastName'], person['firstName'], person['name'], person['id'])


class RecommendationsStore:
    def recommendation_calendar(self, user, raw_year=None):
        self.require_gabbai(user)
        upcoming = next_service(israel_today())
        current = dates.HebrewDate.from_pydate(israel_today()).year
        year = dates.HebrewDate.from_pydate(upcoming).year if raw_year in (None, '') else raw_year
        try:
            year = int(year)
        except (ValueError, TypeError):
            raise APIError(400, 'יש לבחור שנה עברית תקינה.')
        if not 5700 <= year <= current + 10:
            raise APIError(400, 'השנה מחוץ לטווח הדוח.')
        first, last = dates.HebrewDate(year, 7, 1).to_pydate(), dates.HebrewDate(year + 1, 7, 1).to_pydate()
        options = []
        for offset in range((last - first).days):
            day = first + timedelta(days=offset)
            if not service_day(day):
                continue
            options.append(service_value(day))
            hebrew = dates.HebrewDate.from_pydate(day)
            if hebrew.month == 7 and hebrew.day == 10:
                options.append(service_value(day, 'mincha'))
        return dict(year=year, yearLabel=dates.HebrewDate(year, 7, 1).hebrew_year(), defaultDate=upcoming.isoformat(),
                    years=[dict(value=str(y), label=dates.HebrewDate(y, 7, 1).hebrew_year()) for y in range(current + 10, 5699, -1)],
                    services=options)

    def aliyah_recommendations(self, user, raw_date=None, prayer='shacharit'):
        self.require_gabbai(user)
        selected = date.fromisoformat(civil_date(raw_date, 'תאריך הדוח', required=True, allow_future=True)) if raw_date else next_service(israel_today())
        current = dates.HebrewDate.from_pydate(israel_today()).year
        if not 5700 <= dates.HebrewDate.from_pydate(selected).year <= current + 10 or not service_day(selected):
            raise APIError(400, 'יש לבחור שבת או חג בטווח שנות הדוח.')
        hebrew = dates.HebrewDate.from_pydate(selected)
        if prayer not in ('shacharit', 'mincha') or (prayer == 'mincha' and not (hebrew.month == 7 and hebrew.day == 10)):
            raise APIError(400, 'בחירת מנחה בדוח זמינה ליום כיפור בלבד.')
        service = service_value(selected, prayer)
        people = []
        excluded = set()
        upcoming_end = selected + timedelta(days=30)
        recent_start = (selected - timedelta(days=30)).isoformat()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                custom = self._community_settings(db)['yahrzeitCustom']
                # Project children/eligibility at the selected date using the existing
                # authoritative rules, then roll back every projection-only write.
                self._refresh_roster(db, selected)
                statistics = {row['person_id']: row for row in db.execute('''
                    WITH history AS (
                        SELECT c.person_id,s.service_date,s.reading,
                            ROW_NUMBER() OVER (PARTITION BY c.person_id ORDER BY s.service_date DESC,
                                CASE s.service WHEN 'mincha' THEN 1 ELSE 0 END DESC,s.minyan,s.id,c.position) AS recency
                        FROM aliyah_calls c JOIN aliyah_services s ON s.id=c.service_id
                        WHERE c.person_id IS NOT NULL AND s.cancelled=0
                        AND (s.service_date<? OR (?=1 AND s.service_date=? AND s.service='shacharit'))
                    )
                    SELECT person_id,
                        SUM(CASE WHEN service_date>=? THEN 1 ELSE 0 END) AS six,
                        SUM(CASE WHEN service_date>=? THEN 1 ELSE 0 END) AS twelve,
                        MAX(service_date) AS last_date,
                        MAX(CASE WHEN recency=1 THEN reading END) AS last_reading,
                        GROUP_CONCAT(DISTINCT CASE WHEN service_date>=? THEN service_date END) AS recent_dates
                    FROM history GROUP BY person_id''',
                    (selected.isoformat(), int(prayer == 'mincha'), selected.isoformat(),
                     months_before(selected, 6).isoformat(), months_before(selected, 12).isoformat(),
                     (selected - timedelta(days=60)).isoformat()))}
                for row in db.execute('SELECT * FROM roster_people WHERE active=1').fetchall():
                    birthday = json.loads(row['hebrew_birth_date']) if row['hebrew_birth_date'] else None
                    if birthday and birthday.get('year'):
                        born = dates.HebrewDate(birthday['year'], MONTH_NUMBERS[birthday['month']], birthday['day']).to_pydate()
                        if born > selected:
                            continue
                    stat = statistics.get(row['id'])
                    called_on = frozenset(stat['recent_dates'].split(',')) if stat and stat['recent_dates'] else frozenset()
                    if (stat and stat['last_date'] >= recent_start) or has_upcoming_event(row, selected, upcoming_end, custom, called_on):
                        excluded.add(row['id'])
                    window = 6 if row['tribe'] in ('kohen', 'levi') else 12 if row['tribe'] == 'yisrael' else None
                    count = stat['six' if window == 6 else 'twelve'] if stat and window else 0 if window else None
                    name = ' '.join(part for part in (row['first_name'], row['last_name']) if part) or row['display_name']
                    people.append(dict(id=row['id'], tribe=row['tribe'], firstName=row['first_name'], lastName=row['last_name'], name=name,
                        torahName=row['torah_name'], wifePrayerName=row['wife_prayer_name'], classification=row['classification'],
                        aliyahCount=count, windowMonths=window, lastAliyahDate=stat['last_date'] if stat else None,
                        lastAliyah=f"{hebrew_label(date.fromisoformat(stat['last_date']))} · {stat['last_reading']}" if stat else 'לא נמצא',
                        events=person_events(row, selected, service, custom, called_on)))
            finally:
                db.rollback()
        events = sorted([person for person in people if person['events']],
                        key=lambda person: (dict(kohen=0, levi=1, yisrael=2).get(person['tribe'], 3), rank(person)))
        sections = [dict(id='events', title='אירועים', limit=None, people=events)]
        for identifier, title, maximum, tribe, classification in GROUPS:
            eligible = [person for person in people if person['id'] not in excluded and person['tribe'] == tribe and (classification is None or person['classification'] == classification)]
            sections.append(dict(id=identifier, title=title, limit=maximum, people=sorted(eligible, key=rank)[:maximum]))
        return dict(service=service, yahrzeitCustom=custom, eventWindowEnd=(selected + timedelta(days=7)).isoformat(), sections=sections,
                    notes=[f"מנהג חישוב יארצייט: {YAHRZEIT_CUSTOMS.get(custom, 'טרם הוגדר — יש לבחור מנהג בהעדפות הקהילה')}.",
                           'ספירת העליות: שישה חודשים לכהן וללוי, שנים־עשר חודשים לישראל; במנחת יום כיפור נכללות עליות השחרית של אותו יום.' if prayer == 'mincha' else 'ספירת העליות: שישה חודשים לכהן וללוי, שנים־עשר חודשים לישראל, עד היום שלפני התאריך הנבחר.',
                           'יארצייט: ביום הנבחר ובשבעת הימים שאחריו, כולל היום השביעי.',
                           'ברשימות המומלצים בלבד: לא נכללים מי שעלו ב־30 הימים האחרונים או שיש להם אירוע מהתאריך הנבחר ועד 30 ימים אחריו, כולל.',
                           'הדוח מבוסס על הפרטים והעליות שנרשמו עד כה; הוא אינו מנבא עליות עתידיות.',
                           'תאריך יארצייט שמסומן לבירור מחייב בדיקה עם המתפלל כיצד הוא נוהג. פרשת בר מצווה מחוברת בשתי שבתות: בשבת השנייה נכלל רק מי שלא עלה בשבת הראשונה.'])
