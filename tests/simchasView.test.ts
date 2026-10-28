import assert from 'node:assert/strict';
import { test } from 'node:test';
import { counts, filterWeeks, mazalDraft, needsCheck, nextSimcha, quietNames, sheetItemsFor, sheetWeekOf, simchaSub, simchaTag, simchaTitle, weekHeader } from '../src/client/simchasView.ts';
import type { SimchaWeek } from '../src/client/types.ts';

// All names are invented.
const dict: Record<string, string> = {
  'simchas.bar': 'בר מצווה · {name}', 'simchas.bat': 'בת מצווה · {name}', 'simchas.family': 'משפחת {surname}', 'simchas.onShabbat': 'בשבת',
  'simchas.onDay': 'יום {day} {hebrew}, {date}', 'simchas.manual': 'נקבע ידנית', 'simchas.suggested': 'הצעה', 'simchas.draftTitle': 'מזל טוב',
};
const t = (key: string, params: Record<string, string | number> = {}) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(params[n]));
const week = (n: number, shabbat: string, parasha: string, items: SimchaWeek['items'] = [], label = `שבת פרשת ${parasha}`): SimchaWeek => ({ week: `w${n}`, shabbat, parasha, label, items });
const hillel = { kind: 'bar' as const, firstName: 'הלל', surname: 'דוגמה', date: '2026-10-31', manual: false };
const noga = { kind: 'bat' as const, firstName: 'נגה', surname: 'ניסיון', date: '2026-11-09', manual: false };
const weeks = [week(0, '2026-10-31', 'וירא', [hillel]), week(1, '2026-11-07', 'חיי שרה'), week(2, '2026-11-14', 'תולדות', [noga]), week(3, '2026-12-05', '', [], 'שבת חנוכה')];

test('filterWeeks keeps only weeks with matching items', () => {
  assert.deepEqual(filterWeeks(weeks, 'all').map(w => w.week), ['w0', 'w2']);
  assert.deepEqual(filterWeeks(weeks, 'bat').map(w => w.week), ['w2']);
  assert.deepEqual(filterWeeks(weeks, 'bar').flatMap(w => w.items.map(i => i.firstName)), ['הלל']);
});

test('counts and the quiet line follow the filter', () => {
  assert.deepEqual(counts(weeks), { all: 2, bar: 1, bat: 1 });
  assert.equal(quietNames(weeks, 'all'), 'חיי שרה, חנוכה');
  assert.equal(quietNames(weeks, 'bat'), 'וירא, חיי שרה, חנוכה');
  assert.equal(quietNames(weeks.slice(0, 1), 'all'), '');
});

test('rows: titles, sub lines, tags', () => {
  assert.equal(simchaTitle(hillel, t), 'בר מצווה · הלל');
  assert.equal(simchaSub(hillel, t), 'משפחת דוגמה · בשבת');
  assert.equal(simchaSub(noga, t), 'משפחת ניסיון · יום ב׳ כ״ט בחשון, 9.11');
  assert.deepEqual(simchaTag(hillel, t), { text: 'הצעה', manual: false });
  assert.deepEqual(simchaTag({ ...hillel, manual: true }, t), { text: 'נקבע ידנית', manual: true });
  assert.equal(simchaTag(noga, t), undefined);
});

test('week header shows the label, Hebrew date and the Gregorian day', () => {
  assert.deepEqual(weekHeader(weeks[0]!), { title: 'שבת פרשת וירא · כ׳ בחשון', greg: '31.10' });
});

test('overview summary: nearest simcha, the rest, this week or later', () => {
  assert.deepEqual(nextSimcha(weeks), { item: hillel, more: 1, thisWeek: true });
  assert.deepEqual(nextSimcha(weeks.slice(2)), { item: noga, more: 0, thisWeek: true });
  assert.equal(nextSimcha(weeks.slice(1, 2)), undefined);
  assert.equal(nextSimcha(weeks.slice(1))?.thisWeek, false);
});

test('mazal tov draft is for one simcha and one family only', () => {
  const d = mazalDraft({ ...hillel, familyId: 'F1' }, t);
  assert.deepEqual(d, { title: 'מזל טוב · בר מצווה · הלל', body: '', familyId: 'F1', note: 'simchas.suggestedNote' });
  assert.equal(JSON.stringify(d).includes('נגה'), false);
  assert.deepEqual(mazalDraft({ ...hillel, manual: true }, t), { title: 'מזל טוב · בר מצווה · הלל', body: '' });
  assert.equal(mazalDraft({ ...noga, familyId: 'F2' }, t).note, undefined);
  assert.equal(needsCheck(hillel), true);
  assert.equal(needsCheck(noga), false);
});

test('sheetItemsFor: one gabbai celebration per simcha, surname bold, in the Friday before the Shabbat', () => {
  const w = week(0, '2026-10-31', 'וירא', [hillel, { ...noga, date: '2026-10-29' }]);
  assert.deepEqual(sheetItemsFor(w), [
    { type: 'celebration', text: 'מזל טוב למשפחת דוגמה\nלבר המצווה של הלל', bold: 'דוגמה', source: 'byGabbai' },
    { type: 'celebration', text: 'מזל טוב למשפחת ניסיון\nלבת המצווה של נגה', bold: 'ניסיון', source: 'byGabbai' },
  ]);
  assert.deepEqual(sheetItemsFor(week(1, '2026-11-07', 'חיי שרה')), []);
  assert.equal(sheetWeekOf(w), '2026-10-30');
});
