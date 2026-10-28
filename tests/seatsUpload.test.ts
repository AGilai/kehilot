import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AREAS } from '../src/seats/formCsv.ts';
import type { FormAnswer } from '../src/seats/formCsv.ts';
import { allDecided, combineResults, initialUpload, nameVariants, planUpload, suggestForName, uploadReducer } from '../src/seats/upload.ts';
import type { PlanInput } from '../src/seats/upload.ts';
import type { WeekWire } from '../src/seats/wire.ts';

// one block, one row: seats s1..s3 family A (בדיוני), s4..s5 holder H (מדומה), s6 family B (דוגמה); nobody else
function week(over: { erev?: WeekWire['prayers']['erev']['seats']; day?: WeekWire['prayers']['day']['seats'] } = {}): WeekWire {
  const ids = ['s1', 's2', 's3', 's4', 's5', 's6'];
  return {
    week: '2026-10-30', deadline: '2026-10-30T10:00:00Z', open: true,
    layout: { effectiveFrom: '2026-01-02', rows: 1, cols: 6, cells: [Array(6).fill('seat')], blocks: [{ name: 'מרכז', colStart: 0, colEnd: 5 }], rowLabels: [null], seats: ids.map((id, i) => ({ id, row: 0, col: i })) },
    assignments: { s1: 'family:A', s2: 'family:A', s3: 'family:A', s4: 'holder:H', s5: 'holder:H', s6: 'family:B' },
    households: { 'family:A': 'בדיוני', 'holder:H': 'מדומה', 'family:B': 'דוגמה' },
    prayers: {
      erev: { seats: over.erev ?? {}, requests: {}, canUndo: false, updatedAt: null },
      day: { seats: over.day ?? {}, requests: {}, canUndo: false, updatedAt: null },
    },
  };
}
const ans = (name: string, counts: FormAnswer['counts'], requests: FormAnswer['requests'] = {}, at = 1, line = 2): FormAnswer => ({ line, at, name, counts, requests });
const dec = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, ref]) => [k, ref.startsWith('holder:') ? { kind: 'holder' as const, id: ref.slice(7) } : ref === 'skip' ? { kind: 'skip' as const } : { kind: 'family' as const, id: ref.slice(7) }]));
const input = (over: Partial<PlanInput>): PlanInput => ({ week: week(), answers: [], decisions: {}, overrides: new Set(), prayers: ['erev', 'day'], ...over });
const app = (n: number, by: 'member' | 'gabbai' = 'member', prefix = 's') => Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`${prefix}${i + 1}`, { released: i < n, by, at: 5 }]));

test('nameVariants tries both orders and drops a family title', () => {
  assert.deepEqual(nameVariants('בדיוני שמעון'), [{ family: 'שמעון', initial: 'ב' }, { family: 'בדיוני', initial: 'ש' }]);
  assert.deepEqual(nameVariants('ש. משל')[0], { family: 'משל', initial: 'ש' });
  assert.deepEqual(nameVariants('משפחת דוגמה'), [{ family: 'דוגמה' }]);
});

test('suggestForName finds a registered family or a holder in either order; ambiguity is recomputed', () => {
  const fams = [{ id: 'A', lastName: 'בדיוני', firstName: 'שמעון' }, { id: 'B', lastName: 'דוגמה', firstName: 'גד' }];
  const holders = [{ id: 'H', name: 'מדומה' }];
  const r1 = suggestForName('k', 'בדיוני שמעון', fams, holders);
  assert.equal(r1.level, 'exact');
  assert.equal(r1.candidates[0]!.id, 'A');
  const r2 = suggestForName('k', 'שמעון בדיוני', fams, holders);
  assert.equal(r2.candidates[0]!.id, 'A');
  const r3 = suggestForName('k', 'מדומה', fams, holders);
  assert.equal(r3.candidates[0]!.kind, 'holder');
  const two = suggestForName('k', 'בדיוני שמעון', [...fams, { id: 'A2', lastName: 'בדיוני', firstName: 'שמעון' }], []);
  assert.equal(two.ambiguous, true);
  assert.ok(two.candidates.every((c) => c.level === 'likely'));
  assert.equal(suggestForName('k', 'אלמוני פלוני', fams, holders).level, 'none');
});

