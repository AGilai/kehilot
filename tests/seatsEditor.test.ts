import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHall } from '../src/seats/paste.ts';
import { suggestMatches } from '../src/seats/match.ts';
import type { KehilaFamily } from '../src/seats/match.ts';
import {
  effectiveFamilies, exactDecisions, initialMatchState, isDecisionValid, matchReducer, remaining, twoNameCells,
} from '../src/seats/decisions.ts';
import type { Decision } from '../src/seats/decisions.ts';
import {
  assignmentsFor, blockIssues, buildLayout, defaultBlockNames, familiesForMatch, holdersToCreate, refsFor,
} from '../src/seats/savePlan.ts';
import { currentShabbatFriday, defaultEffectiveFrom, effectiveOptions } from '../src/seats/effectiveFrom.ts';
import { runSave } from '../src/seats/runSave.ts';
import type { SavePlan } from '../src/seats/runSave.ts';
import { seatEditorAllowed } from '../src/seats/access.ts';

// Invented names only. Columns: label | block 1 (2 cols) | gap | block 2 (2 cols). Row "" = unnumbered front row.
const TSV = [
  ['', 'בדיוני ש.-1', 'בדיוני ש.-2', '', 'דוגמה-1', 'פנוי'],
  ['1', 'ניסיון מ.-1', 'מדומה-1', '', 'בדמה / אלמוני', 'בימה'],
  ['2', 'ניסיון מ.-2', 'סה"כ 8', '', 'דוגמה-2', 'בימה'],
  ['3', 'בדיוני-1', 'בדיוני-2', '', 'פנוי', 'פנוי'],
].map((r) => r.join('\t')).join('\n').replace('בדמה / אלמוני', 'דמה-1 / אלמוני-1');

const hall = () => parseHall(TSV);

const FAMS: KehilaFamily[] = [
  { id: 'F1', lastName: 'בדיוני', firstName: 'שמעון', spouseFirstName: 'שרה' },
  { id: 'F2', lastName: 'ניסיון', firstName: 'משה' },
];

test('parse fixture sanity', () => {
  const p = hall();
  assert.equal(p.blocks.length, 2);
  assert.equal(twoNameCells(p).length, 1);
  assert.ok(p.families.some((f) => f.familyKey === 'בדיוני ש'));
});

test('reducer: decide, change (clear) and bulk-confirm never overwrite a decision', () => {
  const p = hall();
  const results = suggestMatches(p.families, FAMS);
  let s = initialMatchState();
  s = matchReducer(s, { type: 'decide', key: 'בדיוני ש', decision: { kind: 'skip' } });
  const bulk = exactDecisions(results, s);
  assert.ok(!('בדיוני ש' in bulk), 'already decided stays');
  assert.deepEqual(bulk['ניסיון מ'], { kind: 'family', id: 'F2' });
  s = matchReducer(s, { type: 'merge', decisions: bulk });
  assert.deepEqual(s.decisions['בדיוני ש'], { kind: 'skip' });
  assert.deepEqual(s.decisions['ניסיון מ'], { kind: 'family', id: 'F2' });
  s = matchReducer(s, { type: 'clear', key: 'ניסיון מ' });
  assert.equal(s.decisions['ניסיון מ'], undefined);
});

test('bulk confirm skips ambiguous and likely rows', () => {
  const p = hall();
  const fams: KehilaFamily[] = [...FAMS, { id: 'F3', lastName: 'ניסיון', firstName: 'מיכאל' }];
  const bulk = exactDecisions(suggestMatches(p.families, fams), initialMatchState());
  assert.equal(bulk['ניסיון מ'], undefined);
  assert.equal(bulk['דוגמה'], undefined);
});

