"""Load the first Kehila's hall SHAPE (src/seats/hall.ts HALL_GRID: rows, blocks, bimah; no names) as a dev layout.

Usage: .venv/bin/python tools/seed_dev_layout.py --env dev --kehila <id> [--from YYYY-MM-DD (a Friday)] [--apply]
Dry run without --apply. Goes through the server's own validation and seat-id assignment; refuses to overwrite an
existing layout for that Friday. Dev only.
"""
import argparse
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
from kehila_admin import open_repo  # noqa: E402
from server.cloud import seating_rules as rules  # noqa: E402

BLOCKS_LEFT_TO_RIGHT = ['צד שמאל', 'שמאל', 'מרכז שמאל', 'מרכז', 'מרכז ימין', 'ימין']  # hall.ts BLOCK_NAMES reversed
KIND = {'S': 'seat', 'B': 'bimah', '.': 'empty'}


def hall_grid():
    text = (ROOT / 'src/seats/hall.ts').read_text()
    grid = re.search(r'HALL_GRID = `(.*?)`', text, re.S).group(1)
    return [line.strip() for line in grid.strip().split('\n')]


def build_layout():
    lines = hall_grid()
    cols = max(len(l) for l in lines)
    lines = [l.ljust(cols, '.') for l in lines]
    used = [any(l[c] in 'SB' for l in lines) for c in range(cols)]
    spans = []
    for c in range(cols):
        if used[c]:
            if c and used[c - 1]:
                spans[-1][1] = c
            else:
                spans.append([c, c])
    if len(spans) != len(BLOCKS_LEFT_TO_RIGHT):
        sys.exit(f'expected {len(BLOCKS_LEFT_TO_RIGHT)} blocks, found {len(spans)}')
    # The layout is stored as the sheet reads (left to right); the app mirrors it for RTL.
    blocks = [{'name': n, 'colStart': a, 'colEnd': b} for n, (a, b) in zip(BLOCKS_LEFT_TO_RIGHT, spans)]
    cells = [[KIND[ch] for ch in l] for l in lines]
    labels = ['קדמית'] + [str(i) for i in range(1, len(lines))]
    return {'rows': len(lines), 'cols': cols, 'cells': cells, 'blocks': blocks, 'rowLabels': labels}


def last_friday(today):
    return today - timedelta(days=(today.weekday() - 4) % 7)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--env', choices=['dev'], required=True)
    p.add_argument('--kehila', required=True)
    p.add_argument('--from', dest='friday')
    p.add_argument('--apply', action='store_true')
    a = p.parse_args()
    today = date.today()
    friday = rules.effective_from(a.friday or last_friday(today).isoformat(), today)
    layout = rules.validate_layout({**build_layout(), 'ifUpdatedAt': None})
    seats = rules.assign_seats(layout['cells'])
    print(f'{len(seats)} seats, {len(layout["blocks"])} blocks, {layout["rows"]}x{layout["cols"]}, effective {friday}')
    repo = open_repo(a.env)
    if not repo.get_kehila(a.kehila):
        sys.exit('no such Kehila')
    if repo.get_layout(a.kehila, friday):
        sys.exit(f'a layout for {friday} already exists; not overwriting')
    if not a.apply:
        print('dry run (nothing written)')
        return
    repo.put_layout(a.kehila, friday, layout, seats, None)
    print('written')


if __name__ == '__main__':
    main()
