"""Private replies dev migration. Usage:
  .venv/bin/python tools/migrate_private_replies.py --env dev [--kehila <id>] [--apply]

Dry run unless --apply. Per Kehila (all, or just --kehila), for every message that has replies (R# items):
  1. writes its thread index item (K#<k>#RX / MSG#<m>): replyTo from reply_route, else 'family' when the message
     has a targetMemberId (a legacy blessing in a group channel); lastAt = the newest createdAt;
  2. marks the legacy replies (no `to`) as seen for each current target adult, so nobody gets an unread burst;
  3. sets to = 'family' on those replies;
  4. removes a custom pushTexts.reply from the Kehila.
The order makes a crashed run resumable (replies are tagged last). Replies that already have `to` are never
marked seen, so a re-run cannot hide a new reply. Re-running changes nothing. Prints counts and ids only.
Also pins targetFamilyId on every mazal tov / condolence that has a target adult but no family id (the adult's
current family; none: skipped and counted).
Returns {kehilot, threads, repliesTagged, seenMarks, pushTextsRemoved, familyIdSet, familyIdSkipped}; on a re-run all
but threads and familyIdSkipped are 0 (they count work done).
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
from kehila_admin import open_repo  # noqa: E402
from server.cloud import families, private_replies  # noqa: E402


FAMILY_TYPES = ('celebration', 'condolence')


def _pin_family(repo, k, message, counts, apply):
    """A mazal tov / condolence with a target adult but no targetFamilyId gets the adult's current family.
    No family: skipped and counted. Mutates `message` so the thread item sees it."""
    target = message.get('targetMemberId')
    if message.get('type') not in FAMILY_TYPES or message.get('removed') or not target or message.get('targetFamilyId'):
        return
    family = repo.family_of(k, target)
    if not family:
        counts['familyIdSkipped'] += 1
        return
    counts['familyIdSet'] += 1
    message['targetFamilyId'] = family['familyId']
    if apply:
        repo.table.update_item(Key={'pk': message['pk'], 'sk': message['sk']},
                               UpdateExpression='SET targetFamilyId = :f',
                               ConditionExpression='attribute_exists(sk) AND attribute_not_exists(targetFamilyId)',
                               ExpressionAttributeValues={':f': family['familyId']})


def migrate(repo, k=None, apply=False):
    counts = {'kehilot': 0, 'threads': 0, 'repliesTagged': 0, 'seenMarks': 0, 'pushTextsRemoved': 0,
              'familyIdSet': 0, 'familyIdSkipped': 0}
    for kehila in ([k] if k else repo.list_kehila_ids()):
        meta = repo.get_kehila(kehila)
        if not meta:
            continue
        counts['kehilot'] += 1
        channels = {c['sk'][2:]: c for c in repo.list_channels(kehila)}
        for message in repo.iter_messages(kehila):
            _pin_family(repo, kehila, message, counts, apply)
            mid = message['sk'][len('MSG#'):]
            replies = repo.list_replies(kehila, mid, consistent=True)
            if not replies:
                continue
            route = private_replies.reply_route(message, channels.get(message.get('channelId')))
            route = route or ('family' if message.get('targetMemberId') else None)
            if not route:
                continue  # nobody can read these replies; leave them alone
            counts['threads'] += 1
            legacy = [r for r in replies if 'to' not in r]
            if apply:
                repo.touch_thread(kehila, mid, message, route, now=max(int(r['createdAt']) for r in replies))
            if legacy:
                recipients = ([message['authorId']] if route == 'author'
                              else sorted(families.target_adults(repo, kehila, message)))
                newest = max(r['sk'][len('R#'):] for r in legacy)
                for user in recipients:
                    counts['seenMarks'] += 1
                    if apply:
                        repo.mark_seen(kehila, user, mid, newest)
            for r in legacy:
                counts['repliesTagged'] += 1
                if apply:
                    repo.table.update_item(Key={'pk': r['pk'], 'sk': r['sk']}, UpdateExpression='SET #to = :f',
                                           ConditionExpression='attribute_not_exists(#to)',
                                           ExpressionAttributeNames={'#to': 'to'}, ExpressionAttributeValues={':f': 'family'})
        if 'reply' in (meta.get('pushTexts') or {}):
            counts['pushTextsRemoved'] += 1
            if apply:
                repo.table.update_item(Key={'pk': f'K#{kehila}', 'sk': 'META'}, UpdateExpression='REMOVE pushTexts.#r',
                                       ExpressionAttributeNames={'#r': 'reply'})
    return counts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--env', required=True)
    parser.add_argument('--kehila')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args(argv)
    counts = migrate(open_repo(args.env), args.kehila, args.apply)
    print(('applied' if args.apply else 'dry run (nothing written; pass --apply)') + ': '
          + ' '.join(f'{key}={value}' for key, value in counts.items()))
    return counts


if __name__ == '__main__':
    main()
