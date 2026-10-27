import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyCell, parseHall } from '../src/seats/paste.ts';
import type { ParsedHall } from '../src/seats/paste.ts';

// The hall's SHAPE from the spec ("The real workbook"); names are invented here, never taken from a real sheet.
const SHAPE = [
  '....SS..................SSS..',
  'SS.SSSSS................SSSSS',
  'SS.SSSSS................SSSSS',
  'SS.SSSSS................SSSSS',
  'SS.SSSSS.SSSS.SSSS.SSSS.SSSSS',
  'SS.SSSSS.SSSS......SSSS.SSSSS',
  'SS.SSSSS.SSSS.BBBB.SSSS.SSSSS',
  'SS.SSSSS.SSSS.BBBB.SSSS.SSSSS',
  'SS.SSSSS.SSSS.BBBB.SSSS.SSSSS',
  'SS.SSSSS.SSSS......SSSS.SSSSS',
  'SS..SSS..SSSS.SSSS.SSSS.SSSSS',
  '.........SSSS.SSSS.SSSS.SSSSS',
  '.........SSSS.SSSS.SSSS.SSSSS',
  '........................SSSS.',
];

const BASES = ['בדיוני', 'דוגמה', 'ניסיון', 'דמיוני', 'מדומה', 'פיקטיבי', 'אילוזורי', 'מומצא', 'חלומי', 'ספרותי', 'תיאורטי', 'נבדה', 'אקראי', 'הדגמי', 'מופשט', 'ערטילאי', 'לדוגמא', 'סימולטיבי', 'בדוי', 'מדומיין', 'נסיוני', 'מלאכותי', 'פיקטיבית', 'דמוי', 'מומצאי', 'בדיוניסט', 'אפשרי'];
const VARIANTS = ['', ' ש.', ' א.'];

function families(): { name: string; seats: number }[] {
  const list = Array.from({ length: 80 }, (_, i) => ({
    name: `${BASES[i % BASES.length]}${VARIANTS[Math.floor(i / BASES.length)]}`,
    seats: 1 + ((i * 5) % 6),
  }));
  let sum = list.reduce((a, f) => a + f.seats, 0);
  for (let i = 0; sum !== 198; i = (i + 1) % list.length) {
    const f = list[i]!;
    if (sum < 198 && f.seats < 6) { f.seats++; sum++; } else if (sum > 198 && f.seats > 1) { f.seats--; sum--; }
  }
  return list;
}

/** The sheet as a matrix of cell texts, rows 0-13 of the hall. */
function sheet(): string[][] {
  const positions: [number, number][] = [];
  SHAPE.forEach((line, r) => [...line].forEach((ch, c) => { if (ch === 'S') positions.push([r, c]); }));
  const tokens: string[] = [];
  for (const f of families()) for (let n = 1; n <= f.seats; n++) tokens.push(`${f.name}-${n}`);
  for (let i = 0; i < 27; i++) tokens.push('פנוי');
  assert.equal(tokens.length, positions.length);
  const grid = SHAPE.map((line) => [...line].map(() => ''));
  positions.forEach(([r, c], i) => { grid[r]![c] = tokens[(i * 7) % tokens.length]!; }); // 7 is coprime to 225
  grid[6]![14] = 'בימה';
  return grid;
}

const tsv = (rows: string[][]) => rows.map((r) => r.join('\t')).join('\n');
/** The sheet as copied: a label column (1-13, row 0 unlabelled) and an empty column before the grid. */
function withLabels(rows: string[][], side: 'left' | 'right' = 'left'): string[][] {
  return rows.map((r, i) => (side === 'left' ? [i === 0 ? '' : String(i), '', ...r] : [...r, '', i === 0 ? '' : String(i)]));
}

function seatsOf(h: ParsedHall) { return h.grid.flat().filter((c) => c.kind === 'seat' || c.kind === 'unassigned').length; }
const codes = (h: ParsedHall) => h.warnings.map((w) => w.code);

