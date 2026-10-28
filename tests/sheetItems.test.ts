import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeRows, inItems, lineOf } from '../src/client/sheetItems.ts';
import type { SheetGroup, SheetItem, SheetPage } from '../src/client/types.ts';

const item = (itemId: string, group: SheetGroup, over: Partial<SheetItem> = {}): SheetItem => ({
  itemId, week: '2026-10-30', group, kind: 'message', type: group === 'mazal' ? 'celebration' : group === 'condolence' ? 'condolence' : 'event',
  state: 'in', source: 'auto', postedAt: 1_780_000_000, ...over,
});

test('lineOf: an override line keeps the bold surname, the second line is the sub', () => {
  const line = lineOf(item('a', 'mazal', { line: { text: 'מזל טוב למשפחת דוגמה\nלהולדת הנכדה', bold: 'דוגמה' } }));
  assert.deepEqual(line.main, [{ text: 'מזל טוב למשפחת ', bold: false }, { text: 'דוגמה', bold: true }]);
  assert.equal(line.sub, 'להולדת הנכדה');
  assert.equal(line.blessing, '');
  assert.equal(line.icon, 'heart');
  assert.equal(line.cancelled, false);
  assert.equal(lineOf(item('b', 'events', { kind: 'free', type: 'notice', line: { text: 'כיבוד קל', bold: '' } })).icon, null);
});

test('lineOf: without an override the template builds the line', () => {
  const message = {
    messageId: 'm1', channelId: 'c', type: 'condolence' as const, title: 'x', body: '', authorId: 'a', authorName: 'a', authorKind: 'management' as const, joinCount: 0,
    templateId: 'condolence' as const, fields: { variant: 'only', surname: 'ניסיון', deceased: 'יוסף', relation: 'אביו של משה' },
  };
  const line = lineOf(item('m1', 'condolence', { message }));
  assert.equal(line.main[0]!.text, 'משפחת ');
  assert.deepEqual(line.main[1], { text: 'ניסיון', bold: true });
  assert.equal(line.icon, null);
});

test('inItems keeps only state in, in page order', () => {
  const page: SheetPage = { week: '2026-10-30', items: [item('a', 'mazal'), item('b', 'mazal', { state: 'pending' }), item('c', 'events', { state: 'removed' }), item('d', 'events')] };
  assert.deepEqual(inItems(page).map(i => i.itemId), ['a', 'd']);
});

test('homeRows orders mazal, condolence, events and caps at 5 with the count left', () => {
  const items = [item('e1', 'events'), item('c1', 'condolence'), item('m1', 'mazal'), item('m2', 'mazal'), item('e2', 'events'), item('m3', 'mazal'), item('c2', 'condolence')];
  const got = homeRows(items);
  assert.deepEqual(got.rows.map(i => i.itemId), ['m1', 'm2', 'm3', 'c1', 'c2']);
  assert.equal(got.more, 2);
  assert.deepEqual(homeRows(items.slice(0, 2)), { rows: [items[1], items[0]], more: 0 });
  assert.equal(homeRows(items, 3).more, 4);
});

test('the fixture API answers the sheet list by role and keeps writes', async () => {
  const { createFixtureApi } = await import('../src/client/fixtures.ts');
  const week = '2026-10-30';
  const member = await createFixtureApi('member').sheetItems('01FIXTUREKEHILA0000000001', week);
  assert.ok(member.items.length > 0 && member.items.every(i => i.state === 'in'));
  const api = createFixtureApi('gabbai');
  const all = await api.sheetItems('01FIXTUREKEHILA0000000001', week);
  assert.ok(all.items.some(i => i.state === 'pending') && all.items.some(i => i.state === 'removed'));
  const pending = all.items.find(i => i.state === 'pending')!;
  const approved = await api.setSheetItem('01FIXTUREKEHILA0000000001', week, pending.itemId, { state: 'in' });
  assert.equal(approved.source, 'approved');
  const added = await api.addSheetItem('01FIXTUREKEHILA0000000001', week, { type: 'notice', text: 'כיבוד קל', source: 'byGabbai' });
  assert.equal(added.group, 'events');
  const moved = await api.moveSheetItem('01FIXTUREKEHILA0000000001', week, added.itemId, 'up');
  const events = moved.items.filter(i => i.group === 'events');
  assert.ok(events.findIndex(i => i.itemId === added.itemId) < events.length - 1);
});

