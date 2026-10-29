import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ICON_PATHS } from '../src/kit/iconPaths.ts';
import { CHAIR_COLORS, chairSvg } from '../src/seats/chairSvg.ts';
import { createSeatsFixture, fixtureMemberSeats } from '../src/seats/fixtureSeats.ts';
import {
  afterSend, runSend, autoRelease, changed, circleLayout, copyArvit, footerOf, formMode, headKey, hintOf, initDraft, isAutoChoice, mineRowLabels,
  pickCount, saveChoices, segState, tapChair,
} from '../src/seats/seatForm.ts';
import type { PrayerDraft } from '../src/seats/seatForm.ts';
import { memberFromWire } from '../src/seats/wire.ts';
import type { MemberSeats } from '../src/seats/wire.ts';

const set = (...k: string[]) => new Set(k);
function m(over: Partial<MemberSeats> = {}): MemberSeats {
  return {
    week: '2026-10-30', deadline: new Date('2026-10-30T12:00:00Z'), open: true, remindable: true, hadSeats: true, seatCount: 3,
    updatedByGabbai: false, updatedByRole: null, updatedAt: { arvit: null, shacharit: null }, answered: { arvit: false, shacharit: false },
    answeredAt: { arvit: null, shacharit: null }, updatedByAt: null, freeOrder: ['1', '2', '3'], frames: [],
    released: { arvit: new Set(), shacharit: new Set() }, ...over,
  };
}
const pd = (over: Partial<PrayerDraft> = {}): PrayerDraft => ({ released: new Set(), answered: false, custom: false, ...over });

test('autoRelease frees the first of the free order', () => {
  assert.deepEqual(autoRelease(m(), 1), set('1'));
  assert.deepEqual(autoRelease(m(), 0), set());
  assert.deepEqual(autoRelease(m(), 5), set('1', '2', '3'));
});

test('isAutoChoice and headKey', () => {
  assert.equal(isAutoChoice(m(), set('1')), true);
  assert.equal(isAutoChoice(m(), set('3')), false);
  assert.equal(headKey(m()), '3');
  assert.equal(headKey(m({ freeOrder: [] })), null);
});

test('mineRowLabels lists his rows', () => {
  const f = { id: 'x', blockName: 'b', cols: 1, rowFrom: '2', rowTo: '4', lanes: [], gapAbove: false, rows: [
    { label: '2', mine: false, bimah: false, cells: [] }, { label: '3', mine: true, bimah: false, cells: [] }, { label: '4', mine: true, bimah: false, cells: [] }] };
  assert.deepEqual(mineRowLabels(f), ['3', '4']);
});

test('tapChair marks a custom choice; pickCount goes back to the automatic order', () => {
  const d = initDraft(m());
  const t = tapChair(d, m(), 'arvit', '3');
  assert.deepEqual(t.arvit, { released: set('3'), answered: true, custom: true });
  assert.equal(d.arvit.answered, false);
  const p = pickCount(t, m(), 'arvit', 1);
  assert.deepEqual(p.arvit, { released: set('1'), answered: true, custom: false });
  const back = tapChair(t, m(), 'arvit', '3');
  assert.deepEqual(back.arvit.released, set());
  assert.equal(back.arvit.custom, false);
});

test('copyArvit copies the set and answers shacharit', () => {
  const d = tapChair(initDraft(m()), m(), 'arvit', '3');
  const c = copyArvit(d);
  assert.notEqual(c.shacharit.released, d.arvit.released);
  assert.deepEqual(c.shacharit, { released: set('3'), answered: true, custom: true });
});

test('copyArvit does not mark shacharit answered when arvit is not', () => {
  const d = copyArvit(initDraft(m()));
  assert.equal(d.shacharit.answered, false);
  assert.equal(d.arvit.answered, false);
});

test('memberFromWire: a freeOrder of the wrong length falls back to the family order reversed', () => {
  const w = createSeatsFixture('default', null, '2026-10-30').memberWire();
  assert.deepEqual(memberFromWire({ ...w, freeOrder: [1, 2] }).freeOrder, ['3', '2', '1']);
  assert.deepEqual(memberFromWire({ ...w, freeOrder: [1, 1, 2] }).freeOrder, ['3', '2', '1']);
  assert.deepEqual(memberFromWire({ ...w, freeOrder: [2, 1, 3] }).freeOrder, ['2', '1', '3']);
});

