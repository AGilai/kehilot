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
