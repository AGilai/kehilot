// Ported from origin/main 6d74d0e tests/aliyot.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aliyahCalls, aliyahChoices, aliyahLabel, aliyahSlots, FESTIVAL_READINGS } from '../src/aliyot/aliyot.ts';
import type { AliyahTemplate, RosterPerson } from '../src/aliyot/types.ts';

const template: AliyahTemplate = { date: '2026-10-24', reading: 'לך לך', regularCount: 7, allowExtra: true, slots: [
  { position: 'כהן', tribe: 'kohen' }, { position: 'לוי', tribe: 'levi' },
  ...Array.from({ length: 5 }, (_, index) => ({ position: `ישראל ${index + 1}`, tribe: 'yisrael' as const })), { position: 'מפטיר', tribe: null },
] };
test('extra aliyot are inserted before maftir and prohibited on festivals', () => {
  assert.deepEqual(aliyahSlots(template, 0), template.slots);
  assert.deepEqual(aliyahSlots(template, 2).slice(-3).map(slot => slot.position), ['ישראל 6', 'ישראל 7', 'מפטיר']);
  for (const value of [-1, 0.5, 93]) assert.throws(() => aliyahSlots(template, value));
  assert.throws(() => aliyahSlots({ ...template, allowExtra: false }, 1));
});
test('aliyiot require every slot and store guests without inventing person identities', () => {
  assert.throws(() => aliyahCalls(template.slots, {}));
  const choices = Object.fromEntries(template.slots.map(slot => [slot.position, 'guest']));
  choices['כהן'] = 'person:permanent-person-id';
  const calls = aliyahCalls(template.slots, choices);
  assert.deepEqual(calls[0], { position: 'כהן', personId: 'permanent-person-id' });
  assert.deepEqual(calls[1], { position: 'לוי', guest: true });
  assert.equal(calls.length, 8);
  choices['כהן'] = 'person:guest';
  assert.deepEqual(aliyahCalls(template.slots, choices)[0], { position: 'כהן', personId: 'guest' });
});
test('person pickers filter status while maftir permits every tribe and every slot offers a guest', () => {
  const people = ['kohen', 'levi', 'yisrael'].map(tribe => ({ id: tribe, name: tribe, tribe })) as RosterPerson[];
  assert.deepEqual(aliyahChoices(template.slots[0]!, people).map(option => option.value), ['', 'guest', 'person:kohen']);
  assert.deepEqual(aliyahChoices(template.slots.at(-1)!, people).map(option => option.value), ['', 'guest', 'person:kohen', 'person:levi', 'person:yisrael']);
});

test('Hebrew ordinal labels cover ordinary and extra aliyot while preserving stored position keys', () => {
  const extended = aliyahSlots(template, 5);
  assert.deepEqual(extended.map(slot => aliyahLabel(slot.position)), ['כהן', 'לוי', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי', 'אחד עשר', 'שנים עשר', 'מפטיר']);
  const selected = Object.fromEntries(extended.map(slot => [slot.position, 'guest']));
  assert.deepEqual(aliyahCalls(extended, selected).map(call => call.position), extended.map(slot => slot.position));
  assert.equal(aliyahLabel('ישראל 19'), 'עשרים ואחד');
  assert.equal(aliyahLabel('ישראל 97'), 'תשעים ותשעה');
  assert.equal(aliyahLabel('ראשון'), 'ראשון');
});

test('extra Shabbat slots permit Kohanim and Leviim while ordinary Israel slots retain their filter', () => {
  const people = ['kohen', 'levi', 'yisrael'].map(tribe => ({ id: tribe, name: tribe, tribe })) as RosterPerson[];
  const extra = aliyahSlots(template, 2).slice(-3, -1);
  assert.deepEqual(extra.map(slot => slot.tribe), [null, null]);
  assert.deepEqual(aliyahChoices(extra[0]!, people).map(option => option.value), ['', 'guest', 'person:kohen', 'person:levi', 'person:yisrael']);
  assert.deepEqual(aliyahChoices(template.slots[2]!, people).map(option => option.value), ['', 'guest', 'person:yisrael']);
});
test('Yom Kippur morning and afternoon readings are separate choices', () => {
  assert.ok(FESTIVAL_READINGS.includes('יום כיפור - שחרית'));
  assert.ok(FESTIVAL_READINGS.includes('יום כיפור - מנחה'));
  const mincha: AliyahTemplate = { date: '2026-09-21', service: 'mincha', reading: 'יום כיפור - מנחה', regularCount: 3, allowExtra: false, slots: [{ position: 'כהן', tribe: 'kohen' }, { position: 'לוי', tribe: 'levi' }, { position: 'ישראל 1', tribe: 'yisrael' }] };
  assert.deepEqual(aliyahSlots(mincha, 0).map(slot => aliyahLabel(slot.position)), ['כהן', 'לוי', 'שלישי']);
  assert.throws(() => aliyahSlots(mincha, 1));
});
