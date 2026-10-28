"""Test messages for trying the Messages screen on dev: back-dated over a year, invented content, no pushes.

Usage: .venv/bin/python tools/seed_dev_messages.py --env dev --kehila <id> [--count 200] [--days 365] [--apply]
       .venv/bin/python tools/seed_dev_messages.py --env dev --kehila <id> --remove [--apply]
       .venv/bin/python tools/seed_dev_messages.py --env dev --kehila <id> --templates [--apply]
Dry run without --apply. Every message is tagged `seed=dev-messages` and posted by the Kehila's first gabbai into the
main channel; --remove marks exactly the tagged ones removed (and deletes their sheet items). --templates adds, for the
current and next sheet week, three templated messages per type with their sheet items (one posted by a member, so
pending) instead of the back-dated plan. A change record per message makes open apps pick them up.
Dev only: the env choice allows nothing else.
"""
import argparse
import random
import secrets
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
from kehila_admin import MAIN_CHANNEL, open_repo  # noqa: E402
from server.cloud import message_fields, sheet_items, sheet_rules  # noqa: E402
from server.cloud.ids import _encode  # noqa: E402

SEED_TAG = 'dev-messages'
FAMILIES = ['ניסיון', 'דוגמה', 'בדיוני', 'לדוגמה', 'מבחן', 'טסט', 'תרגול', 'הדגמה']
FIRST = ['יוסף', 'מרים', 'דוד', 'שרה', 'אברהם', 'רבקה', 'יעקב', 'לאה', 'משה', 'רחל', 'אורי', 'נועה']
EVENTS = ['שיעור בגמרא', 'סעודה שלישית קהילתית', 'הרצאה לנוער', 'ערב לימוד לנשים', 'יום ניקיון בבית הכנסת',
          'כנס התחדשות', 'טיול קהילתי', 'ערב הוקרה למתנדבים', 'שיעור פרשת שבוע', 'סיום מסכת']
GENERAL = ['שינוי בשעת מנחה', 'תרומות לקופת הצדקה', 'עדכון מהוועד', 'בקשה לסידור החניה', 'סידורים חדשים הגיעו',
           'תיקון המזגן', 'מתנדבים לשמירה', 'הזכרה: תשלום דמי חבר', 'ספרים שנשכחו', 'מפתח לבית הכנסת']
CELEBRATE = ['להולדת הבן', 'להולדת הבת', 'לאירוסי', 'לנישואי', 'לבר המצווה של', 'לבת המצווה של']


def past_id(when):
    return _encode(int(when.timestamp() * 1000) << 80 | int.from_bytes(secrets.token_bytes(10), 'big'))


def plan(count, days, today, rng):
    """[(datetime, type, title, body)] oldest first; weekly updates every Friday, the rest spread over the period."""
    start = today - timedelta(days=days)
    out = []
    friday = start + timedelta(days=(4 - start.weekday()) % 7)
    while friday <= today and len(out) < count:
        out.append((datetime(friday.year, friday.month, friday.day, 10, 0, tzinfo=timezone.utc), 'weekly',
                    f'עדכון שבועי · {friday.day}.{friday.month}', 'זמני התפילות, שיעורים והודעות לשבת הקרובה.'))
        friday += timedelta(days=7)
    weights = [('general', 45), ('event', 30), ('celebration', 17), ('condolence', 8)]
    kinds = [k for k, w in weights for _ in range(w)]
    while len(out) < count:
        day = start + timedelta(days=rng.randrange(days + 1))
        when = datetime(day.year, day.month, day.day, rng.randrange(6, 20), rng.randrange(60), tzinfo=timezone.utc)
        kind = rng.choice(kinds)
        family = rng.choice(FAMILIES)
        if kind == 'general':
            title, body = rng.choice(GENERAL), 'פרטים נוספים אצל הגבאים. תודה לכולם.'
        elif kind == 'event':
            title, body = rng.choice(EVENTS), f'ביום {rng.choice("ראשון שני שלישי רביעי חמישי".split())} בשעה 20:30 באולם.'
        elif kind == 'celebration':
            title = f'מזל טוב למשפחת {family} {rng.choice(CELEBRATE)} {rng.choice(FIRST)}'
            body = 'הקהילה שמחה בשמחתכם.'
        else:
            title, body = f'משתתפים בצער משפחת {family}', 'המשפחה יושבת שבעה בביתה. המקום ינחם אתכם.'
        out.append((when, kind, title, body))
    return sorted(out)


