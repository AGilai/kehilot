"""Create and verify a portable source archive; never uploads or changes the source."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parent.parent
EXCLUDED_DIRS = {'.git', '.expo', 'node_modules', '__pycache__', 'dist', 'web-build', 'ios', 'android', '.aws', '.codex'}
EXCLUDED_FILES = {'.DS_Store', '.npmrc', 'google-services.json', 'TRANSFER-MANIFEST.json'}
EXCLUDED_SUFFIXES = {'.pyc', '.tsbuildinfo', '.keystore', '.jks', '.p12', '.mobileprovision', '.zip'}


def source_files(output):
    for path in sorted(ROOT.rglob('*')):
        relative = path.relative_to(ROOT)
        if any(part in EXCLUDED_DIRS for part in relative.parts):
            continue
        if relative.parts[:2] == ('server', 'data'):
            continue
        if path.name in EXCLUDED_FILES or path.name.startswith('._'):
            continue
        if path.name.startswith('.env') and path.name != '.env.example':
            continue
        if path.suffix in EXCLUDED_SUFFIXES or path.name.endswith('.zip.sha256'):
            continue
        if path.resolve() == output:
            continue
        if path.is_symlink():
            raise RuntimeError(f'Review symlink before exporting: {relative}')
        if path.is_file():
            yield path, relative.as_posix()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    if output.exists() or output.with_suffix(output.suffix + '.sha256').exists():
        parser.error('Output already exists; choose a new archive name.')
    output.parent.mkdir(parents=True, exist_ok=True)
    files = list(source_files(output))
    required = {'AGENTS.md', 'HANDOFF.md', 'README.md', 'package.json', '.env.example', 'App.tsx', 'server/app.py', 'tests/family.test.ts'}
    missing = required - {name for _, name in files}
    if missing:
        parser.error('Missing source files: ' + ', '.join(sorted(missing)))
    manifest = dict(format=1, project='Shul-Regular', createdAt=datetime.now(timezone.utc).isoformat(), files=[])
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path, relative in files:
            data = path.read_bytes()
            archive.writestr('Shul-Regular/' + relative, data)
            manifest['files'].append(dict(path=relative, size=len(data), sha256=hashlib.sha256(data).hexdigest()))
        archive.writestr('Shul-Regular/TRANSFER-MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('ZIP integrity check failed')
        for entry in manifest['files']:
            data = archive.read('Shul-Regular/' + entry['path'])
            if len(data) != entry['size'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
                raise RuntimeError('Manifest verification failed: ' + entry['path'])
        expected = {'Shul-Regular/' + entry['path'] for entry in manifest['files']} | {'Shul-Regular/TRANSFER-MANIFEST.json'}
        if set(archive.namelist()) != expected:
            raise RuntimeError('Unexpected archive entries')
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    checksum = output.with_suffix(output.suffix + '.sha256')
    checksum.write_text(f'{digest}  {output.name}\n', encoding='utf-8')
    print(json.dumps(dict(archive=str(output), checksum=str(checksum), sourceFiles=len(files), bytes=output.stat().st_size, sha256=digest), indent=2))


if __name__ == '__main__':
    main()
