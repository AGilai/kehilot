"""AST guards for the named role sets (tech-role plan, Task 1).

Every authorization decision on the server picks one named set from authz.py; no route compares a role string
by hand, writes a role condition by hand, or spells 'gabbai' / 'tech' outside authz.py.
"""
import ast
import json
import pathlib
import unittest
from unittest import mock

from moto import mock_aws

from server.cloud import authz
from server.cloud import handler as handler_module
from server.cloud.errors import ApiError
from server.cloud.repo import Repo
from server.tests.cloud.helpers import make_table
from server.tests.cloud.test_handler import Context, event

CLOUD = pathlib.Path(__file__).resolve().parents[2] / 'cloud'
K = '01JABCDEFGHJKMNPQRSTVWXYZ0'  # a well-formed Kehila ID
ALLOWED = {}  # no gabbai or tech literal outside authz.py
ROLE_NAMES = ('LISTENER', 'MEMBER', 'GABBAI', 'TECH')
# The only references to authz's role constants outside authz.py, per file: input validation, not authorization.
ALLOWED_ROLE_NAMES = {
    # (importer.py and routes_admin.py validate against authz.ALL: no role constant there)
    'routes_invites.py': 4,  # INVITE_ROLES = (LISTENER, MEMBER, TECH) and the default role LISTENER
}


def _modules():
    for path in sorted(CLOUD.rglob('*.py')):
        yield path.relative_to(CLOUD).as_posix(), ast.parse(path.read_text(encoding='utf-8'), filename=str(path))


def _call_name(func):
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _mentions_role(node):
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name) and 'role' in sub.id.lower():
            return True
        if isinstance(sub, ast.Subscript) and isinstance(sub.slice, ast.Constant) and sub.slice.value == 'role':
            return True
        if (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute) and sub.func.attr == 'get'
                and sub.args and isinstance(sub.args[0], ast.Constant) and sub.args[0].value == 'role'):
            return True
    return False


def _role_name(node):
    """`authz.GABBAI` (or a bare `GABBAI`) and the other role constants."""
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == 'authz':
        return node.attr in ROLE_NAMES
    return isinstance(node, ast.Name) and node.id in ROLE_NAMES


def _single_role(node):
    return (isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in authz.ALL) \
        or _role_name(node)


def _role_literal(node):
    if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
        return any(_single_role(e) for e in node.elts)
    return _single_role(node)


class RoleSetGuards(unittest.TestCase):
    def test_every_require_names_a_role_set(self):
        bad = []
        for name, tree in _modules():
            for node in ast.walk(tree):
                if not (isinstance(node, ast.Call) and _call_name(node.func) == 'require'):
                    continue
                if isinstance(node.func, ast.Attribute) and not (
                        isinstance(node.func.value, ast.Name) and node.func.value.id == 'authz'):
                    continue
                arg = node.args[3] if len(node.args) > 3 else next(
                    (kw.value for kw in node.keywords if kw.arg == 'roles'), None)
                set_name = arg.id if isinstance(arg, ast.Name) else arg.attr if isinstance(arg, ast.Attribute) else None
                if set_name not in authz.ROLE_SETS:
                    bad.append(f'{name}:{node.lineno}')
        self.assertEqual(bad, [])

    def test_no_role_literal_comparisons(self):
        bad = []
        for name, tree in _modules():
            if name == 'authz.py':
                continue
            for node in ast.walk(tree):
                if not isinstance(node, ast.Compare):
                    continue
                operands = [node.left, *node.comparators]
                for i, op in enumerate(operands):
                    if _role_literal(op) and any(_mentions_role(o) for j, o in enumerate(operands) if j != i):
                        bad.append(f'{name}:{node.lineno}')
                        break
        self.assertEqual(bad, [])

    def test_no_gabbai_or_tech_constants_outside_authz(self):
        counts = {}
        for name, tree in _modules():
            if name == 'authz.py':
                continue
            n = sum(1 for node in ast.walk(tree)
                    if isinstance(node, ast.Constant) and node.value in ('gabbai', 'tech'))
            if n:
                counts[name] = n
        self.assertEqual(counts, ALLOWED)

    def test_role_constants_only_in_the_allowlist(self):
        counts = {}
        for name, tree in _modules():
            if name == 'authz.py':
                continue
            n = sum(1 for node in ast.walk(tree) if _role_name(node))
            if n:
                counts[name] = n
        self.assertEqual(counts, ALLOWED_ROLE_NAMES)

    def test_guard_catches_authz_constants(self):
        """The comparison guard sees `authz.GABBAI` as a role literal, alone or in a tuple."""
        for snippet in ("m['role'] == authz.GABBAI", "m['role'] in (authz.MEMBER, authz.GABBAI)",
                        "m.get('role') == authz.TECH", "role != GABBAI"):
            compare = ast.parse(snippet, mode='eval').body
            operands = [compare.left, *compare.comparators]
            self.assertTrue(any(_role_literal(o) for o in operands) and any(_mentions_role(o) for o in operands),
                            snippet)

    def test_scan_includes_subpackages(self):
        self.assertIn('aliyot/engine.py', {name for name, _ in _modules()})

    def test_no_hand_written_role_conditions(self):
        bad = []
        for name, tree in _modules():
            for node in ast.walk(tree):
                if isinstance(node, ast.Constant) and isinstance(node.value, str) and (
                        ':gabbai' in node.value or '(:member' in node.value):
                    bad.append(f'{name}:{node.lineno}')
        self.assertEqual(bad, [])


