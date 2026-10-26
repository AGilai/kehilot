import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deviceLang, dirOf, textStart } from '../src/i18n/direction.ts';
import { translate } from '../src/i18n/translate.ts';

const he = JSON.parse(readFileSync(new URL('../src/i18n/he.json', import.meta.url), 'utf8'));
const en = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8'));

function keys(o: unknown, prefix = ''): string[] {
  if (o === null || typeof o !== 'object') return [prefix];
  return Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}
function flat(o: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (v: unknown, p: string) => {
    if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
    else out[p] = String(v);
  };
  walk(o, '');
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]!).sort();

test('he and en have the same keys', () => {
  assert.deepEqual(keys(he).sort(), keys(en).sort());
});

test('every {placeholder} in he exists in en for the same key', () => {
  const fe = flat(en);
  for (const [k, v] of Object.entries(flat(he))) {
    assert.deepEqual(placeholders(fe[k] ?? ''), placeholders(v), k);
  }
});

test('missing key falls back to Hebrew', () => {
  assert.equal(translate({}, { a: 'שלום {name}' }, 'a', { name: 'דנה' }), 'שלום דנה');
  assert.equal(translate({ a: 'Hi {name}' }, { a: 'שלום' }, 'a', { name: 'Dana' }), 'Hi Dana');
  assert.equal(translate({}, {}, 'nope'), 'nope');
});

test('deviceLang picks he only for Hebrew locales', () => {
  assert.equal(deviceLang(['he-IL']), 'he');
  assert.equal(deviceLang(['iw']), 'he');
  assert.equal(deviceLang(['en-US']), 'en');
  assert.equal(deviceLang([]), 'en');
});

test('direction helpers', () => {
  assert.equal(dirOf('he'), 'rtl');
  assert.equal(dirOf('en'), 'ltr');
  assert.equal(textStart('he'), 'right');
  assert.equal(textStart('en'), 'left');
});

test('every API error code in server/API.md has an errors.<code> key', () => {
  const md = readFileSync(new URL('../server/API.md', import.meta.url), 'utf8');
  const section = md.slice(md.indexOf('### Error codes'));
  const codes = new Set<string>();
  for (const line of section.split('\n').filter(l => l.startsWith('|'))) {
    const cells = line.split('|').map(c => c.trim());
    for (const m of (cells[2] ?? '').matchAll(/`([a-z][a-z0-9_]*)`/g)) codes.add(m[1]!);
    if ((cells[2] ?? '').includes('<field>')) for (const m of (cells[3] ?? '').matchAll(/`(invalid_[a-z0-9_]+)`/g)) codes.add(m[1]!);
  }
  for (const m of md.slice(md.indexOf('## v2')).matchAll(/`(invalid_[a-z0-9_]+)`/g)) codes.add(m[1]!);
  assert.ok(codes.size > 30, `parsed ${codes.size} codes`);
  const fh = flat(he), fe = flat(en);
  for (const c of codes) {
    assert.ok(fh[`errors.${c}`], `he errors.${c}`);
    assert.ok(fe[`errors.${c}`], `en errors.${c}`);
  }
});