test('fixture: a gabbai edit and a tech edit carry their role', () => {
  assert.equal(createSeatsFixture('gabbai', null, '2026-10-30').memberWire().updatedByRole, 'gabbai');
  assert.equal(createSeatsFixture('default', 'seats-tech', '2026-10-30').memberWire().updatedByRole, 'tech');
  assert.equal(createSeatsFixture('default', null, '2026-10-30').memberWire().updatedByRole ?? null, null);
});

test('initDraft: all freed and answered opens as N, sendChanges disabled', () => {
  const all = set('1', '2', '3');
  const x = m({ answered: { arvit: true, shacharit: true }, released: { arvit: all, shacharit: new Set(all) } });
  const d = initDraft(x);
  assert.deepEqual(segState(d.arvit, 3), { kind: 'none' });
  assert.deepEqual(segState(d.shacharit, 3), { kind: 'none' });
  assert.equal(d.arvit.custom, false);
  assert.equal(formMode(x), 'answered');
  assert.deepEqual(footerOf(d, x, 'arvit'), { kind: 'sendChanges', enabled: false });
  assert.deepEqual(footerOf(pickCount(d, x, 'arvit', 1), x, 'arvit'), { kind: 'sendChanges', enabled: true });
});

test('footerOf on a new form', () => {
  const x = m();
  const d = initDraft(x);
  assert.deepEqual(footerOf(d, x, 'arvit'), { kind: 'send', enabled: false });
  const a = pickCount(d, x, 'arvit', 0);
  assert.deepEqual(footerOf(a, x, 'arvit'), { kind: 'next', to: 'shacharit' });
  assert.deepEqual(footerOf(a, x, 'shacharit'), { kind: 'send', enabled: false });
  assert.deepEqual(footerOf(pickCount(a, x, 'shacharit', 1), x, 'shacharit'), { kind: 'send', enabled: true });
  assert.equal(footerOf(a, m({ open: false }), 'arvit'), null);
});

test('hintOf', () => {
  assert.equal(hintOf(pd(), 3, false, false), 'none');
  assert.equal(hintOf(pd({ answered: true }), 3, false, false), 'zero');
  assert.equal(hintOf(pd({ answered: true, released: set('1') }), 3, false, false), 'some');
  assert.equal(hintOf(pd({ answered: true, released: set('1') }), 3, true, false), 'someRear');
  assert.equal(hintOf(pd({ answered: true, released: set('1', '2', '3') }), 3, false, false), 'all');
  assert.equal(hintOf(pd({ answered: true, released: set('3'), custom: true }), 3, false, false), 'custom');
  assert.equal(hintOf(pd({ answered: true, released: set('1') }), 3, false, true), 'sent');
});

test('segState', () => {
  assert.deepEqual(segState(pd(), 3), { kind: 'unanswered' });
  assert.deepEqual(segState(pd({ answered: true }), 3), { kind: 'all' });
  assert.deepEqual(segState(pd({ answered: true, released: set('1', '2') }), 3), { kind: 'free', n: 2 });
});

test('formMode', () => {
  assert.equal(formMode(m({ seatCount: 0 })), 'noSeats');
  assert.equal(formMode(m({ open: false })), 'notSent');
  assert.equal(formMode(m({ open: false, answered: { arvit: true, shacharit: false } })), 'closed');
  assert.equal(formMode(m()), 'new');
  assert.equal(formMode(m({ answered: { arvit: true, shacharit: false } })), 'new');
});

test('saveChoices after a partial save sends only the rest', () => {
  const x = m({ answered: { arvit: true, shacharit: false }, released: { arvit: set('1'), shacharit: new Set() } });
  const d = { arvit: pd({ released: set('1'), answered: true }), shacharit: pd({ released: set('1', '2'), answered: true }) };
  assert.deepEqual(Object.keys(saveChoices(d, x)), ['shacharit']);
  assert.equal(changed(d, x, 'arvit'), false);
  assert.equal(changed(d, x, 'shacharit'), true);
});