class RoleSetBehaviour(unittest.TestCase):
    def test_require_refuses_an_unnamed_tuple(self):
        repo = mock.Mock()
        repo.get_membership.return_value = {'role': 'gabbai'}
        with self.assertRaises(TypeError):
            authz.require(repo, 'u-yosef', K, ('gabbai',))
        with self.assertRaises(TypeError):
            authz.require(repo, 'u-yosef', K, list(authz.MANAGEMENT))  # equal is not enough: the named object

    def test_require_accepts_a_named_set(self):
        repo = mock.Mock()
        repo.get_membership.return_value = {'role': 'tech'}
        self.assertEqual(authz.require(repo, 'u-yosef', K, authz.MANAGEMENT), {'role': 'tech'})
        with self.assertRaises(ApiError) as caught:
            authz.require(repo, 'u-yosef', K, authz.MEMBER_ONLY)
        self.assertEqual(caught.exception.status, 403)

    def test_role_condition(self):
        self.assertEqual(authz.role_condition(authz.MANAGEMENT),
                         ('#r IN (:r0, :r1)', {':r0': 'gabbai', ':r1': 'tech'}))
        self.assertEqual(authz.role_condition(authz.MEMBER_ONLY, '#x'), ('#x IN (:r0)', {':r0': 'member'}))

    def test_in_set_and_role_in(self):
        self.assertTrue(authz.in_set('tech', authz.MANAGEMENT))
        self.assertFalse(authz.in_set(None, authz.ALL))
        self.assertFalse(authz.role_in(None, authz.ALL))
        self.assertFalse(authz.role_in({}, authz.ALL))
        self.assertTrue(authz.role_in({'role': 'member'}, authz.ADULTS))
        self.assertTrue(authz.role_in({'role': 'tech'}, authz.ADULTS))

    def test_no_switches(self):
        """Owner decision: a tech has every right of a gabbai; no switch narrows it."""
        for name in ('TECH_ACCEPTS_TERMS', 'TECH_REMOVES_OTHERS_MESSAGES', 'TECH_IS_MEMBER', 'GABBAI_ONLY', 'TERMS',
                     'APPOINTABLE'):
            self.assertFalse(hasattr(authz, name), name)

    def test_every_set_with_gabbai_has_tech(self):
        for name, roles in authz.ROLE_SETS.items():
            self.assertEqual('gabbai' in roles, 'tech' in roles, name)

    def test_set_values(self):
        self.assertEqual(authz.ALL, ('listener', 'member', 'gabbai', 'tech'))
        self.assertEqual(authz.NON_LISTENERS, ('member', 'gabbai', 'tech'))
        self.assertEqual(authz.ADULTS, ('member', 'gabbai', 'tech'))
        self.assertEqual(authz.MANAGEMENT, ('gabbai', 'tech'))
        self.assertEqual(authz.LISTENER_ONLY, ('listener',))
        self.assertEqual(authz.MEMBER_ONLY, ('member',))
        self.assertEqual(set(authz.ROLE_SETS), {'ALL', 'NON_LISTENERS', 'ADULTS', 'MANAGEMENT', 'LISTENER_ONLY',
                                                'MEMBER_ONLY'})
        for name in authz.ROLE_SETS:
            self.assertIs(authz.ROLE_SETS[name], getattr(authz, name))