test('the full hall pasted as TSV: 225 seats, 6 blocks, bimah anchor, labels 1-13 and an unlabelled row 0', () => {
  const h = parseHall(`\n\n${tsv(withLabels(sheet()))}\n\n`);
  assert.equal(h.rows, 14);
  assert.equal(h.cols, 29);
  assert.equal(h.counts.seats, 225);
  assert.equal(seatsOf(h), 225);
  assert.equal(h.counts.unassigned, 27);
  assert.equal(h.counts.assigned, 198);
  assert.equal(h.counts.families, 80);
  assert.equal(h.counts.blocks, 6);
  assert.deepEqual(h.blocks.map((b) => [b.colStart, b.colEnd]), [[0, 1], [3, 7], [9, 12], [14, 17], [19, 22], [24, 28]]);
  assert.equal(h.blocks.reduce((a, b) => a + b.seats, 0), 225);
  assert.equal(h.blocks[0]!.seats, 20); // the far-left 2-column block the old mock-up missed
  assert.deepEqual(h.bimahAreas, [{ row: 6, col: 14, rows: 1, cols: 1, sized: false }]);
  assert.deepEqual(h.rowLabels, [null, ...Array.from({ length: 13 }, (_, i) => String(i + 1))]);
  assert.equal(h.labelColumn, 'left');
  assert.ok(codes(h).includes('bimah-unsized'));
  // no cell is unreadable
  assert.equal(h.grid.flat().filter((c) => c.kind === 'unknown').length, 0);
  // seats sit exactly where the shape says
  SHAPE.forEach((line, r) => [...line].forEach((ch, c) => {
    const kind = h.grid[r]![c]!.kind;
    if (ch === 'S') assert.ok(kind === 'seat' || kind === 'unassigned', `${r},${c}`);
    else if (ch === 'B' && r === 6 && c === 14) assert.equal(kind, 'bimah');
    else if (ch === '.') assert.equal(kind, 'empty');
  }));
});

test('a label column at the right edge is detected too, and the grid is the same', () => {
  const left = parseHall(tsv(withLabels(sheet(), 'left')));
  const right = parseHall(tsv(withLabels(sheet(), 'right')));
  assert.equal(right.labelColumn, 'right');
  assert.deepEqual(right.rowLabels, left.rowLabels);
  assert.deepEqual(right.grid, left.grid);
});

test('without a label column nothing is dropped and labels are all null', () => {
  const h = parseHall(tsv(sheet()));
  assert.equal(h.labelColumn, null);
  assert.equal(h.counts.seats, 225);
  assert.ok(h.rowLabels.every((l) => l === null));
});

test('merged bimah from the HTML flavour: one 4x3 area anchored at its top-left, all its cells bimah', () => {
  const rows = sheet();
  const html = '<table>' + rows.map((r, ri) => '<tr>' + r.map((t, ci) => {
    if (ri >= 6 && ri <= 8 && ci >= 14 && ci <= 17) return ri === 6 && ci === 14 ? `<td rowspan="3" colspan="4">${t}</td>` : '';
    return `<td>${t.replace(/&/g, '&amp;')}</td>`;
  }).join('') + '</tr>').join('') + '</table>';
  const h = parseHall({ html, text: 'ignored when a table is present' });
  assert.deepEqual(h.bimahAreas, [{ row: 6, col: 14, rows: 3, cols: 4, sized: true }]);
  for (let r = 6; r <= 8; r++) for (let c = 14; c <= 17; c++) assert.equal(h.grid[r]![c]!.kind, 'bimah');
  assert.equal(h.counts.seats, 225);
  assert.equal(h.counts.blocks, 6);
  assert.ok(!codes(h).includes('bimah-unsized'));
});

test('HTML cells: entities, nbsp and <br> are handled', () => {
  const h = parseHall({ html: '<table><tr><td>בדיוני&nbsp;ש.-1</td><td>פנוי</td></tr><tr><td>דוגמה-1<br>ניסיון-1</td><td></td></tr></table>' });
  assert.equal(h.grid[0]![0]!.kind, 'seat');
  assert.equal(h.grid[1]![0]!.kind, 'unknown');
  assert.deepEqual(codes(h), ['two-names']);
});

test('a TSV bimah that is several adjacent "בימה" cells becomes one sized area', () => {
  const h = parseHall('בדיוני-1\t\tבימה\tבימה\nדוגמה-1\t\tבימה\tבימה');
  assert.deepEqual(h.bimahAreas, [{ row: 0, col: 2, rows: 2, cols: 2, sized: true }]);
});