def template_plan(friday):
    """[(type, templateId, title, body, fields, by_member)] for one sheet week (its Friday), invented names only.
    Per type three messages; the second of each is the member's, which waits for approval."""
    out = []
    for n in range(3):
        family, first = FAMILIES[n], FIRST[n]
        fields = {'occasion': 'birthSon', 'whose': 'parents', 'surname': family, 'firstNames': first}
        out.append(('celebration', 'mazal', f'מזל טוב למשפחת {family}', 'הקהילה שמחה בשמחתכם.', fields, n == 1))
    for n in range(3):
        family, first = FAMILIES[3 + n], FIRST[3 + n]
        fields = {'variant': 'only', 'surname': family, 'deceased': first, 'relation': 'האב'}
        out.append(('condolence', 'condolence', f'משתתפים בצער משפחת {family}', 'המקום ינחם אתכם.', fields, n == 1))
    for n in range(3):
        day = (friday + timedelta(days=1 + n)).isoformat()
        fields = {'name': EVENTS[n], 'date': day, 'time': f'{19 + n}:30', 'place': 'בית הכנסת', 'for': 'all'}
        out.append(('event', 'event', EVENTS[n], f'ב-{day} בשעה {fields["time"]} בבית הכנסת.', fields, n == 1))
    return out


def seed_templates(repo, k, channel_id, authors, now, apply):
    """The templated messages of the current and next sheet week. Returns the count; writes only with `apply`."""
    gabbai, member = authors
    friday = sheet_rules.week_for_post(now, 'celebration', None)
    count = 0
    for offset in (0, 7):
        week = friday + timedelta(days=offset)
        for type_, template_id, title, body, fields, by_member in template_plan(week):
            message_fields.validate_fields(template_id, fields)
            count += 1
            if not apply:
                continue
            author = member if by_member and member else gabbai
            item = repo.put_message(k, channel_id, type_, title, body, author['sk'][len('M#'):],
                                    author.get('displayName', ''), 'management' if author is gabbai else 'member',
                                    None, template_id=template_id, fields=fields)
            repo.table.update_item(Key={'pk': item['pk'], 'sk': item['sk']}, UpdateExpression='SET seed = :s',
                                   ExpressionAttributeValues={':s': SEED_TAG})
            settings = (repo.get_kehila(k) or {}).get('settings', {})
            sheet_items.on_post(repo, k, author, settings, item, now + timedelta(days=offset))
            repo.put_change(k, 'message', item['sk'][len('MSG#'):], channel_id)
    return count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env', choices=['dev'], required=True)
    parser.add_argument('--kehila', required=True)
    parser.add_argument('--count', type=int, default=200)
    parser.add_argument('--days', type=int, default=365)
    parser.add_argument('--remove', action='store_true')
    parser.add_argument('--templates', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    repo = open_repo(args.env)
    k = args.kehila
    if not repo.get_kehila(k):
        sys.exit('no such Kehila')
    if args.remove:
        tagged = [m for m in repo.iter_messages(k) if m.get('seed') == SEED_TAG and not m.get('removed')]
        print(f'{len(tagged)} seeded messages {"removed" if args.apply else "would be removed"}')
        if args.apply:
            for m in tagged:
                sheet_items.on_remove(repo, k, m)
                message_id = m['sk'][len('MSG#'):]
                repo.remove_message(k, message_id)
                repo.put_change(k, 'message_removed', message_id, m['channelId'])
        return
    gabbai = next((m for m in repo.list_members(k) if m.get('role') == 'gabbai'), None)
    channel = next((c for c in repo.list_channels(k) if c.get('name') == MAIN_CHANNEL), None)
    if not gabbai or not channel:
        sys.exit('needs a gabbai and the main channel')
    channel_id = channel['sk'][len('C#'):]
    author_id = gabbai['sk'][len('M#'):]
    if args.templates:
        member = next((m for m in repo.list_members(k) if m.get('role') == 'member'), None)
        count = seed_templates(repo, k, channel_id, (gabbai, member), datetime.now(timezone.utc), args.apply)
        print(f'{count} templated messages {"written" if args.apply else "would be written"}'
              f'{"" if member else " (no member found: none will be pending)"}')
        if not args.apply:
            print('dry run (nothing written)')
        return
    rows = plan(args.count, args.days, date.today(), random.Random(20261028))
    counts = {}
    for _, kind, _, _ in rows:
        counts[kind] = counts.get(kind, 0) + 1
    print(f'{len(rows)} messages from {rows[0][0].date()} to {rows[-1][0].date()}: {counts}')
    if not args.apply:
        print('dry run (nothing written)')
        return
    for when, kind, title, body in rows:
        item = repo.put_message(k, channel_id, kind, title, body, author_id, gabbai.get('displayName', ''),
                                'management', None, message_id=past_id(when))
        repo.table.update_item(Key={'pk': item['pk'], 'sk': item['sk']}, UpdateExpression='SET seed = :s',
                               ExpressionAttributeValues={':s': SEED_TAG})
        repo.put_change(k, 'message', item['sk'][len('MSG#'):], channel_id)
        time.sleep(0.02)
    print('written; no pushes were sent')


if __name__ == '__main__':
    main()
