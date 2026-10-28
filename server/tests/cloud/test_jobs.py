import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import expo, jobs
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table


@mock_aws
class JobsTest(unittest.TestCase):
    def setUp(self):
        self.repo = Repo(make_table())
        self.asked = []
        patches = [mock.patch.object(jobs, '_repo', return_value=self.repo),
                   mock.patch.object(expo, 'access_token', return_value='tok'),
                   mock.patch.object(expo, 'receipts', side_effect=self.fake_receipts)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def fake_receipts(self, ids, token):
        self.asked.append(list(ids))
        out = {}
        for i in ids:
            if i.startswith('dead'):
                out[i] = {'status': 'error', 'details': {'error': 'DeviceNotRegistered'}}
            elif i.startswith('ok'):
                out[i] = {'status': 'ok'}
        return out  # 'pending*' tickets have no receipt yet

    def test_receipts_prune_dead_tokens(self):
        for uid in ('u1', 'u2'):
            self.repo.put_device(uid, f'ExponentPushToken[{uid}aaaaaaaaaa]', 'ios')
        self.repo.put_push_ticket('dead1', 'ExponentPushToken[u1aaaaaaaaaa]', 'u1', 9999999999)
        self.repo.put_push_ticket('ok1', 'ExponentPushToken[u2aaaaaaaaaa]', 'u2', 9999999999)
        self.repo.put_push_ticket('pending1', 'ExponentPushToken[u2aaaaaaaaaa]', 'u2', 9999999999)
        jobs.handler({'job': 'push_receipts'}, None)
        self.assertEqual(self.repo.list_devices('u1'), [])
        self.assertEqual(len(self.repo.list_devices('u2')), 1)
        self.assertEqual([t['sk'] for t in self.repo.list_push_tickets()], ['T#pending1'])

    def test_receipts_chunks_of_300(self):
        for i in range(650):
            self.repo.put_push_ticket(f'ok{i:04}', 'ExponentPushToken[xxxxxxxxxxxx]', 'u1', 9999999999)
        jobs.handler({'job': 'push_receipts'}, None)
        self.assertEqual([len(a) for a in self.asked], [300, 300, 50])
        self.assertEqual(self.repo.list_push_tickets(), [])

    def test_no_tickets_makes_no_expo_call(self):
        jobs.handler({'job': 'push_receipts'}, None)
        self.assertEqual(self.asked, [])

    def test_handler_passes_event(self):
        seen = []
        with mock.patch.dict(jobs.JOBS, {'probe': lambda repo, event: seen.append((repo, event))}):
            self.assertEqual(jobs.handler({'job': 'probe', 'dryRun': True}, None), {'ok': True})
        self.assertEqual(seen, [(self.repo, {'job': 'probe', 'dryRun': True})])
        self.repo.put_push_ticket('ok1', 'ExponentPushToken[u2aaaaaaaaaa]', 'u2', 9999999999)
        self.assertEqual(jobs.handler({'job': 'push_receipts'}, None), {'ok': True})
        self.assertEqual(self.repo.list_push_tickets(), [])

    def test_unknown_job_raises(self):
        with self.assertRaises(ValueError):
            jobs.handler({'job': 'nope'}, None)
        with self.assertRaises(ValueError):
            jobs.handler({}, None)