test('remaining counts undecided families and undecided two-names cells; two-names choice adds its family', () => {
  const p = hall();
  let s = initialMatchState();
  const base = effectiveFamilies(p, s.cells).length;
  assert.equal(remaining(p, s), base + 1);
  const [cell] = twoNameCells(p);
  s = matchReducer(s, { type: 'cell', row: cell!.row, col: cell!.col, choice: 'a' });
  assert.equal(effectiveFamilies(p, s.cells).length, base + 1, 'the chosen part joins the list');
  assert.equal(remaining(p, s), base + 1);
  s = matchReducer(s, { type: 'cell', row: cell!.row, col: cell!.col, choice: 'free' });
  assert.equal(effectiveFamilies(p, s.cells).length, base);
  assert.equal(remaining(p, s), base);
  for (const f of effectiveFamilies(p, s.cells)) s = matchReducer(s, { type: 'decide', key: f.familyKey, decision: { kind: 'skip' } });
  assert.equal(remaining(p, s), 0);
});

test('a new-holder decision needs a name and a valid phone when given', () => {
  const ok = (d: Decision) => isDecisionValid(d);
  assert.equal(ok({ kind: 'new', name: 'משפחת מדומה', phone: '' }), true);
  assert.equal(ok({ kind: 'new', name: 'משפחת מדומה', phone: '050-1234567' }), true);
  assert.equal(ok({ kind: 'new', name: '   ', phone: '' }), false);
  assert.equal(ok({ kind: 'new', name: 'x'.repeat(61), phone: '' }), false);
  assert.equal(ok({ kind: 'new', name: 'משפחת מדומה', phone: '12' }), false);
  assert.equal(ok({ kind: 'family', id: 'F1' }), true);
});

test('an invalid new-holder decision counts as undecided', () => {
  const p = hall();
  let s = initialMatchState();
  for (const f of effectiveFamilies(p, s.cells)) s = matchReducer(s, { type: 'decide', key: f.familyKey, decision: { kind: 'skip' } });
  const [cell] = twoNameCells(p);
  s = matchReducer(s, { type: 'cell', row: cell!.row, col: cell!.col, choice: 'free' });
  assert.equal(remaining(p, s), 0);
  s = matchReducer(s, { type: 'decide', key: 'דוגמה', decision: { kind: 'new', name: '', phone: '' } });
  assert.equal(remaining(p, s), 1);
});

test('default block names: right to left, defaults per ruling 1 (stored left to right)', () => {
  assert.deepEqual(defaultBlockNames(6), ['צד שמאל', 'שמאל', 'מרכז שמאל', 'מרכז', 'מרכז ימין', 'ימין']);
  assert.deepEqual(defaultBlockNames(2), ['שמאל', 'ימין']);
  assert.deepEqual(defaultBlockNames(1), ['מרכז']);
  const many = defaultBlockNames(8);
  assert.equal(many.length, 8);
  assert.equal(many[7], 'ימין');
});

test('layout: kinds, ark row on top centred, front-row label, blocks, aisle columns', () => {
  const p = hall();
  let s = initialMatchState();
  const [cell] = twoNameCells(p);
  s = matchReducer(s, { type: 'cell', row: cell!.row, col: cell!.col, choice: 'a' });
  const L = buildLayout(p, ['שמאל', 'ימין'], s.cells)!;
  assert.equal(L.rowOffset, 1);
  assert.equal(L.layout.rows, p.rows + 1);
  assert.equal(L.layout.cols, p.cols);
  assert.ok(L.layout.cells[0]!.includes('ark'));
  assert.ok(L.layout.cells[0]!.every((k) => k === 'ark' || k === 'aisle'));
  assert.equal(L.layout.rowLabels[0], null);
  assert.equal(L.layout.rowLabels[1], 'קדמית');
  assert.equal(L.layout.rowLabels[2], '1');
  assert.ok(L.layout.cells.some((r) => r.includes('bimah')));
  assert.equal(L.layout.blocks.length, 2);
  assert.deepEqual(L.layout.blocks.map((b) => b.name), ['שמאל', 'ימין']);
  assert.ok(L.layout.blocks[0]!.colStart < L.layout.blocks[1]!.colStart);
  const gapCol = L.layout.blocks[0]!.colEnd + 1;
  assert.ok(L.layout.cells.slice(1).every((r) => r[gapCol] === 'aisle'));
  // the ignored title cell is empty, not a seat
  const ignored = p.warnings.find((w) => w.code === 'ignored-cell')!;
  assert.equal(L.layout.cells[ignored.row + 1]![ignored.col], 'empty');
});

