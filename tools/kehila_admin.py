"""Admin CLI. Usage: .venv/bin/python tools/kehila_admin.py create --env dev --name "<name>" [--lang he] [--logo logo.png]
       .venv/bin/python tools/kehila_admin.py set-logo --env dev --kehila <id> --logo logo.png

       .venv/bin/python tools/kehila_admin.py gabbai-invite --env dev --kehila <id>
       .venv/bin/python tools/kehila_admin.py backfill-families --env dev [--kehila <id>]
       .venv/bin/python tools/kehila_admin.py set-role --env dev --kehila <id> --user <userId|email> --role <role> [--apply]
       .venv/bin/python tools/kehila_admin.py merge-channels --env dev [--kehila <id>] [--apply]   (dry run without --apply)

Creates a Kehila (with default channels) and prints its ID and a one-use, 7-day gabbai invite code.
The table name and (when AWS_DEFAULT_REGION is unset) the region come from `terraform output`. The functions are importable for tests and the smoke test.
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.cloud import authz  # noqa: E402
from server.cloud.logo import validate_logo  # noqa: E402
from server.cloud.repo import Repo  # noqa: E402


LEGACY_CHANNELS = ('simchas', 'condolences')
MAIN_CHANNEL = 'announcements'


def terraform_output(env, name):
    return subprocess.run(['terraform', f'-chdir={ROOT}/infra/envs/{env}', 'output', '-raw', name],
                          check=True, capture_output=True, text=True).stdout.strip()


def table_name(env):
    return terraform_output(env, 'table_name')


def open_repo(env):
    import boto3
    region = os.environ.get('AWS_DEFAULT_REGION') or os.environ.get('AWS_REGION') or terraform_output(env, 'region')
    return Repo(boto3.resource('dynamodb', region_name=region).Table(table_name(env)))


def gabbai_invite(repo, k):
    """One-use, 7-day gabbai invite for an existing Kehila (lock-out recovery). Exits if it does not exist."""
    if not repo.get_kehila(k):
        sys.exit(f'Kehila {k} does not exist')
    return repo.create_invite(k, 'admin-cli', authz.GABBAI, 1, 7)


def backfill_families(repo, k=None):
    """Give every adult (authz.ADULTS) without a family one (all Kehilot, or just `k`). Idempotent.
    Returns (kehilot, created)."""
    kehilot = [k] if k else repo.list_kehila_ids()
    created = 0
    for kehila in kehilot:
        for membership in repo.list_members(kehila):
            if authz.role_in(membership, authz.ADULTS) and not membership.get('familyId'):
                created += repo._ensure_family(kehila, membership['userId'])[1]
    return len(kehilot), created


def sweep_orphan_families(repo, k=None, delete=True):
    """Families with no live adult (all Kehilot, or just `k`). Deleted unless `delete` is False (report only).
    Returns how many."""
    return sum(repo.sweep_orphan_families(kehila, delete) for kehila in ([k] if k else repo.list_kehila_ids()))


def merge_channels(repo, k=None, apply=False):
    """Message types replace the `simchas` / `condolences` channels. Per Kehila (all, or just `k`): those channels
    with no messages are deleted (only with `apply`), those holding messages are kept and reported, and the main
    channel (`announcements`) post policy becomes `broadcasters`. Returns one dict of ids and counts per Kehila."""
    plans = []
    for kehila in ([k] if k else repo.list_kehila_ids()):
        channels = repo.list_channels(kehila)
        used = {m['channelId'] for m in repo.iter_messages(kehila)}
        legacy = [c for c in channels if c['name'] in LEGACY_CHANNELS and not c.get('conversation')]
        delete = [c['sk'][2:] for c in legacy if c['sk'][2:] not in used]
        keep = [c['sk'][2:] for c in legacy if c['sk'][2:] in used]
        main = [c for c in channels if c['name'] == MAIN_CHANNEL and c.get('postPolicy') != 'broadcasters']
        plan = {'kehila': kehila, 'delete': delete, 'keep': keep, 'main': [c['sk'][2:] for c in main]}
        plans.append(plan)
        if apply:
            for channel_id in delete:
                repo.delete_channel(kehila, channel_id)
            for c in main:
                repo.update_channel(kehila, c['sk'][2:], c['name'], c['listenersCanRead'], 'broadcasters')
    return plans


def cognito_client():
    import boto3
    return boto3.client('cognito-idp', region_name=os.environ.get('AWS_DEFAULT_REGION')
                        or os.environ.get('AWS_REGION') or terraform_output('dev', 'region'))


def resolve_user(repo, env, user):
    """A userId as given, or (when it holds an @) the account's userId via Cognito. Never echoes an email."""
    if '@' not in user:
        return user
    client = cognito_client()
    try:
        found = client.admin_get_user(UserPoolId=terraform_output(env, 'user_pool_id'), Username=user.strip().lower())
    except client.exceptions.UserNotFoundException:
        sys.exit('no account for that email')
    sub = next(a['Value'] for a in found['UserAttributes'] if a['Name'] == 'sub')
    user_id = repo.get_user_id(sub)
    if not user_id:
        sys.exit('that account has never signed in to the app')
    return user_id


