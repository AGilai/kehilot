import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { endpoints } from '../src/client/endpoints.ts';
import { ApiCodeError } from '../src/client/errors.ts';
import type { Http } from '../src/client/http.ts';
import { isVersionConflict, saveTree } from '../src/client/tree.ts';
import type { Person } from '../src/tree/types.ts';

const me: Person = { id: 'me', relation: 'self', gender: 'm', hebrewFirst: 'ישראל' };

test('tree endpoints', async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const http: Http = { async request(method, path, body) { calls.push({ method, path, body }); return undefined as any; } };
  const api = endpoints(http);
  await api.familyTree('K');
  await api.putFamilyTree('K', { people: [me], ifVersion: 3 });
  await api.adminFamilyTree('K', 'F 1');
  assert.deepEqual(calls, [
    { method: 'GET', path: '/v1/kehilot/K/family/tree', body: undefined },
    { method: 'PUT', path: '/v1/kehilot/K/family/tree', body: { people: [me], ifVersion: 3 } },
    { method: 'GET', path: '/v1/kehilot/K/admin/families/F%201/tree', body: undefined },
  ]);
});

test('saveTree: ok returns the new version; 409 reloads and says so; other errors pass through', async () => {
  const ok = await saveTree({ putFamilyTree: async () => ({ version: 5 }), familyTree: async () => { throw new Error('no reload'); } }, 'K', [me], 4);
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.doc.people, ok.doc.version], [[me], 5]);
  const theirs = { people: [{ ...me, hebrewFirst: 'אחר' }], version: 9 };
  const conflict = await saveTree({ putFamilyTree: async () => { throw new ApiCodeError(409, 'version_conflict'); }, familyTree: async () => theirs }, 'K', [me], 4);
  assert.deepEqual(conflict, { ok: false, conflict: true, doc: theirs });
  await assert.rejects(saveTree({ putFamilyTree: async () => { throw new ApiCodeError(400, 'invalid_people'); }, familyTree: async () => theirs }, 'K', [me], 4), /invalid_people/);
  assert.equal(isVersionConflict(new ApiCodeError(409, 'something_else')), false);
});

test('saveTree adopts the people the server returns (with the userIds it assigned) and its updatedAt', async () => {
  const served = [{ ...me, userId: 'U1' }];
  const out = await saveTree({ putFamilyTree: async () => ({ version: 7, people: served, updatedAt: 123 }), familyTree: async () => { throw new Error('no reload'); } }, 'K', [me], 6);
  assert.equal(out.ok, true);
  assert.deepEqual([out.doc.people, out.doc.version, out.doc.updatedAt], [served, 7, 123]);
});

test('he and en have messages for the tree codes the server can answer', () => {
  for (const file of ['he', 'en']) {
    const errors = JSON.parse(readFileSync(new URL(`../src/i18n/${file}.json`, import.meta.url), 'utf8')).errors;
    for (const code of ['generations_limit', 'grandchildren_limit', 'children_limit', 'account_figure', 'invalid_people', 'version_conflict']) assert.ok(errors[code], `${file}: errors.${code}`);
  }
});
