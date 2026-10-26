"""Build the API Lambda zip: server/cloud and the domain modules it needs, plus vendored pyluach.

Deterministic: sorted entries and fixed timestamps, so the same source gives the same bytes and
Terraform only redeploys when code changes. Usage: python3 tools/build_lambda.py [out.zip]
"""
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / 'dist' / 'lambda' / 'api.zip'
SERVER_FILES = ['server/__init__.py', 'server/validation.py', 'server/hebrew_calendar.py']
VENDORED = ['pyluach==2.3.0']
FIXED_TIME = (1980, 1, 1, 0, 0, 0)


def _add(archive, path, arcname):
    info = zipfile.ZipInfo(arcname, FIXED_TIME)
    info.external_attr = 0o644 << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, path.read_bytes())


def build(out=DEFAULT_OUT):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    files = {name: ROOT / name for name in SERVER_FILES}
    files.update({str(p.relative_to(ROOT)): p for p in (ROOT / 'server' / 'cloud').rglob('*.py')})
    with tempfile.TemporaryDirectory() as vendor:
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '--no-deps', '--no-compile',
                        '--target', vendor, *VENDORED], check=True)
        for path in Path(vendor).rglob('*'):
            rel = path.relative_to(vendor)
            if path.is_file() and '__pycache__' not in rel.parts and not rel.parts[0].endswith('.dist-info'):
                files[str(rel)] = path
        with zipfile.ZipFile(out, 'w') as archive:
            for name in sorted(files):
                _add(archive, files[name], name)
    return out


if __name__ == '__main__':
    print(build(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT))