def set_role(repo, k, user_id, role, apply=False):
    """Change one member's role (never to or from listener). Refuses, apply or not, when it would leave the
    Kehila without a gabbai or tech. Returns (old role, new role, applied). Exits with a message on a refusal."""
    from server.cloud.errors import ApiError
    if not repo.get_kehila(k):
        sys.exit(f'Kehila {k} does not exist')
    member = repo.get_membership(k, user_id)
    if not member:
        sys.exit('not a member of that Kehila')
    old = member['role']
    if not authz.in_set(role, authz.NON_LISTENERS) or not authz.in_set(old, authz.NON_LISTENERS):
        sys.exit('a listener cannot be given a role here, and no one becomes a listener (use the approval flow)')
    if old == role:
        return old, role, False
    others = [m for m in repo.list_members(k) if m['userId'] != user_id and authz.role_in(m, authz.MANAGEMENT)]
    if authz.in_set(old, authz.MANAGEMENT) and not authz.in_set(role, authz.MANAGEMENT) and not others:
        sys.exit('refused: this is the last gabbai or tech; make another one first')
    if apply:
        try:
            repo.update_member(k, user_id, old, {'role': role})
        except ApiError as error:
            if error.code == 'last_gabbai':
                sys.exit('refused: this is the last gabbai or tech; make another one first')
            raise
    return old, role, apply


def read_logo(path):
    """Read and validate a logo PNG; exits with a clear message when it is unusable."""
    try:
        data = Path(path).read_bytes()
        validate_logo(data)
    except (OSError, ValueError) as error:
        sys.exit(f'Logo rejected: {error}')
    return data


