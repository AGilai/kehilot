"""Admin CLI. Usage: .venv/bin/python tools/kehila_admin.py create --env dev --name "<name>" [--lang he] [--logo logo.png]
       .venv/bin/python tools/kehila_admin.py set-logo --env dev --kehila <id> --logo logo.png

Creates a Kehila (with default channels) and prints its ID and a one-use, 7-day gabbai invite code.
The table name comes from `terraform output`. The functions are importable for tests and the smoke test.
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.cloud.logo import validate_logo  # noqa: E402
from server.cloud.repo import Repo  # noqa: E402


def table_name(env):
    return subprocess.run(['terraform', f'-chdir={ROOT}/infra/envs/{env}', 'output', '-raw', 'table_name'],
                          check=True, capture_output=True, text=True).stdout.strip()


def open_repo(env):
    import boto3
    return Repo(boto3.resource('dynamodb').Table(table_name(env)))


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
    args = parser.parse_args(argv)
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
