"""Write the app's .env.<env> from `terraform output -json`. Usage: python3 tools/write_app_env.py --env dev

The file is gitignored. EXPO_PUBLIC_REPORTS=1 (the bug-report button) and EXPO_PUBLIC_SEATS_PREVIEW=1 (the seat-release preview, UX-DESIGN §15) are written for dev only. EXPO_PUBLIC_FEDERATION stays empty until Google/Apple sign-in is configured.
"""
import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEYS = [  # (env var, terraform output)
    ('EXPO_PUBLIC_API_URL', 'api_url'),
    ('EXPO_PUBLIC_REGION', 'region'),
    ('EXPO_PUBLIC_COGNITO_POOL_ID', 'user_pool_id'),
    ('EXPO_PUBLIC_COGNITO_CLIENT_ID', 'app_client_id'),
    ('EXPO_PUBLIC_COGNITO_DOMAIN', 'cognito_domain'),
    ('EXPO_PUBLIC_WEB_URL', 'web_url'),
]


def render(outputs, reports=True):
    lines = []
    for var, name in KEYS:
        value = (outputs.get(name) or {}).get('value')
        if not value:
            raise SystemExit(f'terraform output {name} is missing: apply the infra first')
        lines.append(f'{var}={str(value).rstrip("/")}')
    lines.append('EXPO_PUBLIC_FEDERATION=')
    if reports:  # the floating bug-report button is on in dev builds only
        lines.append('EXPO_PUBLIC_REPORTS=1')
        lines.append('EXPO_PUBLIC_SEATS_PREVIEW=1')  # the clickable seat preview on fixture data, dev builds only
    return '\n'.join(lines) + '\n'


def write(env, outputs, directory=ROOT):
    if env not in ('dev', 'prod'):
        raise SystemExit('--env must be dev or prod')
    path = Path(directory) / f'.env.{env}'
    path.write_text(render(outputs, reports=env == 'dev'))
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env', required=True, choices=['dev', 'prod'])
    args = parser.parse_args()
    raw = subprocess.run(['terraform', f'-chdir={ROOT}/infra/envs/{args.env}', 'output', '-json'],
                         check=True, capture_output=True, text=True).stdout
    print(write(args.env, json.loads(raw)))


if __name__ == '__main__':
    main()
