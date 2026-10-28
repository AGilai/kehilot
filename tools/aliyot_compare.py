"""Differential check: our aliyot engine against upstream's real aliyah_recommendations.

Usage: python3 tools/aliyot_compare.py [--ref origin/main] [-n 300] [--seed 0]
Extracts `server/` from `git archive <ref>` into a temp dir, builds N random cases (plus N//2 split-bar-mitzvah cases),
runs each through upstream (real sqlite Store, israel_today patched) and through server/cloud/aliyot/engine.py, and
prints mismatches. Exit 1 on any mismatch. Needs stdlib + pyluach; run with the repo's .venv/bin/python.
Covers manual roster rows only (not family-derived rows). Never checks out or touches the working tree.
"""
import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import types
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MONTHS = ['nisan', 'iyar', 'sivan', 'tamuz', 'av', 'elul', 'tishrei', 'cheshvan', 'kislev', 'tevet', 'shevat', 'adar', 'adar_i', 'adar_ii']
INVERSE = {1: 'nisan', 2: 'iyar', 3: 'sivan', 4: 'tamuz', 5: 'av', 6: 'elul', 7: 'tishrei', 8: 'cheshvan', 9: 'kislev',
           10: 'tevet', 11: 'shevat', 12: 'adar', 13: 'adar_ii'}


def generate(seed):
    from pyluach import dates, hebrewcal, parshios
    from server.cloud.aliyot.engine import service_day
    from server.hebrew_calendar import MONTH_NUMBERS, bar_mitzvah_date
    r = random.Random(seed)
    today = date(2026, 10, 26) + timedelta(days=r.randint(-400, 400))
    sel = today + timedelta(days=r.randint(-200, 900))
    while not service_day(sel):
        sel += timedelta(days=1)
    if r.random() < 0.15:
        sel = dates.HebrewDate(dates.HebrewDate.from_pydate(sel).year, 7, 10).to_pydate()
    h = dates.HebrewDate.from_pydate(sel)
    prayer = 'mincha' if h.month == 7 and h.day == 10 and r.random() < 0.6 else 'shacharit'
    custom = r.choice([None, 'ashkenaz', 'sephardi'])
    P = parshios.PARSHIOS_HEBREW
    pairs = [(P[i], P[i + 1]) for i in (21, 26, 28, 31, 38, 41, 50)]
    table = list(parshios.parshatable(h.year, israel=True).items())

    def parasha():
        x = r.random()
        if x < 0.4:
            return ''
        if x < 0.7:
            parts = [p for d, p in table if p and abs((d.to_pydate() - sel).days) < 70]
            if parts:
                p = r.choice(parts)
                return r.choice(['־', '-', ' ', ', ']).join(P[i] for i in p) if len(p) > 1 or r.random() < 0.5 else P[p[0]]
        if x < 0.85:
            a, b = r.choice(pairs)
            return r.choice([a, b, a + '־' + b, 'פרשת ' + a + '-' + b])
        return r.choice(P)

    ids = [f'p{i:02}' for i in range(r.randint(5, 45))]
    people = []
    for pid in ids:
        hb = None
        if r.random() < 0.3:
            hy, hm, hd = r.randint(5768, 5787), r.choice(MONTHS), r.randint(1, 29)
            hb = dict(day=hd, month=hm, year=hy)
            if hm == 'adar_ii' and not hebrewcal.Year(hy).leap:
                hb['month'] = 'adar'
            if dates.HebrewDate(hy, MONTH_NUMBERS[hb['month']], hd).to_pydate() > today:
                hb = None  # A birth after `today` cannot be saved upstream; keep the case realistic.
        bmd = ''
        if r.random() < 0.15:
            d = sel + timedelta(days=r.randint(-10, 40))
            bmd = (d + timedelta(days=(5 - d.weekday()) % 7)).isoformat()
        ys = []
        for k in range(r.choice([0, 0, 1, 1, 2])):
            m, day = r.choice(MONTHS), r.choice([30, 29, 1, r.randint(1, 30)])
            if r.random() < 0.6:
                t = dates.HebrewDate.from_pydate(sel + timedelta(days=r.randint(-3, 35)))
                m, day = INVERSE[t.month], t.day
                if m == 'adar' and r.random() < 0.5:
                    m = r.choice(['adar_i', 'adar'])
            ys.append(dict(id=f'y{k}', name='קרוב', relationship=r.choice(['father', 'mother', 'brother', 'sister', 'son', 'daughter', 'uncle', 'unknown', 'weird']),
                           day=day, month=m, year=''))
        person = dict(id=pid, tribe=r.choice(['kohen', 'levi', 'yisrael', 'yisrael', '']), first_name=r.choice(['א', 'ב', 'ג', '']),
                      last_name=r.choice(['כהן', 'לוי', '']), display_name=r.choice(['שם', '']), torah_name='ת', wife_prayer_name='',
                      classification=r.choice(['א', 'א', 'דור ב', 'קבוע', 'חתן', '']), bar_mitzvah_parasha=parasha(),
                      bar_mitzvah_date=bmd, hebrew_birth_date=hb, yahrzeits=ys)
        mode = r.random()
        if mode >= 0.5 and mode < 0.8:
            e = bar_mitzvah_date(hb, today) if hb else None
            person.update(eligible_from=e.isoformat() if e else None, active=True if e is None else e <= today)
        elif mode >= 0.8:
            person.update(eligible_from=None, active=r.random() < 0.5)
        people.append(person)
    services, serial, days, d = [], 0, [], sel - timedelta(days=420)
    while d <= sel + timedelta(days=20):
        if service_day(d) and r.random() < 0.5:
            days.append(d)
        d += timedelta(days=1)
    yom_kippur = dates.HebrewDate(h.year, 7, 10).to_pydate()
    if yom_kippur not in days and yom_kippur <= sel:
        days.append(yom_kippur)
    for d in days:
        hd = dates.HebrewDate.from_pydate(d)
        for kind in ['shacharit'] + (['mincha'] if hd.month == 7 and hd.day == 10 else []):
            for minyan in range(1, r.choice([2, 2, 3])):
                serial += 1
                calls = [dict(position=r.choice(['כהן', 'לוי', 'ישראל ', 'מפטיר', 'x']) + str(i), personId=None if r.random() < 0.1 else r.choice(ids))
                         for i in range(r.randint(1, 8))]
                services.append(dict(id=f's{r.randint(0, 10**6):07}-{serial}', date=d.isoformat(), service=kind, minyan=minyan,
                                     reading=f'קריאה {serial}', cancelled=r.random() < 0.1, calls=calls))
    return dict(today=today.isoformat(), selected=sel.isoformat(), prayer=prayer, custom=custom, people=people, services=services)


