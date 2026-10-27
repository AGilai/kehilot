import assert from 'node:assert/strict';
import { test } from 'node:test';
import { healingPrayersHtml } from '../src/healingPrayersReport.ts';
import type { HealingPrayer } from '../src/types.ts';

const now = new Date('2026-10-27T12:00:00Z');
const entry: HealingPrayer = { id: 'private-request-id', memberId: 'private-member-id', memberName: 'שם המוסיף הפרטי', name: 'משה בן שרה', addedOn: '2020-01-02' };

test('healing printout preserves every request but includes only prayer names and the print date', () => {
  const html = healingPrayersHtml([entry, { ...entry, id: 'another-request', memberId: null, rosterPersonId: 'private-roster-id', name: 'מרים בת חנה' }, { ...entry, id: 'same-name-other-member', memberId: null, unmatchedSubmitter: true }], false, now);
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.ok(html.includes('27-10-2026'));
  assert.ok(html.includes('3 שמות'));
  assert.equal((html.match(/<li>/g) || []).length, 3);
  assert.equal((html.match(/<li>משה בן שרה<\/li>/g) || []).length, 2);
  assert.ok(html.includes('<li>מרים בת חנה</li>'));
  for (const privateValue of [entry.id, entry.memberId, entry.memberName, entry.addedOn, 'private-roster-id']) {
    if (privateValue) assert.ok(!html.includes(privateValue));
  }
});

test('healing printout escapes arbitrary prayer text and supports empty lists without external resources', () => {
  const html = healingPrayersHtml([{ ...entry, name: '<img src=x onerror="alert(1)"> &\nשרה' }], true, now);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp;<br>שרה'));
  assert.ok(!/<script|<iframe|<link|<img|https?:\/\//i.test(html));
  const empty = healingPrayersHtml([], false, now);
  assert.ok(empty.includes('אין כרגע שמות למי שברך לחולים.'));
  assert.ok(!empty.includes('<li>'));
});