test('layout is null (never built) while a two-names cell is undecided', () => {
  assert.equal(buildLayout(hall(), ['a', 'b'], {}), null);
});

test('block issues: empty, too long, more than 12 blocks', () => {
  assert.deepEqual(blockIssues(['שמאל', 'ימין']), []);
  assert.deepEqual(blockIssues(['שמאל', '  ']), [{ index: 1, code: 'empty' }]);
  assert.deepEqual(blockIssues(['x'.repeat(25)]), [{ index: 0, code: 'long' }]);
  assert.equal(blockIssues(Array.from({ length: 13 }, (_, i) => `ג${i}`)).some((i) => i.code === 'too-many'), true);
});

test('families for matching come from the gabbai families list (surname, first names of both adults)', () => {
  const out = familiesForMatch([
    { familyId: 'A', name: 'בדיוני', adults: [{ userId: 'u1', displayName: 'שמעון בדיוני' }, { userId: 'u2', displayName: 'שרה בדיוני' }], children: [] },
    { familyId: 'B', name: 'דוגמה', adults: [{ userId: 'u3', displayName: 'מיכל' }], children: [] },
  ], new Set(['B']));
  assert.deepEqual(out[0], { id: 'A', lastName: 'בדיוני', firstName: 'שמעון', spouseFirstName: 'שרה', holdsSeats: false });
  assert.deepEqual(out[1], { id: 'B', lastName: 'דוגמה', firstName: 'מיכל', spouseFirstName: undefined, holdsSeats: true });
});

test('holders to create: only new decisions of families that still have seats; phone normalised', () => {
  const p = hall();
  let s = initialMatchState();
  const [cell] = twoNameCells(p);
  s = matchReducer(s, { type: 'cell', row: cell!.row, col: cell!.col, choice: 'free' });
  s = matchReducer(s, { type: 'decide', key: 'דוגמה', decision: { kind: 'new', name: ' משפחת דוגמה ', phone: '050-1234567' } });
  s = matchReducer(s, { type: 'decide', key: 'מדומה', decision: { kind: 'new', name: 'משפחת מדומה', phone: '' } });
  s = matchReducer(s, { type: 'decide', key: 'אין כזה', decision: { kind: 'new', name: 'אף אחד', phone: '' } });
  assert.deepEqual(holdersToCreate(p, s), [
    { key: 'דוגמה', name: 'משפחת דוגמה', phone: '+972501234567' },
    { key: 'מדומה', name: 'משפחת מדומה' },
  ]);
});