test('cell grammar: initials with and without the dot, extra spaces, hyphen variants', () => {
  const seat = (t: string) => {
    const c = classifyCell(t);
    assert.equal(c.kind, 'seat', t);
    return c.kind === 'seat' ? c : (undefined as never);
  };
  for (const t of ['בדיוני ש.-2', 'בדיוני ש-2', '  בדיוני   ש.  -  2  ', 'בדיוני ש.–2', 'בדיוני ש.־2', 'בדיוני ש.—2', 'בדיוני ש .-2', '‏בדיוני ש.-2‏']) {
    const c = seat(t);
    assert.equal(c.familyKey, 'בדיוני ש', t);
    assert.equal(c.displayName, 'בדיוני ש.');
    assert.equal(c.initial, 'ש');
    assert.equal(c.order, 2);
  }
  const plain = seat('דוגמה-1');
  assert.equal(plain.familyKey, 'דוגמה');
  assert.equal(plain.initial, undefined);
  assert.notEqual(seat('דוגמה א.-1').familyKey, plain.familyKey); // family + initial are two keys
  // a family name with its own maqaf keeps it; the last dash separates the order
  assert.equal(seat('בן-דוגמה ש.-3').familyKey, 'בן-דוגמה ש');
  assert.equal(seat('בן־דוגמה-3').familyKey, 'בן-דוגמה');
  // the other orders the sheet shows
  assert.equal(seat('דוגמה ש2-.').familyKey, 'דוגמה ש');
  assert.equal(seat('בדיוני1-').order, 1);
  assert.equal(seat('2-בדיוני ש.').order, 2);
  assert.deepEqual(classifyCell('  פנוי '), { kind: 'unassigned' });
  assert.deepEqual(classifyCell(' בימה'), { kind: 'bimah' });
  assert.deepEqual(classifyCell('    '), { kind: 'empty' });
});

test('things that are not seats are ignored and listed with their positions', () => {
  const h = parseHall('ערב שבת\t\t\nבדיוני-1\tפנוי\t\nסה"כ\t2026-10-27\t12\n');
  assert.equal(h.counts.seats, 2);
  const ignored = h.warnings.filter((w) => w.code === 'ignored-cell');
  assert.deepEqual(ignored.map((w) => [w.row, w.col, w.raw]), [[0, 0, 'ערב שבת'], [2, 0, 'סה"כ'], [2, 1, '2026-10-27'], [2, 2, '12']]);
});

test('two names in one cell: kept as unknown with both parts, warned', () => {
  const h = parseHall('דוגמה ש.-1 / ניסיון-2\tפנוי / בדיוני-1\tדוגמה-1\n');
  const a = h.grid[0]![0]!;
  assert.equal(a.kind, 'unknown');
  if (a.kind !== 'unknown') return;
  assert.equal(a.reason, 'two-names');
  assert.equal(a.parts?.length, 2);
  assert.equal(a.parts?.[0]?.kind === 'seat' && a.parts[0].familyKey, 'דוגמה ש');
  assert.equal(a.parts?.[1]?.kind === 'seat' && a.parts[1].order, 2);
  const b = h.grid[0]![1]!;
  assert.equal(b.kind === 'unknown' && b.parts?.[0]?.kind, 'unassigned');
  assert.deepEqual(h.warnings.filter((w) => w.code === 'two-names').map((w) => [w.row, w.col]), [[0, 0], [0, 1]]);
  assert.equal(h.counts.seats, 1); // an unresolved cell is not counted as a seat
});

test('a quoted multi-line TSV cell (two names on two lines) is one cell', () => {
  const h = parseHall('"דוגמה-1\nניסיון-1"\tבדיוני-1\n');
  assert.equal(h.cols, 2);
  assert.equal(h.grid[0]![0]!.kind, 'unknown');
  assert.equal(h.counts.seats, 1);
});

test('leading and trailing blank rows and columns are trimmed; positions refer to the trimmed grid', () => {
  const h = parseHall('\t\t\t\n\t\t\t\n\t\tבדיוני-1\tפנוי\t\t\n\t\tדוגמה-1\t\t\t\n\t\t\t\t\t\n');
  assert.equal(h.rows, 2);
  assert.equal(h.cols, 2);
  assert.equal(h.grid[0]![0]!.kind, 'seat');
  assert.equal(h.grid[1]![1]!.kind, 'empty');
});

test('blocks are column runs split by empty columns, even when a block has gaps inside a row', () => {
  const h = parseHall('א1-\tב1-\t\tג1-\t\t\tד1-\tפנוי\n\tב2-\t\t\t\t\t\t\n');
  assert.deepEqual(h.blocks.map((b) => [b.colStart, b.colEnd]), [[0, 1], [3, 3], [6, 7]]);
});

test('a family whose seats span two blocks is reported once, with both blocks', () => {
  const h = parseHall('בדיוני-1\tבדיוני-2\t\tבדיוני-3\nדוגמה-1\t\t\t\n');
  const f = h.families.find((x) => x.familyKey === 'בדיוני')!;
  assert.deepEqual(f.blocks, [0, 1]);
  assert.equal(f.seats.length, 3);
  assert.deepEqual(h.warnings.filter((w) => w.code === 'spans-blocks').map((w) => w.familyKey), ['בדיוני']);
});