def generate_split(seed):
    """Selected date on/near a Shabbat of a combined-parasha pair, with calls on the actual first Shabbat."""
    from pyluach import parshios
    from server.cloud.aliyot.engine import year_readings
    r = random.Random(seed + 777)
    case = generate(seed + 5000)
    P = parshios.PARSHIOS_HEBREW
    pairs = [(P[i], P[i + 1]) for i in (21, 26, 28, 31, 38, 41, 50)]
    days = [(d, p) for d, p in year_readings(r.choice([5786, 5787, 5788, 5789, 5790, 5791])) if len(p) == 1 and any(p[0] in pr for pr in pairs)]
    if not days:
        return None
    d, p = r.choice(days)
    sel = d + timedelta(days=r.choice([0, 0, 7, -7, 14]))
    case.update(selected=sel.isoformat(), prayer='shacharit', today=(sel - timedelta(days=r.randint(-100, 100))).isoformat())
    pr = next(pr for pr in pairs if p[0] in pr)
    for person in case['people']:
        if r.random() < 0.6:
            person['bar_mitzvah_parasha'] = r.choice([pr[0] + '־' + pr[1], pr[0] + '-' + pr[1], pr[0], pr[1], 'פרשת ' + pr[0] + ' ' + pr[1]])
    for k in range(3):
        case['services'].append(dict(id=f'z{k}', date=(d - timedelta(days=7 * k)).isoformat(), service='shacharit', minyan=9, reading=P[0],
                                     cancelled=r.random() < 0.2, calls=[dict(position=f'q{i}', personId=r.choice(case['people'])['id']) for i in range(r.randint(1, 6))]))
    return case


def run_ours(cases):
    sys.path.insert(0, str(ROOT))
    from server.cloud.aliyot.engine import recommendations
    from server.validation import APIError
    out = []
    for c in cases:
        try:
            out.append(recommendations(c['people'], c['services'], selected=date.fromisoformat(c['selected']), prayer=c['prayer'],
                                       yahrzeit_custom=c['custom'], today=date.fromisoformat(c['today'])))
        except APIError as e:
            out.append(['error', e.status, str(e)])
    return out


