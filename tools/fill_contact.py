#!/usr/bin/env python3
"""Substitute the platform contact into the built privacy and terms pages.

The address is not in git (the repo is public). It comes from the env var KEHILOT_PLATFORM_CONTACT, else from the
line PLATFORM_CONTACT=<value> in infra/envs/<env>/site.env (git-ignored).
Usage: python3 tools/fill_contact.py --env dev --dist dist/web
"""
import argparse
import html
import os
import re
import sys
from pathlib import Path

PLACEHOLDER = '{{PLATFORM_CONTACT}}'
SETTING = 'KEHILOT_PLATFORM_CONTACT'
PAGES = ('privacy/index.html', 'terms/index.html')
VALID = re.compile(r'^[^@\s<>"\']+@[^@\s<>"\']+\.[^@\s<>"\']+$')
ROOT = Path(__file__).resolve().parents[1]


class ContactError(Exception):
    """A message that names the setting, never its value."""


def _check(contact):
    if not VALID.match(contact or ''):
        raise ContactError(f'{SETTING} (or PLATFORM_CONTACT in site.env) is not a valid email address')
    return contact


def read_contact(env, environ, root):
    value = environ.get(SETTING)
    if value is None or value == '':
        site = Path(root) / 'infra' / 'envs' / env / 'site.env'
        if site.is_file():
            for line in site.read_text().splitlines():
                # Plain KEY=value only: quoted values and `export KEY=...` lines are not understood and are rejected.
                if line.startswith('PLATFORM_CONTACT='):
                    value = line.split('=', 1)[1].strip()
        if not value:
            raise ContactError(f'{SETTING} is not set (and infra/envs/{env}/site.env has no PLATFORM_CONTACT)')
    return _check(value)


def fill(text, contact, page='page'):
    _check(contact)
    if PLACEHOLDER not in text:
        raise ContactError(f'{page} has no {PLACEHOLDER} placeholder')
    out = text.replace(PLACEHOLDER, html.escape(contact))
    if PLACEHOLDER in out:
        raise ContactError(f'{PLACEHOLDER} remains in {page} after replacing')
    return out


def main(argv=None, environ=None, root=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--env', required=True)
    ap.add_argument('--dist', required=True)
    args = ap.parse_args(argv)
    environ = os.environ if environ is None else environ
    root = ROOT if root is None else Path(root)
    try:
        contact = read_contact(args.env, environ, root)
        dist = Path(args.dist)
        if not dist.is_absolute() and not dist.exists():
            dist = root / dist
        files = []
        for page in PAGES:
            path = dist / page
            if not path.is_file():
                raise ContactError(f'missing {page} in {args.dist}')
            files.append((path, fill(path.read_text(encoding='utf-8'), contact, page)))
        for path, text in files:
            path.write_text(text, encoding='utf-8')
    except ContactError as e:
        print(f'fill_contact: {e}', file=sys.stderr)
        return 1
    print(f'fill_contact: filled {len(files)} pages')
    return 0


if __name__ == '__main__':
    sys.exit(main())
