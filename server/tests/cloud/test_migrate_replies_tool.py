"""tools/migrate_private_replies.py (private-replies plan, Task 5): legacy blessings get a thread item, `to`,
and are marked seen. Dry run by default, safe to re-run. Invented names only."""
import io
import sys
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from moto import mock_aws

from server.cloud import private_replies
from server.cloud.repo import Repo
from server.tests.cloud.helpers import ensure_member_channels, make_table

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'tools'))
import migrate_private_replies  # noqa: E402


@mock_aws
class MigrateRepliesTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(migrate_private_replies, 'open_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.k = self.repo.create_kehila('קהילת ניסיון', {})
        ensure_member_channels(self.repo, self.k)
        self.channel = next(c['sk'][2:] for c in self.repo._query_prefix(self.k, 'C#') if c['name'] == 'simchas')
        for user, name in (('u-gabbai', 'גבאי לדוגמה'), ('u-rotem', 'רותם אלמוג'), ('u-shulamit', 'שולמית ברקן'),
                           ('u-yigal', 'יגאל ברקן'), ('u-dana', 'דנה בדיוני')):
            self.repo.put_membership(self.k, user, 'gabbai' if user == 'u-gabbai' else 'member')
            self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': f'M#{user}'}, UpdateExpression='SET displayName = :n',
                                        ExpressionAttributeValues={':n': name})
        self.repo.link(self.k, 'u-shulamit', 'u-yigal')
        self.message = self.repo.put_message(self.k, self.channel, 'celebration', 'מזל טוב', 'ברכות', 'u-gabbai',
                                             'גבאי לדוגמה', 'management', 'u-shulamit', 'שולמית ברקן')['sk'][4:]
        self.legacy_ids = []
        for author, body, at in (('u-rotem', 'מזל טוב א', 1000), ('u-rotem', 'מזל טוב ב', 2000), ('u-dana', 'ברכה', 1500)):
            self.legacy_ids.append(self.put_legacy(author, body, at))
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': 'META'},
                                    UpdateExpression='SET pushTexts = :p',
                                    ExpressionAttributeValues={':p': {'reply': {'he': 'x'}, 'event': {'he': 'keep'}}})

    def put_legacy(self, author, body, at):
        from server.cloud.ids import new_id
        rid = new_id()
        time.sleep(0.002)
        self.repo.table.put_item(Item={'pk': f'K#{self.k}#MSG#{self.message}', 'sk': f'R#{rid}', 'authorId': author,
                                       'authorName': author, 'body': body, 'createdAt': at})
        return rid

    def items(self):
        return sorted((i['pk'], i['sk']) for i in self.repo.table.scan()['Items'])

    def run_tool(self, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            counts = migrate_private_replies.main(['--env', 'dev', '--kehila', self.k, *args])
        return counts, out.getvalue()

    def test_dry_run_writes_nothing(self):
        before = self.repo.table.scan()['Items']
        counts, out = self.run_tool()
        self.assertEqual(counts, {'kehilot': 1, 'threads': 1, 'repliesTagged': 3, 'seenMarks': 2, 'pushTextsRemoved': 1,
                                  'familyIdSet': 1, 'familyIdSkipped': 0})
        self.assertIn('dry run', out)
        self.assertEqual(self.repo.table.scan()['Items'], before)

    def test_apply_writes_threads_and_marks_existing_seen(self):
        counts, out = self.run_tool('--apply')
        self.assertEqual(counts['threads'], 1)
        self.assertNotIn('dry run', out)
        thread = self.repo.table.get_item(Key={'pk': f'K#{self.k}#RX', 'sk': f'MSG#{self.message}'})['Item']
        self.assertEqual((thread['replyTo'], thread['lastAt']), ('family', 2000))
        for r in self.repo.list_replies(self.k, self.message):
            self.assertEqual(r['to'], 'family')
        for user in ('u-shulamit', 'u-yigal'):
            rows = private_replies.inbox_threads(self.repo, self.k, user, self.repo.get_membership(self.k, user))
            self.assertEqual([(row['message']['messageId'], row['unread']) for row in rows], [(self.message, 0)])
            self.assertEqual(rows[0]['total'], 3)
        items = self.items()
        again, _ = self.run_tool('--apply')
        self.assertEqual((again['threads'], again['repliesTagged'], again['seenMarks'], again['pushTextsRemoved']),
                         (1, 0, 0, 0))
        self.assertEqual(self.items(), items)

    def test_new_reply_after_migration_stays_unread_on_rerun(self):
        self.run_tool('--apply')
        self.repo.put_reply(self.k, self.message, 'u-dana', 'דנה בדיוני', 'חדש', to='family')
        self.run_tool('--apply')
        rows = private_replies.inbox_threads(self.repo, self.k, 'u-yigal', self.repo.get_membership(self.k, 'u-yigal'))
        self.assertEqual(rows[0]['unread'], 1)

    def test_pins_target_family_id_idempotently_and_counts_familyless(self):
        def fam_id(mid):
            return self.repo.get_message(self.k, mid).get('targetFamilyId')
        loner = self.repo.put_message(self.k, self.channel, 'condolence', 'השתתפות', '', 'u-gabbai', 'גבאי לדוגמה',
                                      'management', 'u-gone', 'אלון שדמי')['sk'][4:]
        self.assertIsNone(fam_id(self.message))
        _, out = self.run_tool()
        self.assertIsNone(fam_id(self.message))
        self.assertIn('familyIdSet=1', out)
        self.assertIn('familyIdSkipped=1', out)
        counts, _ = self.run_tool('--apply')
        family = self.repo.family_of(self.k, 'u-shulamit')['familyId']
        self.assertEqual((fam_id(self.message), fam_id(loner)), (family, None))
        self.assertEqual((counts['familyIdSet'], counts['familyIdSkipped']), (1, 1))
        again, _ = self.run_tool('--apply')
        self.assertEqual((again['familyIdSet'], again['familyIdSkipped']), (0, 1))
        self.assertEqual(self.repo.table.get_item(Key={'pk': f'K#{self.k}#RX', 'sk': f'MSG#{self.message}'})
                         ['Item']['targetFamilyId'], family)

    def test_removes_custom_reply_push_text(self):
        self.run_tool('--apply')
        self.assertEqual(self.repo.get_kehila(self.k)['pushTexts'], {'event': {'he': 'keep'}})

    def test_prints_counts_and_ids_only(self):
        _, out = self.run_tool('--apply')
        for text in ('מזל טוב', 'ברכ', 'אלמוג', 'ברקן', 'בדיוני'):
            self.assertNotIn(text, out)


if __name__ == '__main__':
    unittest.main()
