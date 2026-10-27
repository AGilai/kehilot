from datetime import date
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_api as api_helpers
from server.store import Store
from server.healing_import import import_requests
from server.validation import APIError


class HealingPrayersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template_dir = tempfile.TemporaryDirectory()
        cls.template = Path(cls.template_dir.name) / 'template.db'
        store = Store(cls.template)
        cls.member_id = store.create_user('member@example.test', api_helpers.PASSWORD, 'חבר לדוגמה')
        cls.other_id = store.create_user('other@example.test', api_helpers.PASSWORD, 'חבר נוסף')
        cls.gabbai_id = store.create_user('gabbai@example.test', api_helpers.PASSWORD, 'גבאי לדוגמה', 'gabbai')

    @classmethod
    def tearDownClass(cls):
        cls.template_dir.cleanup()

    setUp = api_helpers.CommunityTest.setUp
    tearDown = api_helpers.CommunityTest.tearDown
    http = api_helpers.CommunityTest.http

    def add(self, name='משה בן שרה', token='member-token'):
        with patch('server.store.israel_today', return_value=date(2026, 10, 25)):
            status, entry, _ = self.http('POST', '/api/healing-prayers', dict(name=name), token)
        self.assertEqual(status, 201, entry)
        return entry

    def test_create_records_the_authenticated_member_and_server_gregorian_date(self):
        entry = self.add('  משה בן שרה  ')
        self.assertEqual(entry['memberId'], self.member_id)
        self.assertEqual(entry['memberName'], 'חבר לדוגמה')
        self.assertEqual(entry['name'], 'משה בן שרה')
        self.assertEqual(entry['addedOn'], '2026-10-25')
        with self.store.db() as db:
            row = db.execute('SELECT * FROM healing_prayers WHERE id=?', (entry['id'],)).fetchone()
            self.assertEqual((row['member_id'], row['name'], row['added_on']), (self.member_id, 'משה בן שרה', '2026-10-25'))
        self.assertEqual(self.http('GET', '/api/me', token='member-token')[1]['healingPrayers'], [entry])
        restarted = Store(self.store.path)
        self.assertEqual(restarted.healing_prayers(self.member), [entry])

    def test_members_only_see_and_delete_their_own_entries_and_deletion_is_physical(self):
        own = self.add()
        other = self.add(token='other-token')
        self.assertNotEqual(own['id'], other['id'])
        self.assertEqual(self.http('GET', '/api/healing-prayers', token='member-token')[1], [own])
        self.assertEqual(self.http('GET', '/api/me', token='other-token')[1]['healingPrayers'], [other])
        self.assertEqual(self.http('DELETE', '/api/healing-prayers/' + other['id'], token='member-token')[0], 404)
        self.assertEqual(self.http('DELETE', '/api/healing-prayers/' + own['id'], token='gabbai-token')[0], 404)
        self.assertEqual(self.http('DELETE', '/api/healing-prayers/' + own['id'], token='member-token')[0], 200)
        with self.store.db() as db:
            self.assertIsNone(db.execute('SELECT id FROM healing_prayers WHERE id=?', (own['id'],)).fetchone())
            self.assertIsNotNone(db.execute('SELECT id FROM healing_prayers WHERE id=?', (other['id'],)).fetchone())
        self.assertEqual(Store(self.store.path).healing_prayers(self.member), [])
        self.assertEqual(self.http('DELETE', '/api/healing-prayers/' + own['id'], token='member-token')[0], 404)

    def test_validation_prevents_forged_ownership_dates_and_accidental_duplicate_names(self):
        for body in [dict(name=''), dict(name='   '), dict(name='א' * 201), dict(name=None), dict(name=True),
                     dict(name=[]), {}, dict(name='משה בן שרה', memberId=self.other_id),
                     dict(name='משה בן שרה', addedOn='2000-01-01')]:
            self.assertEqual(self.http('POST', '/api/healing-prayers', body, 'member-token')[0], 400, body)
        entry = self.add()
        self.assertEqual(self.http('POST', '/api/healing-prayers', dict(name='  משה בן שרה  '), 'member-token')[0], 409)
        self.assertEqual(self.http('DELETE', '/api/healing-prayers/' + entry['id'], token='member-token')[0], 200)
        replacement = self.add()
        self.assertNotEqual(replacement['id'], entry['id'])

    def test_combined_list_requires_gabbai_and_preserves_member_identity_after_a_rename(self):
        own = self.add()
        other = self.add('מרים בת חנה', token='other-token')
        self.assertEqual(self.http('GET', '/api/admin/healing-prayers')[0], 401)
        self.assertEqual(self.http('GET', '/api/admin/healing-prayers', token='member-token')[0], 403)
        all_names = self.http('GET', '/api/admin/healing-prayers', token='gabbai-token')[1]
        self.assertEqual({entry['id'] for entry in all_names}, {own['id'], other['id']})
        self.assertEqual(self.http('GET', '/api/healing-prayers', token='gabbai-token')[1], [])
        profile = self.store.state(self.member)['profile']
        profile.update(firstName='משה דוד', lastName='בן עמי', tribe='yisrael')
        self.store.save_profile(self.member, profile)
        updated = self.http('GET', '/api/healing-prayers', token='member-token')[1][0]
        self.assertEqual(updated['memberId'], own['memberId'])
        self.assertEqual(updated['memberName'], 'משה דוד בן עמי')
        self.assertEqual(updated['addedOn'], own['addedOn'])
        self.assertEqual(updated['name'], own['name'])
        self.assertEqual(self.http('DELETE', '/api/healing-prayers/' + own['id'], token='member-token')[0], 200)
        remaining = self.http('GET', '/api/admin/healing-prayers', token='gabbai-token')[1]
        self.assertEqual([entry['id'] for entry in remaining], [other['id']])

    def test_additive_schema_upgrade_and_older_profile_writes_preserve_prayer_data(self):
        with self.store.db() as db:
            before = [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')]
            db.execute('DROP TABLE healing_prayers')
        self.store = Store(self.store.path)
        entry = self.add()
        profile = self.store.state(self.member)['profile']
        profile.pop('firstName')
        profile.pop('lastName')
        profile.pop('tribe')
        self.assertEqual(self.http('PUT', '/api/profile', profile, 'member-token')[0], 200)
        Store(self.store.path)
        Store(self.store.path)
        with self.store.db() as db:
            after = [tuple(row) for row in db.execute('SELECT id,created_at FROM community_people ORDER BY id')]
            self.assertEqual(before, after)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
        self.assertEqual(self.store.healing_prayers(self.member), [entry])

    def test_authentication_and_delete_cors_preflight(self):
        self.assertEqual(self.http('GET', '/api/healing-prayers')[0], 401)
        self.assertEqual(self.http('POST', '/api/healing-prayers', dict(name='משה בן שרה'))[0], 401)
        self.assertEqual(self.http('DELETE', '/api/healing-prayers/missing')[0], 401)
        status, _, headers = self.http('OPTIONS', '/api/healing-prayers/missing', origin='http://localhost:8081', extra={'Access-Control-Request-Method': 'DELETE'})
        self.assertEqual(status, 204)
        self.assertIn('DELETE', headers)

    def standalone_person(self):
        with self.store.db() as db:
            db.execute('''INSERT INTO roster_people (id,first_name,last_name,display_name,created_at,updated_at)
                VALUES ('imported-person','ישראל','ישראלי','ישראל ישראלי','2026-01-01','2026-01-01')''')
        return dict(rosterPersonId='imported-person', submitter='ישראל ישראלי', name='מרים בת שרה', addedOn='2026-09-01')

    def test_roster_import_keeps_identity_date_and_account_privacy_without_creating_accounts(self):
        entry = self.standalone_person()
        with self.store.db() as db:
            accounts = db.execute('SELECT COUNT(*) FROM users').fetchone()[0]
            people = db.execute('SELECT COUNT(*) FROM roster_people').fetchone()[0]
            self.assertEqual(import_requests(db, [entry])[0]['status'], 'new')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM healing_prayers').fetchone()[0], 0)
            import_requests(db, [entry], apply=True)
            self.assertEqual(import_requests(db, [entry], apply=True)[0]['status'], 'existing')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0], accounts)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM roster_people').fetchone()[0], people)
        status, rows, _ = self.http('GET', '/api/admin/healing-prayers', token='gabbai-token')
        self.assertEqual(status, 200)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['memberId'], rows[0]['rosterPersonId'], rows[0]['memberName'], rows[0]['addedOn']),
                         (None, 'imported-person', 'ישראל ישראלי', '2026-09-01'))
        for token in ['member-token', 'other-token', 'gabbai-token']:
            self.assertEqual(self.http('GET', '/api/healing-prayers', token=token)[1], [])
            self.assertEqual(self.http('DELETE', '/api/healing-prayers/' + rows[0]['id'], token=token)[0], 404)
        with self.store.db() as db:
            db.execute("UPDATE roster_people SET first_name='משה' WHERE id='imported-person'")
        self.assertEqual(Store(self.store.path).healing_prayers(self.gabbai, all_members=True)[0]['memberName'], 'משה ישראלי')

    def test_import_requires_confirmed_identity_and_validates_the_whole_batch_before_writing(self):
        entry = self.standalone_person()
        for invalid in [dict(entry, submitter='ישראלי ישראל'), dict(entry, rosterPersonId='missing'),
                        dict(entry, addedOn='01-09-2026'), dict(entry, addedOn='2026-02-30'),
                        dict(entry, rosterPersonId=None), dict(entry, unmatchedSubmitter=True)]:
            with self.store.db() as db:
                with self.assertRaises(APIError):
                    import_requests(db, [entry, invalid], apply=True)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM healing_prayers').fetchone()[0], 0)
        with self.store.db() as db:
            with self.assertRaises(APIError):
                import_requests(db, [entry, entry], apply=True)
            import_requests(db, [entry], apply=True)
            with self.assertRaises(APIError) as conflict:
                import_requests(db, [dict(entry, addedOn='2026-09-02')], apply=True)
            self.assertEqual(conflict.exception.status, 409)
            self.assertEqual(db.execute('SELECT added_on FROM healing_prayers').fetchone()[0], '2026-09-01')

    def test_explicit_unmatched_import_preserves_submitter_without_inventing_a_person(self):
        entry = dict(rosterPersonId=None, unmatchedSubmitter=True, submitter='מכניס חסר', name='חולה בן אם', addedOn='2026-10-16')
        with self.store.db() as db:
            people = db.execute('SELECT COUNT(*) FROM roster_people').fetchone()[0]
            import_requests(db, [entry], apply=True)
            self.assertEqual(import_requests(db, [entry], apply=True)[0]['status'], 'existing')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM roster_people').fetchone()[0], people)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
        row = self.http('GET', '/api/admin/healing-prayers', token='gabbai-token')[1][0]
        self.assertTrue(row['unmatchedSubmitter'])
        self.assertIsNone(row['memberId'])
        self.assertNotIn('rosterPersonId', row)
        self.assertEqual(row['memberName'], entry['submitter'])

    @patch('server.store.israel_today', return_value=date(2026, 9, 3))
    def test_import_for_verified_self_roster_uses_existing_account_ownership(self, _clock):
        with self.store.db() as db:
            person = db.execute('SELECT * FROM roster_people WHERE id=?', (self.member_id,)).fetchone()
            entry = dict(rosterPersonId=self.member_id, submitter=person['display_name'], name='חולה בן אם', addedOn='2026-09-02')
            import_requests(db, [entry], apply=True)
        row = self.http('GET', '/api/healing-prayers', token='member-token')[1][0]
        self.assertEqual(row['memberId'], self.member_id)
        self.assertEqual(self.http('DELETE', '/api/healing-prayers/' + row['id'], token='member-token')[0], 200)

    @patch('server.store.israel_today', return_value=date(2026, 9, 2))
    def test_legacy_schema_upgrade_preserves_owned_requests_and_order(self, _clock):
        with self.store.db() as db:
            db.execute('DROP TABLE healing_prayers')
            db.execute('''CREATE TABLE healing_prayers (id TEXT PRIMARY KEY,
                member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL, added_on TEXT NOT NULL, UNIQUE(member_id,name))''')
            db.execute('INSERT INTO healing_prayers VALUES (?,?,?,?)', ('first', self.member_id, 'ראשון בן אם', '2026-09-01'))
            db.execute('INSERT INTO healing_prayers VALUES (?,?,?,?)', ('second', self.member_id, 'שני בן אם', '2026-09-01'))
        restarted = Store(self.store.path)
        rows = restarted.healing_prayers(self.member)
        self.assertEqual([row['id'] for row in rows], ['second', 'first'])
        self.assertEqual([row['addedOn'] for row in rows], ['2026-09-01', '2026-09-01'])
        self.assertEqual(Store(self.store.path).healing_prayers(self.member), rows)
        self.assertEqual(self.http('DELETE', '/api/healing-prayers/first', token='member-token')[0], 200)
        with self.store.db() as db:
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])


if __name__ == '__main__':
    unittest.main()
