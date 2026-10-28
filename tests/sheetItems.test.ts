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
