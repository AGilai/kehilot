import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignKeys, emptyDraft, freeKeys, addHolder, diffDrafts } from '../src/seats/editModel.ts';
import { historyRows, isPastVersion, loadVersion, newerExists, rebaseLatest, saveMap, scheduledAfter, versionToOpen } from '../src/seats/mapSave.ts';
import type { MapApi, Version } from '../src/seats/mapSave.ts';

const A = 'family:FA';
type Row = { effectiveFrom: string; updatedAt: number; seats: number; assigned: number; current: boolean };

function fake(over: Partial<{ layoutAt: number; asgAt: number | null; asg: Record<string, string>; fail409: boolean }> = {}) {
  const d = emptyDraft(2, 3);
  const st = { layoutAt: over.layoutAt ?? 100, asgAt: over.asgAt === undefined ? 50 : over.asgAt, asg: over.asg ?? {} };
  const calls: string[] = [];
  const body = (from: string) => ({ ...d.layout, effectiveFrom: from, seats: d.layout.cells.flatMap((r, row) => r.map((_, col) => ({ id: `s${row}${col}`, row, col }))), updatedAt: st.layoutAt });
  const api: MapApi & { puts: unknown[] } = {
    puts: [],
    layouts: async () => [{ effectiveFrom: '2026-11-06', updatedAt: st.layoutAt, seats: 6, assigned: 0, current: true } as Row],
    layout: async (f) => body(f),
    assignments: async () => ({ assignments: st.asg, updatedAt: st.asgAt }),
    createHolder: async () => { calls.push('holder'); return { holderId: 'H1' }; },
    putLayout: async (f, b) => { calls.push('layout'); if (over.fail409) { const e = new Error('x') as Error & { status: number; code: string }; e.status = 409; e.code = 'layout_changed'; throw e; } api.puts.push(['layout', f, b.ifUpdatedAt]); return { seats: body(f).seats, updatedAt: 200 }; },
    assignmentsGuard: async () => st.asgAt,
    putAssignments: async (f, b) => { calls.push('assign'); api.puts.push(['assign', f, b]); return { updatedAt: 300 }; },
  };
  return { api, calls, st };
}
const ver = (draft = emptyDraft(2, 3)): Version => ({ from: '2026-11-06', updatedAt: 100, assignUpdatedAt: 50, draft });

test('saving in place sends the opened version as guard and every seat in the assignments', async () => {
  const { api, calls } = fake();
  const base = ver();
  const draft = assignKeys(base.draft, ['0:0'], A);
  const r = await saveMap({ api, draft, base, from: '2026-11-06', carry: {}, known: [], onProgress: () => {} });
  assert.ok(r.ok);
  assert.deepEqual(calls, ['layout', 'assign']);
  assert.deepEqual(api.puts[0], ['layout', '2026-11-06', 100]);
  const sent = (api.puts[1] as [string, string, { assignments: Record<string, string | null> }])[2].assignments;
  assert.equal(Object.keys(sent).length, 6);
  assert.equal(sent.s00, A);
  assert.equal(sent.s01, null);
});

test('a new version from another Friday has no guard of its own (nothing saved there yet) and creates holders first', async () => {
  const { api, calls } = fake();
  const base = ver();
  const h = addHolder(base.draft, 'דוגמה');
  const draft = assignKeys(h.draft, ['1:1'], h.ref);
  const r = await saveMap({ api, draft, base, from: '2026-11-13', carry: {}, known: [], onProgress: () => {} });
  assert.ok(r.ok);
  assert.deepEqual(calls, ['holder', 'layout', 'assign']);
  assert.deepEqual(api.puts[0], ['layout', '2026-11-13', null]);
  assert.equal(((api.puts[1] as [string, string, { assignments: Record<string, string | null> }])[2]).assignments.s11, 'holder:H1');
});

test('a newer layout (or newer assignments) is a conflict before anything is written', async () => {
  for (const o of [{ layoutAt: 150 }, { asgAt: 99 }]) {
    const { api, calls } = fake(o);
    const r = await saveMap({ api, draft: ver().draft, base: ver(), from: '2026-11-06', carry: {}, known: [], onProgress: () => {} });
    assert.ok(!r.ok && r.conflict);
    assert.deepEqual(calls, []);
  }
  const { api } = fake({ layoutAt: 150 });
  assert.equal(await newerExists(api, ver(), '2026-11-06'), 'layout');
  assert.equal(await newerExists(api, ver(), '2026-11-13'), null, 'another date: nothing to be newer than');
});

test('a 409 from the layout write is reported as a conflict; overwrite skips the pre-check', async () => {
  const { api } = fake({ fail409: true });
  const r = await saveMap({ api, draft: ver().draft, base: ver(), from: '2026-11-06', carry: {}, known: [], onProgress: () => {} });
  assert.ok(!r.ok && r.conflict && r.stage === 'layout');
  const f = fake({ layoutAt: 150 });
  const o = await saveMap({ api: f.api, draft: ver().draft, base: ver(), from: '2026-11-06', carry: {}, known: [], overwrite: true, onProgress: () => {} });
  assert.ok(o.ok);
  assert.deepEqual(f.api.puts[0], ['layout', '2026-11-06', 150], 'the overwrite uses the fresh guard');
});

test('rebaseLatest re-reads the newer version and keeps my change set as unsaved changes', async () => {
  const { api } = fake({ layoutAt: 150, asg: { s02: 'family:FC' }, asgAt: 99 });
  const base = ver();
  const mine = freeKeys(assignKeys(base.draft, ['0:0', '0:1'], A), ['0:1']);
  const r = await rebaseLatest(api, base, mine, '2026-11-06');
  assert.equal(r.version.updatedAt, 150);
  assert.equal(r.draft.assign['0:2'], 'family:FC');
  assert.equal(r.draft.assign['0:0'], A);
  assert.deepEqual(r.overlaps, []);
  assert.deepEqual(Object.keys(diffDrafts(r.version.draft, r.draft).assign), ['0:0']);
  assert.equal((await loadVersion(api, '2026-11-06')).assignUpdatedAt, 99);
});

test('history rows: newest first, numbered from the oldest, read-only before the current Shabbat, scheduled after it', () => {
  const now = new Date('2026-10-28T10:00:00+02:00'); // Wednesday: current Shabbat = Friday 2026-10-30
  const rows: Row[] = [
    { effectiveFrom: '2026-09-04', updatedAt: 1, seats: 200, assigned: 150, current: false },
    { effectiveFrom: '2026-10-09', updatedAt: 2, seats: 225, assigned: 170, current: true },
    { effectiveFrom: '2026-11-13', updatedAt: 3, seats: 225, assigned: 171, current: false },
  ];
  const h = historyRows(rows, now);
  assert.deepEqual(h.map((x) => x.n), [3, 2, 1]);
  assert.deepEqual(h.map((x) => x.readOnly), [false, true, true]);
  assert.deepEqual(h.map((x) => x.scheduled), [true, false, false]);
  assert.equal(h[1]!.until, '2026-11-13');
  assert.equal(h[0]!.until, null);
  assert.equal(versionToOpen(rows), '2026-10-09');
  assert.equal(versionToOpen(rows.map((r) => ({ ...r, current: false }))), '2026-11-13');
  assert.equal(versionToOpen([]), null);
  assert.equal(scheduledAfter(rows, '2026-10-09'), '2026-11-13');
  assert.equal(scheduledAfter(rows, '2026-11-13'), null);
  assert.ok(isPastVersion('2026-10-23', now));
  assert.ok(!isPastVersion('2026-10-30', now));
});