test('assignments cover every seat: family/holder refs, null for free and skipped, two-names part by choice', () => {
  const p = hall();
  let s = initialMatchState();
  const [cell] = twoNameCells(p);
  s = matchReducer(s, { type: 'cell', row: cell!.row, col: cell!.col, choice: 'b' });
  const L = buildLayout(p, ['שמאל', 'ימין'], s.cells)!;
  for (const f of effectiveFamilies(p, s.cells)) s = matchReducer(s, { type: 'decide', key: f.familyKey, decision: { kind: 'skip' } });
  s = matchReducer(s, { type: 'decide', key: 'בדיוני ש', decision: { kind: 'family', id: 'F1' } });
  s = matchReducer(s, { type: 'decide', key: 'דוגמה', decision: { kind: 'new', name: 'משפחת דוגמה', phone: '' } });
  s = matchReducer(s, { type: 'decide', key: 'אלמוני', decision: { kind: 'holder', id: 'H9' } });
  const seats: { id: string; row: number; col: number }[] = [];
  L.layout.cells.forEach((r, row) => r.forEach((k, col) => { if (k === 'seat') seats.push({ id: `s${row}_${col}`, row, col }); }));
  const refs = refsFor(s, { 'דוגמה': 'HNEW' });
  const a = assignmentsFor(p, s.cells, L.rowOffset, seats, refs);
  assert.equal(Object.keys(a).length, seats.length);
  const at = (r: number, c: number) => a[`s${r + L.rowOffset}_${c}`];
  const [f1, f2] = p.families.find((f) => f.familyKey === 'בדיוני ש')!.seats;
  assert.equal(at(f1!.row, f1!.col), 'family:F1');
  assert.equal(at(f2!.row, f2!.col), 'family:F1');
  const dog = p.families.find((f) => f.familyKey === 'דוגמה')!.seats[0]!;
  assert.equal(at(dog.row, dog.col), 'holder:HNEW');
  const nis = p.families.find((f) => f.familyKey === 'ניסיון מ')!.seats[0]!;
  assert.equal(at(nis.row, nis.col), null, 'skipped');
  assert.equal(at(cell!.row, cell!.col), 'holder:H9', 'the chosen part of the two-names cell');
  const free = p.grid.flatMap((r, row) => r.map((c, col) => ({ c, row, col }))).find((x) => x.c.kind === 'unassigned')!;
  assert.equal(at(free.row, free.col), null);
});

test('effectiveFrom: first Shabbat not yet open (Thursday 12:00 Israel opens it)', () => {
  // 2026-10-27 is a Tuesday: Friday 2026-10-30 opens Thursday 2026-10-29 12:00.
  assert.equal(defaultEffectiveFrom(new Date('2026-10-27T10:00:00Z')), '2026-10-30');
  assert.equal(defaultEffectiveFrom(new Date('2026-10-29T09:00:00Z')), '2026-10-30'); // Thu 11:00 Israel, not yet open
  assert.equal(defaultEffectiveFrom(new Date('2026-10-29T10:30:00Z')), '2026-11-06'); // Thu 12:30 Israel: open
  assert.equal(defaultEffectiveFrom(new Date('2026-10-30T07:00:00Z')), '2026-11-06'); // Friday
  assert.equal(defaultEffectiveFrom(new Date('2026-10-31T10:00:00Z')), '2026-11-06'); // Saturday
  assert.equal(defaultEffectiveFrom(new Date('2026-11-01T10:00:00Z')), '2026-11-06'); // Sunday
});

test('effectiveFrom options start at the current Shabbat (Saturday still counts as its Friday) and are Fridays', () => {
  assert.equal(currentShabbatFriday('2026-10-31'), '2026-10-30');
  assert.equal(currentShabbatFriday('2026-10-30'), '2026-10-30');
  assert.equal(currentShabbatFriday('2026-10-27'), '2026-10-30');
  const o = effectiveOptions(new Date('2026-10-27T10:00:00Z'), 5);
  assert.deepEqual(o, ['2026-10-30', '2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']);
});

test('gabbai-only route gate', () => {
  assert.equal(seatEditorAllowed('gabbai'), true);
  assert.equal(seatEditorAllowed('member'), false);
  assert.equal(seatEditorAllowed('listener'), false);
  assert.equal(seatEditorAllowed(undefined), false);
});

