import importlib.util
import io
import os
import unittest
from contextlib import redirect_stdout
from unittest import mock

from moto import mock_aws

from server.cloud import type_rules
from server.tests.cloud import test_messages

_spec = importlib.util.spec_from_file_location(
    'kehila_admin', os.path.join(os.path.dirname(__file__), '..', '..', '..', 'tools', 'kehila_admin.py'))
kehila_admin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kehila_admin)

DEFAULTS = {'celebration': {'post': 'broadcasters', 'listeners': False},
            'condolence': {'post': 'broadcasters', 'listeners': False}}
RULE = {'post': 'management', 'listeners': True}


@mock_aws
class TypeRulesSettingsTest(test_messages.MessagesTest):
    def put(self, body, sub='gabbai-sub'):
        return self.call('PUT', f'{self.base()}/admin/settings', sub=sub, body=body)

    def shown(self, sub='gabbai-sub'):
        return self.call('GET', self.base(), sub=sub)[1]

    def test_new_kehila_has_exactly_one_channel(self):
        k = self.repo.create_kehila('Beit Fresh', {})
        channels = self.repo.list_channels(k)
        self.assertEqual([(c['name'], c['listenersCanRead'], c['postPolicy']) for c in channels],
                         [('announcements', True, 'broadcasters')])

    def test_get_returns_defaults_to_gabbai_only(self):
        self.assertEqual(self.shown()['typeRules'], DEFAULTS)
        for sub in ('member-sub', 'listener-sub'):
            self.assertNotIn('typeRules', self.shown(sub))

    def test_put_full_then_partial_keeps_the_other_type(self):
        self.assertEqual(self.put({'typeRules': {'celebration': RULE}}), (200, {}))
        self.assertEqual(self.shown()['typeRules'], {**DEFAULTS, 'celebration': RULE})
        self.assertEqual(self.put({'typeRules': {'condolence': {'post': 'broadcasters', 'listeners': True}}})[0], 200)
        self.assertEqual(self.shown()['typeRules'],
                         {'celebration': RULE, 'condolence': {'post': 'broadcasters', 'listeners': True}})

    def test_type_rules_with_other_settings_and_alone_keep_the_rest(self):
        self.assertEqual(self.put({'maxListeners': 9, 'typeRules': {'celebration': RULE}})[0], 200)
        self.put({'typeRules': {'condolence': RULE}})
        got = self.shown()
        self.assertEqual((got['settings']['maxListeners'], got['typeRules']['celebration']), (9, RULE))

    def test_stored_garbage_is_shown_as_defaults_and_a_put_repairs_it(self):
        self.repo.table.update_item(Key={'pk': f'K#{self.k}', 'sk': 'META'}, UpdateExpression='SET settings.typeRules = :r',
                                    ExpressionAttributeValues={':r': 'junk'})
        self.assertEqual(self.shown()['typeRules'], DEFAULTS)
        self.assertEqual(self.put({'typeRules': {'celebration': RULE}})[0], 200)
        self.assertEqual(self.shown()['typeRules'], {**DEFAULTS, 'celebration': RULE})

    def test_invalid_bodies_are_rejected_and_change_nothing(self):
        bad = [{}, [], 'x', None, {'general': RULE}, {'celebration': {'post': 'all', 'listeners': True}},
               {'celebration': {'post': 'management', 'listeners': 'yes'}}, {'celebration': {'post': 'management'}},
               {'celebration': {**RULE, 'extra': 1}}, {'celebration': 'x'}, {'celebration': {'post': 'management', 'listeners': 1}}]
        for rules in bad:
            self.assertEqual(self.put({'typeRules': rules}), (400, {'error': 'invalid_type_rules'}), rules)
        self.assertEqual(self.put({'typeRules': {'celebration': RULE, 'weekly': RULE}})[0], 400)
        self.assertEqual(self.shown()['typeRules'], DEFAULTS)

    def test_non_gabbai_gets_403(self):
        for sub in ('member-sub', 'listener-sub'):
            self.assertEqual(self.put({'typeRules': {'celebration': RULE}}, sub)[0], 403)
        self.assertEqual(self.shown()['typeRules'], DEFAULTS)


@mock_aws
class MergeChannelsTest(test_messages.MessagesTest):
    def setUp(self):
        super().setUp()
        for c in self.repo.list_channels(self.k):  # start from an old-style Kehila
            self.repo.delete_channel(self.k, c['sk'][2:])
        self.main = self.repo.put_channel(self.k, 'announcements', True, 'management')['sk'][2:]
        self.simchas = self.repo.put_channel(self.k, 'simchas', False, 'broadcasters')['sk'][2:]
        self.cond = self.repo.put_channel(self.k, 'condolences', False, 'broadcasters')['sk'][2:]
        self.other = self.repo.create_kehila('Beit Other', {})

    def run_cli(self, *args):
        out = io.StringIO()
        with mock.patch.object(kehila_admin, 'open_repo', return_value=self.repo), redirect_stdout(out):
            kehila_admin.main(['merge-channels', '--env', 'dev', *args])
        return out.getvalue()

    def names(self, k=None):
        return sorted(c['name'] for c in self.repo.list_channels(k or self.k))

    def policy(self):
        return self.repo.get_channel(self.k, self.main)['postPolicy']

    def test_dry_run_changes_nothing_and_prints_no_names(self):
        out = self.run_cli()
        self.assertEqual((self.names(), self.policy()), (['announcements', 'condolences', 'simchas'], 'management'))
        self.assertIn('dry-run', out)
        self.assertIn(f'kehila={self.k} would delete=2', out)
        for name in ('Beit Test', 'Beit Other', 'simchas', 'condolences', 'Gabi', 'Mia'):
            self.assertNotIn(name, out)

    def test_apply_deletes_empty_keeps_used_and_opens_main_posting(self):
        self.repo.put_message(self.k, self.simchas, 'celebration', 'Mazal tov', '', self.member, 'Mia Member',
                              'member', None)
        out = self.run_cli('--apply', '--kehila', self.k)
        self.assertEqual((self.names(), self.policy()), (['announcements', 'simchas'], 'broadcasters'))
        self.assertIn(f'kept_with_messages=1 main_policy_set=1 keep:{self.simchas}', out)
        self.assertNotIn('Mazal tov', out)
        self.assertEqual(self.names(self.other), ['announcements'])  # --kehila limited the run

    def test_apply_is_idempotent_and_covers_all_kehilot(self):
        self.run_cli('--apply')
        out = self.run_cli('--apply')
        self.assertEqual(self.names(), ['announcements'])
        self.assertIn('deleted=0 kept_with_messages=0 main_policy_set=0', out)
        self.assertIn('kehilot=2', out)


def load_tests(loader, tests, pattern):
    """Only this module's tests, not the inherited MessagesTest ones."""
    suite = unittest.TestSuite()
    for case in (TypeRulesSettingsTest, MergeChannelsTest):
        suite.addTests(t for t in loader.loadTestsFromTestCase(case) if t.id().split('.')[-1] in vars(case))
    return suite


if __name__ == '__main__':
    unittest.main()
