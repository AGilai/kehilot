import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportState, needsFreshLink } from '../src/client/exportView.ts';

const link = { url: 'https://files.example.org/x.zip', expiresAt: 1000 };

test('a link is ready', () => { assert.equal(exportState({ link }), 'ready'); });
test('404 is idle', () => { assert.equal(exportState({ code: 'export_not_found' }), 'idle'); });
test('429 is limit', () => { assert.equal(exportState({ code: 'export_limit' }), 'limit'); });
test('other errors fail', () => {
  assert.equal(exportState({ code: 'network' }), 'failed');
  assert.equal(exportState({ code: 'internal' }), 'failed');
});
test('link near expiry needs a fresh one', () => {
  assert.equal(needsFreshLink(link, 900), false);
  assert.equal(needsFreshLink(link, 969), false);
  assert.equal(needsFreshLink(link, 970), true);
  assert.equal(needsFreshLink(link, 2000), true);
});
