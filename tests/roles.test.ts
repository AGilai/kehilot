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

test('lint: no role comparison with gabbai in src/ (use isManagement)', () => {
  const bad: string[] = [];
  // roles.ts defines the roles; the seat fixtures and `card ===` / `variant ===` compare fixture switches, not roles.
  for (const f of walk('src').filter(f => f !== 'src/client/roles.ts' && !/^src\/seats\/fixture/.test(f))) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/[=!]==\s*'gabbai'|'gabbai'\s*[=!]==|isGabbai/.test(line.replace(/\b(card|variant|screen)\s*===\s*'gabbai'/g, ''))) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});

import { PICKER_ROLES, roleChangeKey } from '../src/client/roles.ts';

test('the picker offers member, tech, gabbai (never listener) and names the change', () => {
  assert.deepEqual([...PICKER_ROLES], ['member', 'tech', 'gabbai']);
  assert.equal(roleChangeKey('tech'), 'admin.role.toTech');
  assert.equal(roleChangeKey('gabbai'), 'admin.role.toGabbai');
  assert.equal(roleChangeKey('member'), 'admin.role.toMember');
});