test('duplicate order numbers for one family warn at the repeated cell; gaps warn too', () => {
  const h = parseHall('בדיוני-1\tבדיוני-1\tדוגמה-1\tדוגמה-3\n');
  const dup = h.warnings.filter((w) => w.code === 'duplicate-order');
  assert.deepEqual(dup.map((w) => [w.row, w.col, w.familyKey]), [[0, 1, 'בדיוני']]);
  const gap = h.warnings.filter((w) => w.code === 'order-gap');
  assert.deepEqual(gap.map((w) => w.familyKey), ['דוגמה']);
  assert.equal(h.counts.seats, 4); // never a stop
});

test('Excel tab-trailing rows and CRLF line ends parse the same as LF', () => {
  const lf = parseHall('בדיוני-1\tפנוי\t\nדוגמה ש.-1\t\t\n');
  const crlf = parseHall('בדיוני-1\tפנוי\t\r\nדוגמה ש.-1\t\t\r\n\r\n');
  assert.deepEqual(crlf.grid, lf.grid);
});

test('nothing seat-like: a no-seats warning and an empty hall, not an exception', () => {
  const h = parseHall('Form Responses\tTimestamp\nבדיוני\t10/27/2026\n');
  assert.equal(h.counts.seats, 0);
  assert.ok(codes(h).includes('no-seats'));
  const empty = parseHall('');
  assert.equal(empty.rows, 0);
  assert.equal(empty.counts.blocks, 0);
  assert.ok(codes(empty).includes('no-seats'));
});

test('a plain number grid is not mistaken for row labels when fewer than 3 numbers', () => {
  const h = parseHall('1\tבדיוני-1\n2\tדוגמה-1\n');
  assert.equal(h.labelColumn, null);
  assert.equal(h.grid[0]![0]!.kind, 'unknown');
});

test('too large: beyond 60 columns x 40 rows, or a crafted span table, returns a too-large warning and no grid, fast', () => {
  const wide = parseHall(Array.from({ length: 3 }, () => Array.from({ length: 61 }, (_, i) => `בדיוני-${i + 1}`).join('\t')).join('\n'));
  assert.deepEqual(codes(wide), ['too-large']);
  assert.equal(wide.grid.length, 0);
  const tall = parseHall(Array.from({ length: 41 }, () => 'בדיוני-1').join('\n'));
  assert.deepEqual(codes(tall), ['too-large']);
  assert.equal(parseHall(Array.from({ length: 40 }, () => Array.from({ length: 60 }, () => 'פנוי').join('\t')).join('\n')).counts.seats, 2400);
  const html = '<table><tr><td rowspan="300" colspan="300">בימה</td><td rowspan="9999" colspan="9999">x</td></tr></table>';
  const t0 = performance.now();
  const crafted = parseHall({ html });
  assert.ok(performance.now() - t0 < 200);
  assert.deepEqual(codes(crafted), ['too-large']);
  assert.equal(crafted.grid.length, 0);
});

test('HTML script/style/comment content is never promoted to a cell', () => {
  const html = '<style>td{color:red} בדיוני-9</style><script>var x="דוגמה-9"</script><!-- ניסיון-9 --><table><tr><td>בדיוני-1</td><td><script>alert("דוגמה-8")</script>פנוי</td></tr></table>';
  const h = parseHall({ html });
  assert.equal(h.counts.seats, 2);
  assert.equal(h.counts.assigned, 1);
  assert.deepEqual(codes(h), []);
  assert.deepEqual(h.families.map((f) => f.familyKey), ['בדיוני']);
});

test('bimah-multiple: two separate bimah areas warn at the second', () => {
  const h = parseHall('בימה\t\tבדיוני-1\nבימה\t\t\n\t\t\nפנוי\t\tבימה\n');
  assert.equal(h.bimahAreas.length, 2);
  const w = h.warnings.filter((x) => x.code === 'bimah-multiple');
  assert.deepEqual(w.map((x) => [x.row, x.col]), [[3, 2]]);
});

test('label-ignored: a stray non-numeric cell in the label column is dropped and listed with col -1', () => {
  const rows = ['1\t\tבדיוני-1', '2\t\tדוגמה-1', 'סה"כ\t\t', '3\t\tפנוי', '4\t\tניסיון-1'];
  const h = parseHall(rows.join('\n'));
  assert.equal(h.labelColumn, 'left');
  assert.deepEqual(h.rowLabels, ['1', '2', null, '3', '4']);
  assert.deepEqual(h.warnings.filter((w) => w.code === 'label-ignored').map((w) => [w.row, w.col, w.raw]), [[2, -1, 'סה"כ']]);
  assert.equal(h.counts.seats, 4);
});
