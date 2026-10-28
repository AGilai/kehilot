import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channelLabel, channelSaveName } from '../src/client/channelsView.ts';
import { contentDir } from '../src/i18n/direction.ts';
import { translate } from '../src/i18n/translate.ts';
import { displayDate, hebrewDate } from '../src/dates.ts';
import { readFileSync } from 'node:fs';

const he = JSON.parse(readFileSync(new URL('../src/i18n/he.json', import.meta.url), 'utf8'));
const en = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8'));
const tHe = (k: string, p?: Record<string, string | number>) => translate(he, he, k, p);
const tEn = (k: string, p?: Record<string, string | number>) => translate(en, he, k, p);

test('channelLabel: the three seeded keys are localised, other names stay as stored', () => {
  assert.equal(channelLabel({ name: 'announcements' }, tHe), 'הודעות הקהילה');
  assert.equal(channelLabel({ name: 'simchas' }, tHe), 'שמחות');
  assert.equal(channelLabel({ name: 'condolences' }, tHe), 'אבלות');
  assert.equal(channelLabel({ name: 'simchas' }, tEn), 'Simchas');
  assert.equal(channelLabel({ name: 'Announcements' }, tEn), 'Announcements');
  assert.equal(channelLabel({ name: 'שיחת נשים' }, tEn), 'שיחת נשים');
  assert.equal(channelLabel({ name: 'toString' }, tEn), 'toString');
});

test('channelSaveName: an unchanged label keeps the stored key, an edit stores the new text', () => {
  assert.equal(channelSaveName({ name: 'simchas' }, '  שמחות ', tHe), 'simchas');
  assert.equal(channelSaveName({ name: 'simchas' }, 'Simchas', tEn), 'simchas');
  assert.equal(channelSaveName({ name: 'simchas' }, 'ימי הולדת', tHe), 'ימי הולדת');
  assert.equal(channelSaveName({ name: 'שיחת נשים' }, 'שיחת נשים', tHe), 'שיחת נשים');
  assert.equal(channelSaveName({ name: 'שיחת נשים' }, ' חדש ', tHe), 'חדש');
});

test('contentDir: first strong letter decides, else the UI direction', () => {
  assert.equal(contentDir('זכרו ברוך.', 'ltr'), 'rtl');
  assert.equal(contentDir('Shabbat dinner', 'rtl'), 'ltr');
  assert.equal(contentDir('  12:30 ‏שלום', 'ltr'), 'rtl');
  assert.equal(contentDir('"Hello"', 'rtl'), 'ltr');
  assert.equal(contentDir('مرحبا', 'ltr'), 'rtl');
  assert.equal(contentDir('123 !?', 'rtl'), 'rtl');
  assert.equal(contentDir('', 'ltr'), 'ltr');
});

test('translate isolates string parameters, leaves numbers alone', () => {
  assert.equal(translate({ a: 'Hi {name}' }, {}, 'a', { name: 'דנה' }), 'Hi ⁨דנה⁩');
  assert.equal(translate({ a: '{n} items' }, {}, 'a', { n: 3 }), '3 items');
});

test('dates follow the UI language; the Hebrew date is in letters', () => {
  assert.equal(displayDate('2026-10-27', 'en'), 'Tuesday, 16 Cheshvan (27.10)');
  assert.equal(displayDate('2026-10-27', 'he'), 'יום ג׳, ט״ז בחשוון (27.10)');
  assert.equal(hebrewDate('2026-10-27', 'he'), 'ט״ז בחשוון תשפ״ז');
  assert.equal(hebrewDate('2026-10-27', 'en'), '16 Cheshvan 5787');
});