test('plan: a count changes a family; same count is unchanged; calls carry only what changes', () => {
  const p = planUpload(input({ answers: [ans('בדיוני', { erev: 1, day: 0 }), ans('דוגמה', { erev: 0, day: 0 })], decisions: dec({ בדיוני: 'family:A', דוגמה: 'family:B' }) }));
  assert.deepEqual(p.rows.map((r) => r.status), ['change', 'same']);
  assert.deepEqual(p.summary, { change: 1, changeNoAccount: 0, same: 1, skipped: 0, errors: 0, kept: 0 });
  assert.deepEqual(p.calls, [{ event: 'erev', rows: [{ household: 'family:A', released: 1 }] }]);
});

test('plan: a holder row counts as "no account"', () => {
  const p = planUpload(input({ answers: [ans('מדומה', { erev: 1, day: 1 })], decisions: dec({ מדומה: 'holder:H' }) }));
  assert.equal(p.summary.changeNoAccount, 1);
  assert.equal(p.rows[0]!.noAccount, true);
  assert.deepEqual(p.calls.map((c) => c.event), ['erev', 'day']);
});

test('plan: an app answer is kept unless the file is chosen; override is sent only for prayers where the app answered', () => {
  const w = week({ erev: app(1) }); // family A answered in the app for erev (1 released), not for day
  const answers = [ans('בדיוני', { erev: 2, day: 1 })];
  const kept = planUpload(input({ week: w, answers, decisions: dec({ בדיוני: 'family:A' }) }));
  assert.equal(kept.rows[0]!.conflict, true);
  assert.equal(kept.rows[0]!.lines[0]!.kept, true);
  assert.equal(kept.rows[0]!.lines[1]!.kept, false);
  assert.equal(kept.summary.kept, 1);
  assert.equal(kept.rows[0]!.status, 'change'); // the day count still changes
  assert.deepEqual(kept.calls, [{ event: 'day', rows: [{ household: 'family:A', released: 1 }] }]);
  const over = planUpload(input({ week: w, answers, decisions: dec({ בדיוני: 'family:A' }), overrides: new Set(['family:A']) }));
  assert.equal(over.summary.kept, 0);
  assert.deepEqual(over.calls, [{ event: 'erev', rows: [{ household: 'family:A', released: 2, override: true }] }, { event: 'day', rows: [{ household: 'family:A', released: 1 }] }]);
});

test('plan: an app answer that equals the file is no conflict; a gabbai answer is not an app answer', () => {
  const same = planUpload(input({ week: week({ erev: app(1) }), answers: [ans('בדיוני', { erev: 1 })], decisions: dec({ בדיוני: 'family:A' }) }));
  assert.equal(same.rows[0]!.conflict, false);
  assert.equal(same.rows[0]!.status, 'same');
  const g = planUpload(input({ week: week({ erev: app(1, 'gabbai') }), answers: [ans('בדיוני', { erev: 2 })], decisions: dec({ בדיוני: 'family:A' }) }));
  assert.equal(g.rows[0]!.conflict, false);
  assert.equal(g.rows[0]!.status, 'change');
});

test('plan: above the seats is an error and is not sent; a household with no seats is refused or skipped', () => {
  const p = planUpload(input({ answers: [ans('דוגמה', { erev: 5 }, { [AREAS[0]]: 2 }), ans('ריק', { erev: 1 }), ans('ריק שניה', {}, { [AREAS[1]]: 1 })], decisions: dec({ דוגמה: 'family:B', ריק: 'family:Z', 'ריק שניה': 'family:Z' }) }));
  assert.deepEqual(p.rows.map((r) => [r.status, r.reason]), [['error', 'above'], ['error', 'noSeats'], ['skipped', 'noSeatsRequest']]);
  assert.equal(p.summary.errors, 2);
  assert.deepEqual(p.calls, []);
  assert.deepEqual(p.requests, []);
});