test('afterSend: saved closes, updated stays', () => {
  const data = m();
  assert.equal(afterSend({ kind: 'saved', data }), 'close');
  assert.equal(afterSend({ kind: 'updated', data }), 'stale');
  assert.equal(afterSend(null), 'none');
});

test('circleLayout', () => {
  assert.deepEqual(circleLayout(3, 358), { size: 52, gap: 12, wrap: false });
  const c7 = circleLayout(7, 358);
  assert.equal(c7.size, 44);
  assert.equal(c7.wrap, false);
  assert.ok(8 * 44 + 7 * c7.gap <= 358);
  const c6 = circleLayout(6, 358);
  assert.equal(c6.size, 44);
  assert.ok(7 * 44 + 6 * c6.gap <= 358);
  const c5 = circleLayout(5, 358);
  assert.ok(c5.size === 52 && 6 * 52 + 5 * c5.gap <= 358 && c5.gap >= 4);
  assert.equal(circleLayout(9, 358).wrap, true);
});

test('chairSvg', () => {
  const grey = { fill: '#DDDDDD', seam: '#EEEEEE' };
  const kept = chairSvg({ state: 'kept', icon: 'user', dark: false, grey });
  assert.ok(kept.includes('#B8322E') && kept.includes('#B87A43'));
  assert.ok(!kept.includes('stroke-dasharray'));
  const free = chairSvg({ state: 'free', icon: 'check', dark: true, grey });
  assert.ok(free.includes('#6FC283'));
  assert.equal(free.split('stroke-dasharray').length - 1, 3);
  const other = chairSvg({ state: 'other', icon: null, dark: false, grey });
  assert.ok(!other.includes('#B87A43') && !other.includes('#B8322E'));
  assert.ok(chairSvg({ state: 'kept', icon: 'lock', dark: false, grey }).includes(ICON_PATHS.lock));
  assert.equal(CHAIR_COLORS.dark.wood, '#A86E3B');
  assert.ok(kept.startsWith('<svg') && kept.includes('viewBox="0 0 50 62"'));
});

test('fixture: default variant', () => {
  const w = createSeatsFixture('default', null, '2026-10-30').memberWire();
  assert.deepEqual(w.freeOrder, [3, 2, 1]);
  assert.deepEqual(w.frames![0]!.lanes, ['left', 'right']);
  assert.equal(w.frames![0]!.gapAbove, true);
  assert.equal(fixtureMemberSeats('default').seatCount, 3);
});

test('fixture: big variant', () => {
  const w = createSeatsFixture('big', null, '2026-10-30').memberWire();
  assert.equal(w.seats, 7);
  assert.deepEqual(w.freeOrder, [7, 6, 1, 2, 3, 4, 5]);
  assert.equal(w.frames!.length, 1);
  const f = w.frames![0]!;
  assert.deepEqual(f.lanes, ['left']);
  const mineRows = f.rows.filter((r) => r.mine);
  assert.deepEqual(mineRows.map((r) => r.label), ['3', '4']);
  assert.equal(mineRows[0]!.cells.filter((c) => c.kind === 'mine').length, 5);
  assert.deepEqual(mineRows[1]!.cells.map((c) => c.kind), ['other', 'other', 'other', 'mine', 'mine']);
  assert.equal(memberFromWire(w).seatCount, 7);
});

test('runSend: saved toasts then closes; stale and failures stay open without a toast', async () => {
  const log: string[] = [];
  const hooks = { toast: 'נשמר', onToast: (x: string) => log.push(`toast:${x}`), onDone: () => log.push('done') };
  assert.equal(await runSend(async () => ({ kind: 'saved' }) as never, hooks), 'close');
  assert.deepEqual(log, ['toast:נשמר', 'done']);
  log.length = 0;
  assert.equal(await runSend(async () => ({ kind: 'updated' }) as never, hooks), 'stale');
  assert.equal(await runSend(async () => null, hooks), 'none');
  await assert.rejects(runSend(async () => { throw new Error('net'); }, hooks), /net/);
  assert.deepEqual(log, []);
});