// ---- the save sequence ----
type Call = string;
function fakeApi(opts: { failLayout?: 'layout_changed' | 'invalid_layout'; failAssign?: 'assignments_changed' | 'x'; failHolderAt?: number } = {}) {
  const calls: Call[] = [];
  let holders = 0;
  const err = (code: string, status = 409) => Object.assign(new Error(code), { code, status });
  return {
    calls,
    api: {
      async createHolder(b: { name: string; phone?: string }) {
        if (opts.failHolderAt === holders) { opts.failHolderAt = undefined; throw err('too_many_holders'); }
        calls.push(`holder:${b.name}`); holders++; return { holderId: `H${holders}` };
      },
      async putLayout(from: string, b: { ifUpdatedAt: number | null }) {
        calls.push(`layout:${from}:${b.ifUpdatedAt}`);
        if (opts.failLayout) { const c = opts.failLayout; opts.failLayout = undefined; throw err(c, c === 'layout_changed' ? 409 : 400); }
        return { seats: [{ id: 'a', row: 1, col: 0 }, { id: 'b', row: 1, col: 1 }], updatedAt: 7 };
      },
      async assignmentsGuard(from: string) { calls.push(`guard:${from}`); return 5; },
      async putAssignments(from: string, b: { assignments: Record<string, string | null>; ifUpdatedAt: number | null }) {
        calls.push(`assign:${from}:${b.ifUpdatedAt}:${JSON.stringify(b.assignments)}`);
        if (opts.failAssign) { const c = opts.failAssign; opts.failAssign = undefined; throw err(c, c === 'x' ? 500 : 409); }
        return { updatedAt: 9 };
      },
    },
  };
}
const plan = (): SavePlan => ({
  from: '2026-10-30',
  layoutGuard: null as number | null,
  holders: [{ key: 'k1', name: 'משפחת א' }, { key: 'k2', name: 'משפחת ב', phone: '+972501234567' }],
  layout: { rows: 2, cols: 2, cells: [['ark', 'ark'], ['seat', 'seat']], blocks: [{ name: 'ימין', colStart: 0, colEnd: 1 }], rowLabels: [null, 'קדמית'] },
  assign: (_seats: { id: string; row: number; col: number }[], created: Record<string, string>) => ({ a: `holder:${created['k1']}`, b: null }),
});

test('runSave: holders, then layout, then assignments (in that order) with progress', async () => {
  const f = fakeApi();
  const seen: string[] = [];
  const r = await runSave(plan(), f.api, {}, (p) => seen.push(`${p.step}:${p.done}/${p.total}`));
  assert.equal(r.ok, true);
  assert.deepEqual(f.calls.map((c) => c.split(':')[0]), ['holder', 'holder', 'layout', 'guard', 'assign']);
  assert.ok(f.calls[2]!.endsWith(':null'));
  assert.ok(f.calls[4]!.includes('"a":"holder:H1"'));
  assert.ok(f.calls[4]!.startsWith('assign:2026-10-30:5:'));
  assert.deepEqual(seen.filter((x) => x.startsWith('holders')), ['holders:0/2', 'holders:1/2', 'holders:2/2']);
  assert.equal(seen.at(-1), 'done:1/1');
});

test('runSave: a layout 409 stops with a conflict; nothing after it runs; holders are kept for the retry', async () => {
  const f = fakeApi({ failLayout: 'layout_changed' });
  const r = await runSave(plan(), f.api, {}, () => {});
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.stage, 'layout');
  assert.equal(r.conflict, true);
  assert.deepEqual(r.carry.created, { k1: 'H1', k2: 'H2' });
  assert.equal(f.calls.some((c) => c.startsWith('assign')), false);
  const again = await runSave({ ...plan(), layoutGuard: 11 }, f.api, r.carry, () => {});
  assert.equal(again.ok, true);
  assert.equal(f.calls.filter((c) => c.startsWith('holder:')).length, 2, 'holders are not created twice');
  assert.ok(f.calls.some((c) => c === 'layout:2026-10-30:11'));
});

test('runSave: an assignments failure keeps the saved layout; the retry only redoes the assignments', async () => {
  const f = fakeApi({ failAssign: 'assignments_changed' });
  const r = await runSave(plan(), f.api, {}, () => {});
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.stage, 'assignments');
  assert.equal(r.conflict, true);
  assert.ok(r.carry.layout);
  const again = await runSave(plan(), f.api, r.carry, () => {});
  assert.equal(again.ok, true);
  assert.equal(f.calls.filter((c) => c.startsWith('layout')).length, 1);
  assert.equal(f.calls.filter((c) => c.startsWith('assign')).length, 2);
});

