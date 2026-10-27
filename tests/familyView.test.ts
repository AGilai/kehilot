import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canAddChild, familyRows, familyState, filterFamilies, formatBirthDate, parseBirthDate } from '../src/client/familyView.ts';
import type { FamilyView } from '../src/client/types.ts';

const TODAY = '2026-10-27';
const view = (over: Partial<FamilyView> = {}): FamilyView => ({
  familyId: 'f', name: 'בדיוני', adults: [{ userId: 'a', displayName: 'דנה בדיוני', me: true }], children: [], sent: null, received: [], notice: null, ...over,
});
const sent = (state: 'pending' | 'declined' | 'expired') => ({ toUserId: 'b', toName: 'יוסי בדיוני', expiresAt: 1, state });
const req = { fromUserId: 'c', fromName: 'שרה אלמוני', expiresAt: 1 };

test('parses d.m.yyyy and pads', () => {
  assert.deepEqual(parseBirthDate('4.9.2018', TODAY), { ok: '2018-09-04' });
  assert.deepEqual(parseBirthDate('12.03.2015', TODAY), { ok: '2015-03-12' });
  assert.deepEqual(parseBirthDate(' 31.12.2015 ', TODAY), { ok: '2015-12-31' });
  assert.deepEqual(parseBirthDate('29.2.2016', TODAY), { ok: '2016-02-29' });
  assert.deepEqual(parseBirthDate('', TODAY), { ok: '' });
  assert.deepEqual(parseBirthDate('   ', TODAY), { ok: '' });
  assert.deepEqual(parseBirthDate('27.10.2026', TODAY), { ok: '2026-10-27' });
});

test('rejects 30.2 and letters', () => {
  for (const bad of ['30.2.2015', '29.2.2015', '31.4.2015', '0.1.2015', '1.13.2015', 'abc', '1.1', '1.1.15', '2015-03-12', '1/1/2015', '1.1.2015x', '1.1.1899'])
    assert.deepEqual(parseBirthDate(bad, TODAY), { error: 'invalid' }, bad);
});

test('future date is future', () => {
  assert.deepEqual(parseBirthDate('28.10.2026', TODAY), { error: 'future' });
  assert.deepEqual(parseBirthDate('1.1.2030', TODAY), { error: 'future' });
});

test('formats YYYY-MM-DD as d.m.yyyy', () => {
  assert.equal(formatBirthDate('2015-03-12'), '12.3.2015');
  assert.equal(formatBirthDate('2018-09-04'), '4.9.2018');
});

test('state priority prefers received over sent', () => {
  assert.equal(familyState(view()), 'alone');
  assert.equal(familyState(view({ sent: sent('pending') })), 'sent');
  assert.equal(familyState(view({ sent: sent('declined') })), 'declined');
  assert.equal(familyState(view({ sent: sent('expired') })), 'expired');
  assert.equal(familyState(view({ received: [req], sent: sent('pending') })), 'received');
  assert.equal(familyState(view({ received: [req], sent: sent('declined') })), 'received');
  const two = [{ userId: 'a', displayName: 'x', me: true }, { userId: 'b', displayName: 'y', me: false }];
  assert.equal(familyState(view({ adults: two, received: [req], sent: sent('pending') })), 'linked');
});

test('limit at 20', () => {
  const kids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, firstName: 'נ', gender: 'f' as const }));
  assert.equal(canAddChild(view({ children: kids(19) })), true);
  assert.equal(canAddChild(view({ children: kids(20) })), false);
});

const tr = (key: string, p?: Record<string, string | number>) => (key === 'compose.familyAnd' ? `${p!.a} ו${p!.b}` : key);
const fam = (familyId: string, name: string, firstNames: string[]) => ({ familyId, name, firstNames, targetMemberId: `m-${familyId}` });

test('family rows subtitle joins two first names', () => {
  const rows = familyRows([fam('f1', 'בדיוני', ['דנה', 'יוסי']), fam('f2', 'בן דמיון', ['רון'])], tr);
  assert.deepEqual(rows, [{ id: 'f1', title: 'בדיוני', subtitle: 'דנה ויוסי' }, { id: 'f2', title: 'בן דמיון', subtitle: 'רון' }]);
});

test('family rows sorted by name', () => {
  const rows = familyRows([fam('f3', 'ניסיון', ['א']), fam('f1', 'אלמוני', ['ב']), fam('f2', 'בדיוני', ['ג'])], tr);
  assert.deepEqual(rows.map(r => r.id), ['f1', 'f2', 'f3']);
});

test('family search matches the name and any adult first name', () => {
  const l = [fam('f1', 'בדיוני', ['דנה', 'יוסי']), fam('f2', 'בן דמיון', ['רון'])];
  assert.deepEqual(filterFamilies(l, ' יוס ').map(f => f.familyId), ['f1']);
  assert.deepEqual(filterFamilies(l, 'דמיון').map(f => f.familyId), ['f2']);
  assert.equal(filterFamilies(l, '').length, 2);
});
