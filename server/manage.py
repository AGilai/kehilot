import argparse
import getpass
import json
import os
from pathlib import Path

from .app import DEFAULT_DB
from .store import Store
from .validation import APIError


def main():
    parser = argparse.ArgumentParser(description='Local account and test-announcement management. No default passwords.')
    parser.add_argument('--db', default=os.environ.get('SHUL_DB', str(DEFAULT_DB)))
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('create-user')
    create.add_argument('--email', required=True)
    create.add_argument('--name', required=True)
    create.add_argument('--role', choices=['member', 'gabbai'], default='member')
    reset = commands.add_parser('reset-password')
    reset.add_argument('--email', required=True)
    publish = commands.add_parser('publish')
    publish.add_argument('--author-email', required=True)
    publish.add_argument('--file', type=Path, required=True, help='UTF-8 JSON: category, title, body, optional pinned')
    args = parser.parse_args()
    store = Store(args.db)
    try:
        if args.command in ('create-user', 'reset-password'):
            password = getpass.getpass('Password (12–128 characters): ')
            confirm = getpass.getpass('Confirm password: ')
            if password != confirm:
                parser.error('Passwords do not match')
            if args.command == 'create-user':
                identifier = store.create_user(args.email, password, args.name, args.role)
                print(f'Account created: {identifier}')
            else:
                store.reset_password(args.email, password)
                print('Password reset; existing sessions and device tokens revoked.')
        elif args.command == 'publish':
            with store.db() as db:
                user = db.execute('SELECT * FROM users WHERE email=?', (args.author_email.strip().lower(),)).fetchone()
            if not user:
                parser.error('Author account does not exist')
            result = store.publish(dict(user), json.loads(args.file.read_text(encoding='utf-8')))
            print(f'Published message: {result["id"]}')
    except (APIError, ValueError, OSError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
