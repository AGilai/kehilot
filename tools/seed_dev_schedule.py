"""Load the Kehila's real weekly prayer-schedule TIMES (from its paper sheet, Parashat Lech Lecha 5787; no names) into a dev Kehila:
the schedule sections, the two sheet candle cities (Jerusalem, Tel Aviv) and the Kehila location (Neria).

Usage: .venv/bin/python tools/seed_dev_schedule.py --env dev --kehila <id> [--replace] [--apply]
Dry run without --apply. Goes through the server's own validation (schedule_rules) and the repo; refuses to overwrite an
existing schedule unless --replace. Dev only: the env choice allows nothing else.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
from kehila_admin import open_repo  # noqa: E402
from server.cloud import schedule_rules as rules  # noqa: E402

# Neria, near Talmon / Modiin Illit; sea level, candles 40 minutes before sunset.
LOCATION = {'latitude': 31.94, 'longitude': 35.13, 'elevation': 'sea', 'candleMinutes': 40}
# The sheet's two candle lines. Tel Aviv is 20 minutes before sunset (17:39 on the sheet). Jerusalem is 40; the sheet printed 17:19
# where the app (sunset minus 40, rounded down) shows 17:18: the earlier minute is the safe side, so it is kept.
SHEET = {'candleCities': [
    {'name': {'he': 'י״ם', 'en': 'Jerusalem'}, 'latitude': 31.7683, 'longitude': 35.2137, 'candleMinutes': 40},
    {'name': {'he': 'ת״א', 'en': 'Tel Aviv'}, 'latitude': 32.0853, 'longitude': 34.7818, 'candleMinutes': 20},
]}


def fixed(at):
    return {'kind': 'fixed', 'at': at}


def formula(anchor, day, minutes=0, direction='before'):
    return {'kind': 'formula', 'formula': {'anchor': anchor, 'day': day, 'offset': {'minutes': minutes, 'direction': direction},
                                           'rounding': {'mode': 'none'}}}


def row(rid, he, time, en=None, **extra):
    return {'id': rid, 'label': {'he': he, **({'en': en} if en else {})}, 'time': time, **extra}


def sections():
    """Times exactly as printed; formulas only where the app's zmanim reproduce the sheet (candle lighting; Shabbat end).
    The app's Shabbat end (8.5 degrees, rounded up) is 18:35 for this Shabbat and the sheet prints 18:36, so the row is that
    minus one: a minute later is the safe side for the end of Shabbat."""
    shabbat = [
        row('candles', 'כניסת שבת / הדלקת נרות', formula('candleLighting', 'friday'), 'Candle lighting', role='candles', day='friday'),
        row('kabbalat', 'מנחה וקבלת שבת', fixed('17:44'), 'Mincha and Kabbalat Shabbat', day='friday'),
        row('s-daf', 'דף יומי', fixed('07:45'), 'Daf Yomi', day='shabbat'),
        row('s-shacharit', 'שחרית', fixed('08:30'), 'Shacharit', day='shabbat'),
        row('s-shiur', 'שיעורים לגברים, נשים וילדים לאחר התפילה', {'kind': 'none'}, 'Classes for men, women and children after the service', day='shabbat'),
        row('s-gedola', 'מנחה גדולה', fixed('13:30'), 'Mincha Gedola', day='shabbat'),
        row('s-third', 'מנחה וסעודה שלישית', fixed('17:30'), 'Mincha and third meal', day='shabbat'),
        row('s-end', 'צאת השבת', formula('shabbatEnd', 'shabbat', 1, 'after'), 'Shabbat ends', day='shabbat'),
        row('s-daf2', 'דף יומי', fixed('20:00'), 'Daf Yomi (Motzei Shabbat)', day='shabbat'),
    ]
    weekday = [
        row('w-sh1', 'שחרית מניין א׳', fixed('06:45'), 'Shacharit, first minyan'),
        row('w-daf', 'שיעור דף יומי', fixed('07:30'), 'Daf Yomi class'),
        row('w-sh2', 'שחרית מניין ב׳', fixed('08:30'), 'Shacharit, second minyan'),
        row('w-gedola', 'מנחה גדולה', fixed('13:20'), 'Mincha Gedola'),
        row('w-mincha', 'מנחה', fixed('16:40'), 'Mincha'),
        row('w-arvit', 'ערבית', fixed('17:16'), 'Maariv'),
        row('w-daf2', 'שיעור דף יומי', fixed('19:55'), 'Daf Yomi class (evening)'),
        row('w-arvit2', 'מניין ערבית ב׳', fixed('20:30'), 'Maariv, second minyan'),
    ]
    return [{'id': 'shabbat', 'kind': 'shabbat', 'title': {'he': 'שבת', 'en': 'Shabbat'}, 'rows': shabbat},
            {'id': 'weekday', 'kind': 'weekday', 'title': {'he': 'ימי חול', 'en': 'Weekdays'}, 'rows': weekday}]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--env', choices=['dev'], required=True)
    p.add_argument('--kehila', required=True)
    p.add_argument('--replace', action='store_true', help='overwrite an existing schedule')
    p.add_argument('--apply', action='store_true')
    a = p.parse_args()
    clean, warnings = rules.validate_sections(sections())
    location, sheet = rules.validate_location(LOCATION), rules.validate_sheet(SHEET)
    rows = sum(len(s['rows']) for s in clean)
    print(f'{len(clean)} sections, {rows} rows, {len(sheet["candleCities"])} candle cities, warnings: {warnings or "none"}')
    repo = open_repo(a.env)
    if not repo.get_kehila(a.kehila):
        sys.exit('no such Kehila')
    existing = repo.get_schedule(a.kehila)
    if existing and existing.get('sections') and not a.replace:
        sys.exit('a schedule already exists; not overwriting (use --replace)')
    if not a.apply:
        print(json.dumps({'sections': clean, 'location': location, 'sheet': sheet}, ensure_ascii=False, indent=1)[:1500], '...')
        print('dry run (nothing written)')
        return
    repo.set_settings(a.kehila, location=location, sheet=sheet)
    updated = repo.put_schedule(a.kehila, clean, existing['updatedAt'] if existing else None, True)
    print(f'written, updatedAt {updated}')


if __name__ == '__main__':
    main()