test('plan: a request-only row of a household with seats is sent with its requests on the first call only; totals per area', () => {
  const p = planUpload(input({ answers: [ans('בדיוני', {}, { [AREAS[0]]: 2, [AREAS[2]]: 1 }), ans('דוגמה', { erev: 0 }, { [AREAS[0]]: 4 })], decisions: dec({ בדיוני: 'family:A', דוגמה: 'family:B' }) }));
  assert.deepEqual(p.calls, [{ event: 'erev', rows: [{ household: 'family:A', released: 0, requests: { [AREAS[0]]: 2, [AREAS[2]]: 1 } }, { household: 'family:B', released: 0, requests: { [AREAS[0]]: 4 } }] }]);
  assert.deepEqual(p.requests, [{ area: AREAS[0], seats: 6, households: 2 }, { area: AREAS[2], seats: 1, households: 1 }]);
});

test('plan: skipped rows and two names for one household (the later answer wins)', () => {
  const p = planUpload(input({
    answers: [ans('א בדיוני', { erev: 1 }, {}, 100), ans('בדיוני ב', { erev: 2 }, {}, 200), ans('נסיון', { erev: 1 })],
    decisions: dec({ 'א בדיוני': 'family:A', 'בדיוני ב': 'family:A', נסיון: 'skip' }), key: (n) => n,
  }));
  assert.deepEqual(p.rows.map((r) => r.status), ['duplicate', 'change', 'skipped']);
  assert.deepEqual(p.calls, [{ event: 'erev', rows: [{ household: 'family:A', released: 2 }] }]);
  assert.equal(p.summary.skipped, 2);
});

test('plan: undecided answers are skipped in the plan and allDecided says so', () => {
  const answers = [ans('בדיוני', { erev: 1 })];
  assert.equal(allDecided(answers, {}), false);
  assert.equal(allDecided(answers, dec({ בדיוני: 'skip' })), true);
});

test('combineResults: requests are not double counted, warnings de-duplicated', () => {
  const s = combineResults([
    { event: 'erev', households: 2, released: 3, kept: 4, duplicates: 0, warnings: [{ household: 'family:A', code: 'app_answer_kept' }], requestTotals: { [AREAS[0]]: 2 } },
    { event: 'day', households: 1, released: 1, kept: 5, duplicates: 0, warnings: [{ household: 'family:A', code: 'app_answer_kept' }, { household: 'family:B', code: 'no_seats' }], requestTotals: {} },
  ]);
  assert.deepEqual(s, { households: 2, released: 4, warnings: [{ household: 'family:A', code: 'app_answer_kept' }, { household: 'family:B', code: 'no_seats' }], requestTotals: { [AREAS[0]]: 2 }, events: ['erev', 'day'] });
});

test('uploadReducer: only Shabbat is wired; override toggles a household; reset', () => {
  let s = initialUpload();
  s = uploadReducer(s, { type: 'event', event: 'hag' });
  assert.equal(s.event, 'shabbat');
  s = uploadReducer(s, { type: 'override', ref: 'family:A', on: true });
  assert.ok(s.overrides.has('family:A'));
  const t = uploadReducer(s, { type: 'override', ref: 'family:A', on: false });
  assert.ok(!t.overrides.has('family:A'));
  assert.ok(s.overrides.has('family:A'), 'the old state is not mutated');
  assert.equal(uploadReducer(s, { type: 'step', step: 'preview' }).step, 'preview');
  assert.equal(uploadReducer(s, { type: 'reset' }).overrides.size, 0);
});
