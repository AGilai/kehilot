import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { MANAGEMENT, ROLES, isManagement, roleLabel } from '../src/client/roles.ts';

// All names are invented.
test('MANAGEMENT matches server/cloud/authz.py', () => {
  const src = readFileSync('server/cloud/authz.py', 'utf8');
  const decl = src.match(/^([A-Z, ]+)=\s*((?:'[a-z]+',?\s*)+)$/m)!;
  const keys = decl[1]!.split(',').map(s => s.trim()).filter(Boolean);
  const vals = [...decl[2]!.matchAll(/'([a-z]+)'/g)].map(m => m[1]!);
  const consts: Record<string, string> = Object.fromEntries(keys.map((k, i) => [k, vals[i]!]));
  const line = src.match(/^MANAGEMENT\s*=\s*\(([^)]*)\)/m)![1]!;
  const names = line.split(',').map(s => s.trim()).filter(Boolean);
  const server = names.map(n => consts[n] ?? n.replace(/'/g, ''));
  assert.deepEqual([...MANAGEMENT], server);
});

test('isManagement: gabbai and tech, nobody else', () => {
  assert.equal(isManagement('gabbai'), true);
  assert.equal(isManagement('tech'), true);
  assert.equal(isManagement('member'), false);
  assert.equal(isManagement('listener'), false);
  assert.equal(isManagement(undefined), false);
  assert.equal(isManagement(null), false);
});

test('ROLES lists the four roles', () => {
  assert.deepEqual([...ROLES], ['listener', 'member', 'gabbai', 'tech']);
});

test('roleLabel: tech is טכני / Tech, never גבאי', () => {
  assert.equal(roleLabel('tech', 'he'), 'טכני');
  assert.equal(roleLabel('tech', 'en'), 'Tech');
  assert.equal(roleLabel('gabbai', 'he'), 'גבאי');
  assert.equal(roleLabel('gabbai', 'en'), 'Gabbai');
  assert.equal(roleLabel('member', 'he'), 'חבר/ת קהילה');
  assert.equal(roleLabel('listener', 'en'), 'Guest');
});

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

/** A role check on 'gabbai' in any quote style: `==`/`!=`/`===`/`!==`, `case`, `includes(`/`indexOf(`, `['gabbai'].includes(` and `isGabbai`. */
const ROLE_CHECK = /(?:[=!]=+\s*|\b(?:includes|indexOf)\(\s*|\bcase\s+)(['"`])gabbai\1|(['"`])gabbai\2\s*[=!]=|\[[^\]]*(['"`])gabbai\3[^\]]*\]\s*\.\s*(?:includes|indexOf|some)\b|\bisGabbai\b/;

/** The only places a literal 'gabbai' check may stay, by file and exact line count: the definitions in roles.ts and the fixture switches
 * that compare a `card` / `variant` URL value (not a role). A new one anywhere else, or one more in these files, fails. */
const ALLOWED: Record<string, number> = { 'src/client/roles.ts': 3, 'src/client/fixtures.ts': 1, 'src/seats/fixtureSeats.ts': 4 };

test('the role-check detector knows every form', () => {
  for (const line of [`x === 'gabbai'`, `x !== "gabbai"`, `x == 'gabbai'`, `x != "gabbai"`, `'gabbai' === x`, "x === `gabbai`", `['gabbai'].includes(x)`, `['gabbai', 'tech'].indexOf(x)`, `list.includes('gabbai')`, `list.indexOf("gabbai")`, `case 'gabbai':`, `case "gabbai":`, `const isGabbai = 1`]) {
    assert.ok(ROLE_CHECK.test(line), line);
  }
  for (const line of [`role: 'gabbai',`, `type R = 'member' | 'gabbai'`, `by: 'gabbai' as const`, `x === 'gabbaim'`, `isManagement(x)`]) assert.ok(!ROLE_CHECK.test(line), line);
});

test('lint: no role comparison with gabbai in src/ (use isManagement)', () => {
  const bad: string[] = [];
  const counts: Record<string, number> = {};
  for (const f of walk('src')) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!ROLE_CHECK.test(line)) return;
      counts[f] = (counts[f] ?? 0) + 1;
      if (!(f in ALLOWED)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(counts, ALLOWED, 'exemptions are exact: remove an entry when its line goes, never raise a count to fit a new check');
});

import { PICKER_ROLES, roleChangeKey } from '../src/client/roles.ts';

test('the picker offers member, tech, gabbai (never listener) and names the change', () => {
  assert.deepEqual([...PICKER_ROLES], ['member', 'tech', 'gabbai']);
  assert.equal(roleChangeKey('tech'), 'admin.role.toTech');
  assert.equal(roleChangeKey('gabbai'), 'admin.role.toGabbai');
  assert.equal(roleChangeKey('member'), 'admin.role.toMember');
});