// ---- Task 14: the management screen's pure helpers ----
import { editLine, groupsForScreen, meters, sourceTag } from '../src/client/sheetItems.ts';
import type { SheetFit, SheetModel } from '../src/schedule/sheetModel.ts';

const fitOf = (over: Partial<SheetFit> = {}): SheetFit => ({
  rowFont: 14, mazalFont: 13, imageScale: 1, dropImage: false, dropBlessings: false, droppedMazal: 0, droppedEvents: 0, dropped: [], out: [], more: 0,
  tight: false, scale: 1, overflow: false, ...over,
});
const modelOf = (mazal: number, events: number, image = true) => ({
  mazalTov: Array.from({ length: mazal }, (_, i) => ({ id: `m${i}`, group: 'mazal' as const, main: [], sub: '', blessing: '', icon: null, cancelled: false })),
  events: Array.from({ length: events }, (_, i) => ({ id: `e${i}`, group: 'events' as const, main: [], sub: '', blessing: '', icon: null, cancelled: false })),
  pinned: image ? { imageUri: 'x' } : null, variant: 'a4',
}) as unknown as SheetModel;

test('meters: counts what is on the sheet against the maxima, and says what does not fit', () => {
  const m = meters(modelOf(3, 2), fitOf());
  assert.deepEqual(m, { mazal: { n: 3, max: 6 }, events: { n: 2, max: 3 }, image: true, fits: true, over: 0 });
  const over = meters(modelOf(8, 1, false), fitOf({ out: ['m6', 'm7'], more: 2 }));
  assert.equal(over.mazal.n, 6);
  assert.equal(over.over, 2);
  assert.equal(over.fits, false);
  assert.equal(over.image, false);
  assert.equal(meters(modelOf(1, 1), fitOf({ dropImage: true })).image, false);
});

test('groupsForScreen: pending apart, out flags from fit.out, index and count per group, removed by group', () => {
  const page: SheetPage = {
    week: '2026-10-30',
    items: [
      item('p1', 'mazal', { state: 'pending' }), item('a', 'mazal'), item('b', 'mazal'), item('c', 'mazal'), item('r1', 'events', { state: 'removed' }),
      item('k', 'condolence'), item('e1', 'events'), item('r2', 'mazal', { state: 'removed' }),
    ],
  };
  const g = groupsForScreen(page, fitOf({ out: ['c'] }));
  assert.deepEqual(g.pending.map(i => i.itemId), ['p1']);
  assert.deepEqual(g.mazal.map(r => [r.item.itemId, r.out, r.index, r.count]), [['a', false, 1, 3], ['b', false, 2, 3], ['c', true, 3, 3]]);
  assert.deepEqual(g.condolence.map(r => [r.item.itemId, r.index, r.count]), [['k', 1, 1]]);
  assert.deepEqual(g.events.map(r => r.item.itemId), ['e1']);
  assert.deepEqual(g.removed.mazal.map(i => i.itemId), ['r2']);
  assert.deepEqual(g.removed.events.map(i => i.itemId), ['r1']);
  assert.deepEqual(g.removed.condolence, []);
});

test('sourceTag: label and tone per source, the approver joins "approved"', () => {
  const t = (key: string, p?: Record<string, string | number>) => (p ? `${key}:${JSON.stringify(p)}` : key);
  assert.deepEqual(sourceTag(item('a', 'mazal', { source: 'auto' }), t), { label: 'sheetItems.src.auto', tone: 'olive' });
  assert.deepEqual(sourceTag(item('a', 'mazal', { source: 'approved', approvedBy: 'משה' }), t), { label: 'sheetItems.src.approved · משה', tone: 'olive' });
  assert.deepEqual(sourceTag(item('a', 'mazal', { source: 'approved' }), t), { label: 'sheetItems.src.approved', tone: 'olive' });
  assert.equal(sourceTag(item('a', 'mazal', { source: 'byGabbai' }), t).tone, 'tekhelet');
  assert.equal(sourceTag(item('a', 'events', { source: 'free', kind: 'free' }), t).tone, 'plain');
  assert.equal(sourceTag(item('a', 'mazal', { source: 'member', state: 'pending' }), t).tone, 'gold');
});