def run_upstream(cases, archive, scratch):
    from unittest.mock import patch
    for name in ('openpyxl', 'openpyxl.styles', 'openpyxl.worksheet', 'openpyxl.utils', 'openpyxl.cell', 'defusedxml', 'defusedxml.ElementTree'):
        try:
            __import__(name)
        except ImportError:
            module = types.ModuleType(name)
            module.__getattr__ = lambda attr: None
            module.__path__ = []
            sys.modules[name] = module
    sys.path.insert(0, archive)
    from server.store import Store
    from server.validation import APIError
    from server.hebrew_calendar import bar_mitzvah_date
    template = Path(scratch) / 't.db'
    gid = Store(template).create_user('gabbai@example.test', 'pw-12345678-abc', 'גבאי לדוגמה', 'gabbai')
    out = []
    for n, c in enumerate(cases):
        path = Path(scratch) / f'c{n}.db'
        shutil.copyfile(template, path)
        store = Store(path)
        today = date.fromisoformat(c['today'])
        with store.db() as db:
            gabbai = dict(db.execute('SELECT * FROM users WHERE id=?', (gid,)).fetchone())
            db.execute('UPDATE community_settings SET yahrzeit_custom=?', (c['custom'],))
            for p in c['people']:
                if 'eligible_from' in p:
                    e, a = p['eligible_from'], p.get('active', True)
                else:
                    ev = bar_mitzvah_date(p['hebrew_birth_date'], today)
                    e, a = (ev.isoformat() if ev else None), ev is None or ev <= today
                db.execute('''INSERT INTO roster_people (id,first_name,last_name,display_name,tribe,torah_name,wife_prayer_name,bar_mitzvah_parasha,
                    bar_mitzvah_date,hebrew_birth_date,yahrzeits,classification,eligible_from,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                           (p['id'], p['first_name'], p['last_name'], p['display_name'], p['tribe'], p['torah_name'], p['wife_prayer_name'],
                            p['bar_mitzvah_parasha'], p['bar_mitzvah_date'], json.dumps(p['hebrew_birth_date']) if p['hebrew_birth_date'] else None,
                            json.dumps(p['yahrzeits'], ensure_ascii=False), p['classification'], e, int(bool(a)), 'x', 'x'))
            for s in c['services']:
                db.execute('INSERT INTO aliyah_services (id,service_date,service,reading,cancelled,recorded_by,created_at,updated_at,minyan) VALUES (?,?,?,?,?,?,?,?,?)',
                           (s['id'], s['date'], s['service'], s['reading'], int(s['cancelled']), gid, 'x', 'x', s['minyan']))
                for call in s['calls']:
                    db.execute('INSERT INTO aliyah_calls VALUES (?,?,?,?)', (s['id'], call['position'], call['personId'], 'n'))
        try:
            with patch('server.recommendations.israel_today', return_value=today), patch('server.validation.israel_today', return_value=today):
                report = store.aliyah_recommendations(gabbai, c['selected'], c['prayer'])
            for section in report['sections']:
                section['people'] = [p for p in section['people'] if p['id'] != gid]
            out.append(report)
        except APIError as e:
            out.append(['error', e.status, str(e)])
        os.remove(path)
    return out


def describe(case, up, ours):
    print('CASE', case['seed'], case['selected'], case['prayer'], case['custom'])
    if isinstance(up, list) or isinstance(ours, list):
        print('  upstream', up if isinstance(up, list) else 'report', '| ours', ours if isinstance(ours, list) else 'report')
        return
    for key in up:
        if up[key] == ours.get(key):
            continue
        if key != 'sections':
            print('  key', key, up[key], ours.get(key))
            continue
        for a, b in zip(up[key], ours[key]):
            if a != b:
                ids_a, ids_b = [p['id'] for p in a['people']], [p['id'] for p in b['people']]
                print('  section', a['id'], 'upstream', ids_a, 'ours', ids_b)
                if ids_a == ids_b:
                    for p, q in zip(a['people'], b['people']):
                        if p != q:
                            print('   ', {k: (p[k], q.get(k)) for k in p if p[k] != q.get(k)})


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--ref', default='origin/main')
    parser.add_argument('-n', type=int, default=300)
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--worker', choices=['ours', 'upstream'])
    parser.add_argument('files', nargs='*')
    args = parser.parse_args()
    if args.worker:  # Internal: separate processes, because both codebases are the package `server`.
        cases = json.load(open(args.files[0]))
        out = run_ours(cases) if args.worker == 'ours' else run_upstream(cases, args.files[1], args.files[2])
        json.dump(out, open(args.files[-1], 'w'), ensure_ascii=False, default=str)
        return 0
    sys.path.insert(0, str(ROOT))
    cases = [dict(generate(s), seed=s) for s in range(args.seed, args.seed + args.n)]
    cases += [dict(c, seed=f'split-{s}') for s in range(args.seed, args.seed + args.n // 2) if (c := generate_split(s))]
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / 'upstream'
        archive.mkdir()
        packed = subprocess.run(['git', '-C', str(ROOT), 'archive', args.ref, 'server'], check=True, capture_output=True).stdout
        subprocess.run(['tar', '-x', '-C', str(archive)], input=packed, check=True)
        json.dump(cases, open(Path(tmp) / 'cases.json', 'w'), ensure_ascii=False)
        scratch = Path(tmp) / 'db'
        scratch.mkdir()
        for worker, extra in (('ours', []), ('upstream', [str(archive), str(scratch)])):
            subprocess.run([sys.executable, __file__, '--worker', worker, str(Path(tmp) / 'cases.json'), *extra, str(Path(tmp) / f'{worker}.json')],
                           check=True, cwd=ROOT if worker == 'ours' else archive)
        up, ours = (json.load(open(Path(tmp) / f'{w}.json')) for w in ('upstream', 'ours'))
    bad = [i for i, (a, b) in enumerate(zip(up, ours)) if a != b]
    for i in bad[:5]:
        describe(cases[i], up[i], ours[i])
    print(f'{args.ref}: {len(cases)} cases, {len(bad)} mismatches')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
