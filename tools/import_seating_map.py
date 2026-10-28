"""Import a private Excel Map with explicit confirmed roster assignments."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.seating_map import read_layout, import_layout
from server.store import Store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--workbook', type=Path, required=True)
    parser.add_argument('--mapping', type=Path, required=True, help='Private JSON: owners, optional cellOverrides/classificationChanges')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not args.database.is_file(): parser.error('An existing database is required.')
    config = json.loads(args.mapping.read_text())
    layout = read_layout(args.workbook, overrides=config.get('cellOverrides'))
    backup = None
    if args.apply:
        backup = args.database.with_name(args.database.stem + '-before-map-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite3')
        backup.touch(mode=0o600, exist_ok=False)
        with sqlite3.connect(args.database) as source, sqlite3.connect(backup) as destination: source.backup(destination)
    with tempfile.TemporaryDirectory(prefix='shul-seat-map-') as directory:
        path = args.database
        if not args.apply:
            path = Path(directory) / 'preview.sqlite3'
            with sqlite3.connect(args.database) as source, sqlite3.connect(path) as destination: source.backup(destination)
        store = Store(path)
        with store.db() as db:
            db.execute('BEGIN IMMEDIATE')
            result = import_layout(db, layout, config['owners'], config.get('classificationChanges', []), apply=args.apply)
    print(json.dumps(dict(applied=args.apply, backup=str(backup) if backup else None, **result)))


if __name__ == '__main__': main()