test('runSave: a holder failure stops before the layout and reports the code and stage', async () => {
  const f = fakeApi({ failHolderAt: 1 });
  const r = await runSave(plan(), f.api, {}, () => {});
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.stage, 'holders');
  assert.equal(r.code, 'too_many_holders');
  assert.deepEqual(r.carry.created, { k1: 'H1' });
  assert.equal(f.calls.some((c) => c.startsWith('layout')), false);
});

test('runSave: a non-409 layout error is not a conflict', async () => {
  const f = fakeApi({ failLayout: 'invalid_layout' });
  const r = await runSave(plan(), f.api, {}, () => {});
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.conflict, false);
  assert.equal(r.code, 'invalid_layout');
});

import { readPaste } from '../src/seats/readPaste.ts';
test('readPaste: a hall, nothing, the Form responses tab, some other table', () => {
  assert.equal(readPaste(TSV).problem, null);
  assert.equal(readPaste('  \n ').problem, 'empty');
  assert.equal(readPaste('חותמת זמן\tשם\tערב שבת\n27/10/2026\tבדיוני\t1').problem, 'responses-tab');
  const other = readPaste('שם\tגיל\nדוגמה\t5');
  assert.equal(other.problem, 'no-seats');
  assert.equal(other.rows, 2);
  assert.equal(other.cols, 2);
  assert.equal(readPaste('x'.repeat(2_100_000)).problem, 'too-large');
});

import { readFileSync, readdirSync } from 'node:fs';
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const flatten = (o: unknown, prefix = ''): Record<string, string> =>
  Object.entries(o as Record<string, unknown>).reduce((acc, [k, v]) => (typeof v === 'string' ? { ...acc, [prefix + k]: v } : { ...acc, ...flatten(v, `${prefix}${k}.`) }), {} as Record<string, string>);

test('every static seatEditor.* key used by the editor exists in he and en, and the dynamic families are complete', () => {
  const he = flatten(JSON.parse(read('src/i18n/he.json'))), en = flatten(JSON.parse(read('src/i18n/en.json')));
  const files = ['src/views/admin/SeatEditor.tsx', 'src/views/admin/Overview.tsx', ...readdirSync(new URL('../src/views/admin/seatEditor/', import.meta.url)).map((f) => `src/views/admin/seatEditor/${f}`)];
  const keys = new Set<string>();
  for (const f of files) for (const m of read(f).matchAll(/['"`](seatEditor\.[A-Za-z0-9_.-]+)['"`]/g)) keys.add(m[1]!);
  for (const s of ['paste', 'check', 'match', 'save']) keys.add(`seatEditor.step.${s}`);
  for (const s of ['one', 'two', 'three']) keys.add(`seatEditor.start.step.${s}`);
  for (const s of ['empty', 'too-large', 'no-seats', 'responses-tab']) keys.add(`seatEditor.problem.${s}`);
  for (const s of ['empty', 'long', 'too-many']) keys.add(`seatEditor.check.blockIssue.${s}`);
  for (const s of ['ignored-cell', 'two-names', 'duplicate-order', 'order-gap', 'spans-blocks', 'bimah-unsized', 'bimah-multiple', 'label-ignored', 'no-seats', 'too-large']) keys.add(`seatEditor.warn.${s}`);
  assert.ok(keys.size > 100);
  for (const key of keys) { assert.ok(he[key], `he ${key}`); assert.ok(en[key], `en ${key}`); }
});

test('Main opens the seating editor only for a gabbai, and a dirty editor asks before leaving', () => {
  const main = read('src/views/Main.tsx');
  assert.match(main, /case 'seatEditor':\s*body = seatEditorAllowed\(kehila\?\.role\) \? <SeatEditor/);
  assert.match(main, /onSeatEditor=\{seatEditorAllowed\(state\.kehila\?\.role\)/);
  assert.match(main, /seat-editor.*seatEditorAllowed\(state\.kehila\?\.role\)/);
  assert.equal(editorLeaveAsk('seatEditor', true), true);
  assert.equal(editorLeaveAsk('seatEditor', false), false);
});
import { editorLeaveAsk } from '../src/schedule/editor.ts';