@mock_aws
class TechLikeGabbai(unittest.TestCase):
    """A tech gets exactly what a gabbai gets (owner decision 2026-10-28); only the label differs."""

    def setUp(self):
        self.repo = Repo(make_table())
        patcher = mock.patch.object(handler_module, '_repo', return_value=self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.k = self.repo.create_kehila('קהילת ניסיון', {})
        self.gabbai = self.user('gabbai-sub', 'gabbai')
        self.tech = self.user('tech-sub', 'tech')
        self.member = self.user('member-sub', 'member')

    def call(self, method, path, sub, body=None):
        evt = event(method, path, sub=sub, body=json.dumps(body) if body is not None else None)
        response = handler_module.handler(evt, Context())
        return response['statusCode'], json.loads(response['body']) if response['body'] else None

    def user(self, sub, role):
        user_id = self.call('GET', '/v1/me', sub)[1]['userId']
        self.call('PUT', '/v1/me/profile', sub, {'firstName': 'יוסף', 'lastName': 'דוגמה', 'lang': 'he'})
        self.repo.put_membership(self.k, user_id, role)
        return user_id

    def test_gabbai_only_reads_are_open_to_tech(self):
        base = f'/v1/kehilot/{self.k}'
        for path in ('/admin/members', '/admin/requests', '/admin/families', '/admin/simchas',
                     '/admin/seating/holders', '/admin/seating/layouts', '/admin/seating/auto-links',
                     '/admin/push-texts', '/admin/groups', '/admin/tags'):
            gabbai, tech = self.call('GET', base + path, 'gabbai-sub'), self.call('GET', base + path, 'tech-sub')
            self.assertEqual(gabbai[0], 200, path)
            self.assertEqual(tech, gabbai, path)
        self.assertEqual(self.call('GET', base + '/admin/members', 'member-sub')[0], 403)

    def test_tech_accepts_terms(self):
        status, body = self.call('POST', f'/v1/kehilot/{self.k}/admin/terms', 'tech-sub')
        self.assertEqual(status, 200)
        self.assertIn('at', body)

    def test_tech_grants_and_changes_the_gabbai_role(self):
        path = f'/v1/kehilot/{self.k}/admin/members/{self.member}'
        self.assertEqual(self.call('PUT', path, 'tech-sub', {'role': 'gabbai'})[0], 200)
        self.assertEqual(self.repo.get_membership(self.k, self.member)['role'], 'gabbai')
        self.assertEqual(self.call('PUT', path, 'tech-sub', {'role': 'member'})[0], 200)
        self.assertEqual(self.call('DELETE', f'/v1/kehilot/{self.k}/admin/members/{self.gabbai}', 'tech-sub')[0], 204)

    def test_a_tech_keeps_management_alive(self):
        """At least one gabbai or tech remains: with a tech left, the last gabbai may step down and leave."""
        base = f'/v1/kehilot/{self.k}'
        self.assertEqual(self.call('PUT', f'{base}/admin/members/{self.gabbai}', 'gabbai-sub', {'role': 'member'})[0],
                         200)
        # now the tech is the last of the management: he cannot leave or be removed
        self.assertEqual(self.call('DELETE', f'{base}/membership', 'tech-sub'), (409, {'error': 'last_gabbai'}))
        self.assertEqual(self.call('DELETE', f'{base}/admin/members/{self.tech}', 'tech-sub'),
                         (409, {'error': 'last_gabbai'}))
        self.assertEqual(self.repo.get_membership(self.k, self.tech)['role'], 'tech')

    def test_gabbai_and_tech_demoting_each_other_leave_one(self):
        """The tech demotes the gabbai while the gabbai demotes the tech: one of them must stay management."""
        base = f'/v1/kehilot/{self.k}'
        real = self.repo._guarded
        calls = []

        def racing(*args, **kwargs):
            if not calls:  # after the tech's witness (the gabbai... or the tech) was chosen, before his transaction
                calls.append(1)
                self.assertEqual(self.call('PUT', f'{base}/admin/members/{self.tech}', 'gabbai-sub',
                                           {'role': 'member'})[0], 200)
            return real(*args, **kwargs)
        with mock.patch.object(self.repo, '_guarded', side_effect=racing):
            status, body = self.call('PUT', f'{base}/admin/members/{self.gabbai}', 'tech-sub', {'role': 'member'})
        self.assertEqual((status, body), (409, {'error': 'last_gabbai'}))
        self.assertEqual(self.repo.get_membership(self.k, self.gabbai)['role'], 'gabbai')
        self.assertEqual(self.repo.get_membership(self.k, self.tech)['role'], 'member')

    def test_tech_removes_someone_elses_message(self):
        base = f'/v1/kehilot/{self.k}'
        channel = self.repo.list_channels(self.k)[0]
        channel_id = channel['sk'][len('C#'):]
        status, message = self.call('POST', f'{base}/messages', 'gabbai-sub',
                                    {'channelId': channel_id, 'type': 'general', 'title': 'הודעת ניסיון'})
        self.assertEqual(status, 201)
        self.assertEqual(self.call('DELETE', f'{base}/messages/{message["messageId"]}', 'tech-sub')[0], 204)

    def test_tech_posts_as_management(self):
        channel = self.repo.list_channels(self.k)[0]
        status, message = self.call('POST', f'/v1/kehilot/{self.k}/messages', 'tech-sub',
                                    {'channelId': channel['sk'][len('C#'):], 'type': 'general', 'title': 'עדכון'})
        self.assertEqual(status, 201)
        self.assertEqual(message['authorKind'], 'management')


if __name__ == '__main__':
    unittest.main()
