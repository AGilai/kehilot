"""Admin CLI. Usage: .venv/bin/python tools/kehila_admin.py create --env dev --name "<name>" [--lang he] [--logo logo.png]
       .venv/bin/python tools/kehila_admin.py set-logo --env dev --kehila <id> --logo logo.png

       .venv/bin/python tools/kehila_admin.py gabbai-invite --env dev --kehila <id>
       .venv/bin/python tools/kehila_admin.py backfill-families --env dev [--kehila <id>]

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
from server.cloud.logo import validate_logo  # noqa: E402
from server.cloud.repo import Repo  # noqa: E402


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
    return repo.create_invite(k, 'admin-cli', 'gabbai', 1, 7)


def backfill_families(repo, k=None):
    """Give every member and gabbai without a family one (all Kehilot, or just `k`). Idempotent.
    Returns (kehilot, created)."""
    kehilot = [k] if k else repo.list_kehila_ids()
    created = 0
    for kehila in kehilot:
        for membership in repo.list_members(kehila):
            if membership.get('role') in ('member', 'gabbai') and not membership.get('familyId'):
                created += repo._ensure_family(kehila, membership['userId'])[1]
    return len(kehilot), created


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
    return k, repo.create_invite(k, 'admin-cli', 'gabbai', 1, 7)


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
    args = parser.parse_args(argv)
    if args.command == 'backfill-families':
        kehilot, created = backfill_families(open_repo(args.env), args.kehila)
        print(f'kehilot={kehilot} created={created}')
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
