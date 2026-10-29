import test from 'node:test';
import assert from 'node:assert/strict';
import { copyToFree, dayOptionLabel, eventWhat, initialUpdateFields, notifyDefault, previewOf, sheetCaption, stripGaps } from '../src/client/composeState.ts';

const built = { title: 'T', body: 'B' };
test('copyToFree copies into empty free fields', () => {
  const r = copyToFree({ title: '', body: '', lastCopied: null }, built);
  assert.deepEqual(r, { title: 'T', body: 'B', lastCopied: built, copied: true });
});
test('copyToFree keeps what the person edited', () => {
  const r = copyToFree({ title: 'mine', body: '', lastCopied: null }, built);
  assert.equal(r.copied, false);
  assert.equal(r.title, 'mine');
  assert.equal(r.lastCopied, null);
});
test('copyToFree re-copies when both still equal the last copy', () => {
  const r = copyToFree({ title: 'old', body: 'older', lastCopied: { title: 'old', body: 'older' } }, built);
  assert.deepEqual(r, { title: 'T', body: 'B', lastCopied: built, copied: true });
});
test('copyToFree keeps when only one equals the last copy', () => {
  const r = copyToFree({ title: 'old', body: 'edited', lastCopied: { title: 'old', body: 'older' } }, built);
  assert.equal(r.copied, false);
});
test('sheetCaption', () => {
  assert.equal(sheetCaption('gabbai', 'approve', 'celebration'), 'sheetAuto');
  assert.equal(sheetCaption('tech', 'approve', 'condolence'), 'sheetAuto');
  assert.equal(sheetCaption('member', 'approve', 'celebration'), 'sheetPending');
  assert.equal(sheetCaption('member', undefined, 'event'), 'sheetPending');
  assert.equal(sheetCaption('member', 'auto', 'celebration'), 'sheetAuto');
  assert.equal(sheetCaption('gabbai', 'approve', 'general'), null);
  assert.equal(sheetCaption('member', 'auto', 'weekly'), null);
});

test('previewOf names the missing fields instead of breaking', () => {
  const label = (k: string) => ({ date: 'יום ותאריך', time: 'שעה', place: 'מקום', name: 'שם האירוע' }[k] ?? k);
  const p = previewOf('event', { name: 'ערב לימוד', for: 'all' }, 'he', label);
  assert.deepEqual(p.missing, ['date', 'time', 'place']);
  assert.equal(p.title, 'ערב לימוד');
  assert.match(p.body, /‹יום ותאריך›, בשעה ‹שעה› · ‹מקום›/);
  assert.ok(!p.body.includes('2000'));
});
test('previewOf with nothing filled does not throw for any template', () => {
  for (const id of ['event', 'mazal', 'condolence'] as const) {
    const p = previewOf(id, {}, 'he', k => k);
    assert.ok(p.missing.length > 0);
    assert.ok(!p.body.includes('tpl.'));
  }
});
test('previewOf of a complete form has no missing fields', () => {
  const p = previewOf('event', { name: 'א', date: '2026-11-03', time: '20:30', place: 'בית הכנסת', for: 'women' }, 'he', k => k);
  assert.deepEqual(p.missing, []);
  assert.match(p.body, /20:30/);
});

test('dayOptionLabel is Hebrew first with the Gregorian date in brackets', () => {
  assert.equal(dayOptionLabel('2026-11-09', 'he'), 'ב׳, כ״ט בחשוון (9.11)');
});
test('stripGaps empties the placeholders', () => {
  assert.equal(stripGaps('בשעה ‹שעה› · ‹מקום›.'), 'בשעה  · .');
});

// Update mode (Task 10) ---------------------------------------------------------------------------------------------
const base = { messageId: 'M', channelId: 'C', title: 'T', body: 'B', authorId: 'a', authorName: 'n', authorKind: 'member' as const, joinCount: 0 };
test('initialUpdateFields: a templated message keeps its fields, a condolence goes to full', () => {
  const ev = { ...base, type: 'event' as const, templateId: 'event' as const, fields: { name: 'ערב', date: '2026-11-03', time: '20:30', place: 'א', for: 'all' } };
  assert.deepEqual(initialUpdateFields(ev), ev.fields);
  const co = { ...base, type: 'condolence' as const, templateId: 'condolence' as const, fields: { variant: 'later', surname: 'ניסיון', deceased: 'א', relation: 'ב' } };
  assert.deepEqual(initialUpdateFields(co), { ...co.fields, variant: 'full' });
});
test('initialUpdateFields: free-text condolence and event', () => {
  assert.deepEqual(initialUpdateFields({ ...base, type: 'condolence', targetName: 'דוגמה' }), { variant: 'full', surname: 'דוגמה' });
  assert.deepEqual(initialUpdateFields({ ...base, type: 'condolence' }), { variant: 'full', surname: '' });
  assert.deepEqual(initialUpdateFields({ ...base, type: 'event', title: 'שיעור' }), { name: 'שיעור' });
});
test('notifyDefault: condolence', () => {
  const full = { variant: 'full', surname: 'ס', address: 'א' };
  assert.equal(notifyDefault({ variant: 'later' }, full, 'condolence'), true);
  assert.equal(notifyDefault({ variant: 'only' }, full, 'condolence'), true);
  assert.equal(notifyDefault({}, full, 'condolence'), true);
  assert.equal(notifyDefault(full, { ...full, address: 'ב' }, 'condolence'), false);
  assert.equal(notifyDefault({ variant: 'later' }, { variant: 'later' }, 'condolence'), false);
});
test('notifyDefault: event', () => {
  const e = { name: 'ערב', date: '2026-11-03', time: '20:30', place: 'א', more: 'x' };
  assert.equal(notifyDefault(e, { ...e, time: '21:00' }, 'event'), true);
  assert.equal(notifyDefault(e, { ...e, date: '2026-11-04' }, 'event'), true);
  assert.equal(notifyDefault(e, { ...e, place: 'ב' }, 'event'), true);
  assert.equal(notifyDefault(e, { ...e, more: 'y' }, 'event'), false);
  assert.equal(notifyDefault(e, { ...e, cancelled: true }, 'event'), true);
  assert.equal(notifyDefault({ ...e, cancelled: true }, { ...e, cancelled: true }, 'event'), false);
  assert.equal(notifyDefault({ name: 'ערב' }, e, 'event'), true);
});
test('eventWhat', () => {
  const e = { name: 'ערב', date: '2026-11-03', time: '20:30', place: 'א' };
  assert.equal(eventWhat(e, { ...e, time: '21:00' }, 'בוטל', 'he'), 'בשעה 21:00');
  assert.equal(eventWhat(e, { ...e, cancelled: true }, 'בוטל', 'he'), 'בוטל');
  assert.equal(eventWhat(e, e, 'בוטל', 'he'), '');
});