test('editLine keeps the bold token separate, and drops it when the text no longer holds it', () => {
  const base = item('a', 'mazal', { line: { text: 'מזל טוב למשפחת דוגמה', bold: 'דוגמה' } });
  assert.deepEqual(editLine(base, 'מזל טוב למשפחת דוגמה\nלחתונה'), { text: 'מזל טוב למשפחת דוגמה\nלחתונה', bold: 'דוגמה' });
  assert.deepEqual(editLine(base, 'שמחה גדולה'), { text: 'שמחה גדולה', bold: '' });
  const fromMessage = item('m', 'mazal', { message: { messageId: 'm', channelId: 'c', type: 'celebration', title: '', body: '', authorId: 'a', authorName: 'a', authorKind: 'management', joinCount: 0, templateId: 'mazal', fields: { occasion: 'wedding', whose: 'parents', surname: 'ניסיון', firstNames: '', name: '', parents: '', blessing: '' } } });
  assert.equal(editLine(fromMessage, 'מזל טוב למשפחת ניסיון').bold, 'ניסיון');
});

test('relativeWhen: today and yesterday in words with the Israel clock, older as a short date', async () => {
  const { relativeWhen } = await import('../src/client/sheetItems.ts');
  const now = Date.parse('2026-10-29T10:00:00+02:00');
  assert.equal(relativeWhen(Date.parse('2026-10-28T21:10:00+02:00') / 1000, now, 'he'), 'אתמול 21:10');
  assert.equal(relativeWhen(Date.parse('2026-10-29T08:40:00+02:00') / 1000, now, 'he'), 'היום 08:40');
  assert.equal(relativeWhen(Date.parse('2026-10-20T08:40:00+03:00') / 1000, now, 'he'), 'ט׳ בחשוון (20.10) 08:40');
});

test('sourceTag: a line added by tech says tech, by a gabbai says gabbai', () => {
  const t = (key: string) => key;
  assert.equal(sourceTag(item('a', 'mazal', { source: 'byGabbai', byRole: 'tech' }), t).label, 'sheetItems.src.byTech');
  assert.equal(sourceTag(item('a', 'mazal', { source: 'byGabbai', byRole: 'gabbai' }), t).label, 'sheetItems.src.byGabbai');
});

test('patchItem on the latest list: approve A, approve B, undo A leaves B approved', async () => {
  const { patchItem } = await import('../src/client/sheetItems.ts');
  const l0 = [item('A', 'mazal', { state: 'pending' }), item('B', 'mazal', { state: 'pending' })];
  const l1 = patchItem(l0, 'A', { state: 'in' });
  const l2 = patchItem(l1, 'B', { state: 'in' });
  const l3 = patchItem(l2, 'A', { state: 'pending' });
  assert.deepEqual(l3.map(i => [i.itemId, i.state]), [['A', 'pending'], ['B', 'in']]);
  assert.equal(l0[0]!.state, 'pending');
});

test('sheetPendingOf: sums the weeks, names the first with any, and a failed week keeps the previous numbers', async () => {
  const { sheetPendingOf } = await import('../src/client/sheetItems.ts');
  const page = (week: string, n: number): SheetPage => ({ week, items: Array.from({ length: n }, (_, i) => item(`${week}${i}`, 'mazal', { state: 'pending' })) });
  const prev = { n: 9, week: '2026-10-23' };
  assert.deepEqual(sheetPendingOf(['w1', 'w2'], [page('w1', 0), page('w2', 2)], prev), { n: 2, week: 'w2' });
  assert.deepEqual(sheetPendingOf(['w1', 'w2'], [page('w1', 1), page('w2', 2)], prev), { n: 3, week: 'w1' });
  assert.deepEqual(sheetPendingOf(['w1', 'w2'], [page('w1', 0), page('w2', 0)], prev), { n: 0, week: null });
  assert.deepEqual(sheetPendingOf(['w1', 'w2'], [page('w1', 1), null], prev), prev);
});
