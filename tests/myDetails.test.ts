import test from 'node:test';
import assert from 'node:assert/strict';
import { errorsOf, planSteps, saveAll, isDirty } from '../src/client/myDetails.ts';
import type { Executor, Mine, MineDraft, Step } from '../src/client/myDetails.ts';

const cur: Mine = { first: 'דנה', last: 'בדיוני', phone: '+972500000001', showPhone: true };
const same: MineDraft = { first: 'דנה', last: 'בדיוני', phoneText: '050-0000001', showPhone: true };

test('nothing changed: no steps, not dirty', () => {
  assert.deepEqual(planSteps(cur, same), []); assert.equal(isDirty(cur, same), false);
});
test('validation: first name required, too long, bad phone; empty phone is fine', () => {
  assert.deepEqual(errorsOf({ ...same, first: '  ' }), ['firstRequired']);
  assert.deepEqual(errorsOf({ ...same, first: 'א'.repeat(61) }), ['nameLong']);
  assert.deepEqual(errorsOf({ ...same, phoneText: '12' }), ['phoneInvalid']);
  assert.deepEqual(errorsOf({ ...same, phoneText: '' }), []);
  assert.deepEqual(errorsOf(same), []);
});
test('order is name, phone, switch', () => {
  const steps = planSteps(cur, { first: 'דני', last: 'בדיוני', phoneText: '054-1234567', showPhone: false });
  assert.deepEqual(steps.map(s => s.kind), ['profile', 'phone', 'showPhone']);
  assert.deepEqual(steps[1], { kind: 'phone', phone: '+972541234567' });
});
test('removing the number skips the switch', () => {
  assert.deepEqual(planSteps(cur, { ...same, phoneText: '', showPhone: false }), [{ kind: 'phone', phone: null }]);
});
test('a new number with the switch on plans both', () => {
  const steps = planSteps({ ...cur, phone: null, showPhone: false }, { ...same, showPhone: true });
  assert.deepEqual(steps.map(s => s.kind), ['phone', 'showPhone']);
});
test('only the changed parts: name trimmed before comparing', () => {
  assert.deepEqual(planSteps(cur, { ...same, first: ' דנה ' }), []);
  assert.deepEqual(planSteps(cur, { ...same, last: '' }), [{ kind: 'profile', first: 'דנה', last: '' }]);
});

const exec = (log: string[], failOn?: string): Executor => ({
  profile: async () => { log.push('profile'); if (failOn === 'profile') throw new Error('p'); },
  phone: async () => { log.push('phone'); if (failOn === 'phone') throw new Error('ph'); },
  showPhone: async () => { log.push('showPhone'); if (failOn === 'showPhone') throw new Error('s'); },
});
const all: Step[] = [{ kind: 'profile', first: 'a', last: 'b' }, { kind: 'phone', phone: '+972500000009' }, { kind: 'showPhone', show: false }];

test('saveAll: account steps in order, then the tree', async () => {
  const log: string[] = [];
  const r = await saveAll(all, exec(log), async () => { log.push('tree'); return { ok: true }; });
  assert.deepEqual(log, ['profile', 'phone', 'showPhone', 'tree']);
  assert.deepEqual(r, { ok: true, done: ['profile', 'phone', 'showPhone', 'tree'] });
});
test('saveAll: tree unchanged (null) sends only the account steps', async () => {
  const log: string[] = [];
  const r = await saveAll(all.slice(0, 1), exec(log), null);
  assert.deepEqual(log, ['profile']); assert.equal(r.ok, true);
});
test('saveAll: a failing step stops everything after it; the tree is not written', async () => {
  const log: string[] = [];
  const r = await saveAll(all, exec(log, 'phone'), async () => { log.push('tree'); return { ok: true }; });
  assert.deepEqual(log, ['profile', 'phone']);
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.failed, 'phone'); assert.deepEqual(r.done, ['profile']); assert.ok(r.error instanceof Error); }
});
test('saveAll: tree refusal after account steps reports what already went through', async () => {
  const r = await saveAll(all.slice(0, 2), exec([]), async () => ({ ok: false, message: 'conflict' }));
  assert.deepEqual(r, { ok: false, failed: 'tree', done: ['profile', 'phone'], message: 'conflict' });
});
test('saveAll: a thrown tree error is a tree failure too', async () => {
  const r = await saveAll([], exec([]), async () => { throw new Error('net'); });
  assert.equal(r.ok, false); if (!r.ok) { assert.equal(r.failed, 'tree'); assert.deepEqual(r.done, []); }
});
test('retry after partial failure plans only what is still missing', async () => {
  let acct = { ...cur };
  const draft: MineDraft = { first: 'דני', last: 'בדיוני', phoneText: '054-1234567', showPhone: true };
  const ex: Executor = {
    profile: async s => { acct = { ...acct, first: s.first, last: s.last }; },
    phone: async () => { throw new Error('down'); },
    showPhone: async () => {},
  };
  const r1 = await saveAll(planSteps(acct, draft), ex, null);
  assert.equal(r1.ok, false);
  assert.deepEqual(planSteps(acct, draft).map(s => s.kind), ['phone']); // the name is not sent again
});