def create_kehila(repo, name, lang='he', dev=False):
    """Returns (kehilaId, gabbai invite code)."""
    settings = {'defaultLang': lang}
    if dev:
        settings['pollSeconds'] = 5
    k = repo.create_kehila(name, settings)
    return k, repo.create_invite(k, 'admin-cli', authz.GABBAI, 1, 7)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    create = sub.add_parser('create')
    create.add_argument('--env', required=True, choices=['dev'])
    create.add_argument('--name', required=True)
    create.add_argument('--lang', default='he', choices=['he', 'en'])
    create.add_argument('--logo', help='path to a square PNG, 64-512 px, at most 65536 bytes')
    set_logo = sub.add_parser('set-logo')
    set_logo.add_argument('--env', required=True, choices=['dev'])
    set_logo.add_argument('--kehila', required=True)
    set_logo.add_argument('--logo', required=True, help='path to a square PNG, 64-512 px, at most 65536 bytes')
    recover = sub.add_parser('gabbai-invite', help='one-use, 7-day gabbai invite for lock-out recovery')
    recover.add_argument('--env', required=True, choices=['dev'])
    recover.add_argument('--kehila', required=True)
    backfill = sub.add_parser('backfill-families', help='create a family for every member and gabbai without one')
    backfill.add_argument('--env', required=True, choices=['dev'])
    backfill.add_argument('--kehila', help='only this Kehila (default: all)')
    backfill.add_argument('--keep-orphans', action='store_true', help='only report families without a live adult')
    merge = sub.add_parser('merge-channels', help='fold the simchas / condolences channels into the main channel '
                                                  '(dry run unless --apply)')
    merge.add_argument('--env', required=True, choices=['dev'])
    merge.add_argument('--kehila', help='only this Kehila (default: all)')
    merge.add_argument('--apply', action='store_true', help='make the changes (default: only print the plan)')
    set_role_cmd = sub.add_parser('set-role', help='change a member\'s role (dry run unless --apply)')
    set_role_cmd.add_argument('--env', required=True, choices=['dev'])
    set_role_cmd.add_argument('--kehila', required=True)
    set_role_cmd.add_argument('--user', required=True, help='a userId, or an email address')
    set_role_cmd.add_argument('--role', required=True, choices=list(authz.NON_LISTENERS))
    set_role_cmd.add_argument('--apply', action='store_true', help='make the change (default: only print it)')
    args = parser.parse_args(argv)
    if args.command == 'set-role':
        repo = open_repo(args.env)
        user_id = resolve_user(repo, args.env, args.user)
        old, new, applied = set_role(repo, args.kehila, user_id, args.role, args.apply)  # ids only, no names
        if old == new:
            print(f'kehila={args.kehila} user={user_id}: already {new}, nothing to do')
        else:
            print(f'kehila={args.kehila} user={user_id}: {old} -> {new}'
                  + (' (applied)' if applied else ' (dry run: nothing changed; add --apply)'))
        return
    if args.command == 'merge-channels':
        plans = merge_channels(open_repo(args.env), args.kehila, args.apply)
        verb = 'deleted' if args.apply else 'would delete'
        for p in plans:  # ids and counts only, never names
            print(f"kehila={p['kehila']} {verb}={len(p['delete'])} kept_with_messages={len(p['keep'])} "
                  f"main_policy_{'set' if args.apply else 'to_set'}={len(p['main'])}"
                  + ''.join(f' keep:{c}' for c in p['keep']))
        print(f"kehilot={len(plans)} {'applied' if args.apply else 'dry-run (nothing changed)'}")
        return
    if args.command == 'backfill-families':
        repo = open_repo(args.env)
        kehilot, created = backfill_families(repo, args.kehila)
        orphans = sweep_orphan_families(repo, args.kehila, delete=not args.keep_orphans)
        print(f'kehilot={kehilot} created={created} orphan_families_{"found" if args.keep_orphans else "deleted"}={orphans}')
        return
    if args.command == 'gabbai-invite':
        print(f'Gabbai invite code (one use, 7 days): {gabbai_invite(open_repo(args.env), args.kehila)}')
        return
    if args.command == 'set-logo':
        data = read_logo(args.logo)
        try:
            version = open_repo(args.env).set_logo(args.kehila, data)
        except LookupError:
            sys.exit(f'Kehila {args.kehila} does not exist in {args.env}')
        print(f'logoVersion: {version}')
        return
    logo = read_logo(args.logo) if args.logo else None
    name = args.name.strip()
    if not name or len(name) > 60:
        parser.error('--name must be 1 to 60 characters')
    repo = open_repo(args.env)
    k, code = create_kehila(repo, name, args.lang, dev=args.env == 'dev')
    print(f'Kehila ID: {k}\nGabbai invite code (one use, 7 days): {code}', flush=True)
    if logo:
        print(f'logoVersion: {repo.set_logo(k, logo)}')


if __name__ == '__main__':
    main()
