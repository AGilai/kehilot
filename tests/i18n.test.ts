import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  assert.equal(translate({}, { a: 'שלום {name}' }, 'a', { name: 'דנה' }), 'שלום \u2068דנה\u2069');
  assert.equal(translate({ a: 'Hi {name}' }, { a: 'שלום' }, 'a', { name: 'Dana' }), 'Hi \u2068Dana\u2069');
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

test('every error code the server source raises, and every AuthError code in src, has an errors.<code> key', () => {
  const INTERNAL = new Set(['witness_changed']); // never reaches a client
  const codes = new Set<string>();
  const walk = (dir: URL, out: string[], ext: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(new URL(`${e.name}/`, dir), out, ext);
      else if (e.name.endsWith(ext)) out.push(fileURLToPath(new URL(e.name, dir)));
    }
  };
  const py: string[] = []; walk(new URL('../server/cloud/', import.meta.url), py, '.py');
  for (const f of py) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/ApiError\(\d+, *'([a-z0-9_]+)'/g)) codes.add(m[1]!);
    for (const m of src.matchAll(/'(invalid_[a-z0-9_]+)'/g)) codes.add(m[1]!);
    // inputs.text(d, 'firstName', ...) fails with invalid_first_name
    for (const m of src.matchAll(/(?:inputs\.\w+\(\w+|_code\()\s*,?\s*'([A-Za-z]+)'/g)) codes.add('invalid_' + m[1]!.replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase());
  }
  const ts: string[] = []; walk(new URL('../src/', import.meta.url), ts, '.ts'); walk(new URL('../src/', import.meta.url), ts, '.tsx');
  for (const f of ts) for (const m of readFileSync(f, 'utf8').matchAll(/AuthError\('([a-z_]+)'\)/g)) codes.add(m[1]!);
  assert.ok(codes.size > 40, `parsed ${codes.size} codes`);
  assert.ok(codes.has('invalid_conversation') && codes.has('unsupported'));
  const fh = flat(he), fe = flat(en);
  for (const c of codes) {
    if (INTERNAL.has(c)) continue;
    assert.ok(fh[`errors.${c}`], `he errors.${c}`);
    assert.ok(fe[`errors.${c}`], `en errors.${c}`);
  }
});

test('he.json and en.json have no duplicate keys at any level', () => {
  for (const file of ['he.json', 'en.json']) {
    const raw = readFileSync(new URL('../src/i18n/' + file, import.meta.url), 'utf8');
    const stack: Array<Set<string> | null> = [];
    const dups: string[] = [];
    const re = /"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s"{}\[\]:,]+/g;
    let prev = '', prevPrev = '';
    for (const m of raw.matchAll(re)) {
      const tok = m[0];
      if (tok === '{') stack.push(new Set());
      else if (tok === '[') stack.push(null);
      else if (tok === '}' || tok === ']') stack.pop();
      else if (tok === ':' && prev.startsWith('"')) {
        const top = stack[stack.length - 1];
        if (top) { if (top.has(prev)) dups.push(prev); top.add(prev); }
      }
      prevPrev = prev; prev = tok;
    }
    void prevPrev;
    assert.deepEqual(dups, [], file);
  }
});
