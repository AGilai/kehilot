"""Import validated roster-linked prayer requests into an existing local DB.

Input is a JSON list of {rosterPersonId, submitter, name, addedOn}; addedOn is
ISO YYYY-MM-DD. Match names explicitly before preparing this file. Default is
dry-run; --apply creates a private SQLite backup and imports atomically.
An explicitly authorized missing person may use rosterPersonId:null plus
unmatchedSubmitter:true; their name is retained without creating a roster row.
"""
import argparse
from datetime import datetime
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.healing_import import import_requests
from server.store import Store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if not args.database.is_file():
        parser.error('The database must already exist.')
    entries = json.loads(args.input.read_text())
    backup = None
    if args.apply:
        backup = args.database.with_name(args.database.stem + '-before-healing-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite3')
        backup.touch(mode=0o600, exist_ok=False)
        with sqlite3.connect(args.database) as source, sqlite3.connect(backup) as destination:
            source.backup(destination)
    # Preview against a disposable copy, including any required schema upgrade.
    # A dry run never initializes/mutates the source database.
    with tempfile.TemporaryDirectory(prefix='shul-healing-import-') as directory:
        database = args.database
        if not args.apply:
            database = Path(directory) / 'preview.sqlite3'
            with sqlite3.connect(args.database) as source, sqlite3.connect(database) as destination:
                source.backup(destination)
        store = Store(database)
        with store.db() as db:
            db.execute('BEGIN IMMEDIATE')
            rows = import_requests(db, entries, apply=args.apply)
    print(json.dumps(dict(applied=args.apply, new=sum(row['status']=='new' for row in rows),
                          existing=sum(row['status']=='existing' for row in rows),
                          backup=str(backup) if backup else None), ensure_ascii=False))


if __name__ == '__main__':
    main()
