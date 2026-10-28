import argparse
import base64
import getpass
import json
import os
from pathlib import Path

from .app import DEFAULT_DB
from .store import Store
from .validation import APIError
from .member_import import template


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
    link = commands.add_parser('link-phone', help='Link a trusted existing account before phone sign-in; preserves its permanent identity')
    link.add_argument('--email', required=True)
    link.add_argument('--phone', required=True)
    seating_link = commands.add_parser('link-seating-account', help='Explicit trusted link to an existing imported household; dry run unless --apply')
    seating_link.add_argument('--email', required=True)
    seating_link.add_argument('--person-id', required=True)
    seating_link.add_argument('--apply', action='store_true')
    members = commands.add_parser('import-members')
    members.add_argument('--author-email', required=True)
    members.add_argument('--file', type=Path, required=True)
    sample = commands.add_parser('membership-template')
    sample.add_argument('--file', type=Path, required=True)
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
        elif args.command == 'membership-template':
            template(args.file)
            print('Excel template created.')
        elif args.command == 'link-phone':
            print('Phone linked to existing account: ' + store.link_phone(args.email, args.phone))
        elif args.command == 'link-seating-account':
            result = store.link_seating_account(args.email, args.person_id, args.apply)
            print(json.dumps(dict(applied=args.apply, **result)))
        elif args.command in ('publish', 'import-members'):
            with store.db() as db:
                user = db.execute('SELECT * FROM users WHERE email=?', (args.author_email.strip().lower(),)).fetchone()
            if not user:
                parser.error('Author account does not exist')
            if args.command == 'import-members':
                if args.file.stat().st_size > 5 * 1024 * 1024:
                    parser.error('Excel file exceeds 5 MiB')
                result = store.import_members(dict(user), dict(name=args.file.name, base64=base64.b64encode(args.file.read_bytes()).decode()))
                print(f'Imported {result["added"]} new members; updated {result["updated"]} existing entries.')
            else:
                result = store.publish(dict(user), json.loads(args.file.read_text(encoding='utf-8')))
                print(f'Published message: {result["id"]}')
    except (APIError, ValueError, OSError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
