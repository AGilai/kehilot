import assert from 'node:assert/strict';
import { test } from 'node:test';
import { singleFlight } from '../src/client/singleFlight.ts';

test('a second call before the first finishes does not run again', async () => {
  let runs = 0; let release!: () => void;
  const run = singleFlight(() => { runs++; return runs === 1 ? new Promise<void>(r => { release = r; }) : Promise.resolve(); });
  const a = run(); const b = run();
  assert.equal(runs, 1);
  release(); await a; await b;
  await run();
  assert.equal(runs, 2); // free again afterwards
});

test('the guard is released after a failure', async () => {
  let runs = 0;
  const run = singleFlight(async () => { runs++; throw new Error('x'); });
  await run().catch(() => {}); await run().catch(() => {});
  assert.equal(runs, 2);
});

test('keyedFlight: the same key cannot double-fire, other keys proceed', async () => {
  const { keyedFlight } = await import('../src/client/singleFlight.ts');
  const run = keyedFlight();
  let runs = 0; let release!: () => void;
  const a = run('u1', () => { runs++; return new Promise<void>(r => { release = r; }); });
  const b = run('u1', async () => { runs++; });
  const c = run('u2', async () => { runs++; });
  await b; await c;
  assert.equal(runs, 2);
  release(); await a;
  await run('u1', async () => { runs++; });
  assert.equal(runs, 3);
});
