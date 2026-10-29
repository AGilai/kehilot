import test from 'node:test';
import assert from 'node:assert/strict';
import { linkModel, linkChanged, figureLink } from '../src/client/linking.ts';
import type { FamilyView } from '../src/client/types.ts';

const base = (o: Partial<FamilyView> = {}): FamilyView => ({
  familyId: 'f', name: 'x', adults: [{ userId: 'u1', displayName: 'דנה בדיוני', me: true }], children: [], sent: null, received: [], notice: null, ...o,
});
const partner = { userId: 'u2', displayName: 'יוסי בדיוני', me: false };

test('no view: nothing is shown and nothing can be requested', () => {
  const m = linkModel(null);
  assert.deepEqual(m, { slot: { kind: 'empty' }, banner: null, linkedName: null, canRequest: false });
});
test('alone: empty slot, request possible, no banner', () => {
  const m = linkModel(base());
  assert.deepEqual(m.slot, { kind: 'empty' }); assert.equal(m.banner, null); assert.equal(m.canRequest, true);
});
test('sent pending: the slot carries the name and expiry', () => {
  const m = linkModel(base({ sent: { toUserId: 'u3', toName: 'נועה משל', expiresAt: 100, state: 'pending' } }));
  assert.deepEqual(m.slot, { kind: 'pending', name: 'נועה משל', expiresAt: 100 }); assert.equal(m.banner, null);
});
test('received: a banner with the first request; the slot stays empty', () => {
  const m = linkModel(base({ received: [{ fromUserId: 'u9', fromName: 'נועה משל', expiresAt: 5 }, { fromUserId: 'u8', fromName: 'אחר', expiresAt: 5 }] }));
  assert.deepEqual(m.banner, { kind: 'received', fromUserId: 'u9', name: 'נועה משל' }); assert.deepEqual(m.slot, { kind: 'empty' });
});
test('received: no new request is offered while one waits', () => {
  assert.equal(linkModel(base({ received: [{ fromUserId: 'u9', fromName: 'א', expiresAt: 5 }] })).canRequest, false);
});
test('figureLink: a spouse figure without an account offers invite / shows the pending request', () => {
  const spouse = { relation: 'spouse' };
  assert.deepEqual(figureLink(linkModel(base()), spouse), { kind: 'invite' });
  assert.deepEqual(figureLink(linkModel(base({ sent: { toUserId: 'u3', toName: 'נועה', expiresAt: 7, state: 'pending' } })), spouse), { kind: 'pending', name: 'נועה', expiresAt: 7 });
  assert.deepEqual(figureLink(linkModel(base({ sent: { toUserId: 'u3', toName: 'נועה', expiresAt: 1, state: 'declined' } })), spouse), { kind: 'invite' });
});
test('figureLink: nothing for a linked account, other relations, a waiting received request, or no view', () => {
  const m = linkModel(base());
  assert.deepEqual(figureLink(m, { relation: 'spouse', userId: 'u2' }), { kind: 'none' });
  assert.deepEqual(figureLink(m, { relation: 'child' }), { kind: 'none' });
  assert.deepEqual(figureLink(m, { relation: 'self' }), { kind: 'none' });
  assert.deepEqual(figureLink(linkModel(base({ received: [{ fromUserId: 'u9', fromName: 'א', expiresAt: 5 }] })), { relation: 'spouse' }), { kind: 'none' });
  assert.deepEqual(figureLink(linkModel(null), { relation: 'spouse' }), { kind: 'none' });
});
test('received wins over a pending sent request (same priority as the old card)', () => {
  const m = linkModel(base({ received: [{ fromUserId: 'u9', fromName: 'א', expiresAt: 5 }], sent: { toUserId: 'u3', toName: 'ב', expiresAt: 1, state: 'pending' } }));
  assert.equal(m.banner?.kind, 'received'); assert.equal(m.slot.kind, 'empty');
});
test('declined and expired: a banner, the slot is empty again', () => {
  for (const state of ['declined', 'expired'] as const) {
    const m = linkModel(base({ sent: { toUserId: 'u3', toName: 'נועה משל', expiresAt: 1, state } }));
    assert.deepEqual(m.banner, { kind: state, name: 'נועה משל' }); assert.deepEqual(m.slot, { kind: 'empty' }); assert.equal(m.canRequest, true);
  }
});
test('linked: partner name for the unlink confirm, no banner, no request', () => {
  const m = linkModel(base({ adults: [{ userId: 'u1', displayName: 'דנה', me: true }, partner], received: [{ fromUserId: 'u9', fromName: 'א', expiresAt: 5 }] }));
  assert.equal(m.linkedName, 'יוסי בדיוני'); assert.equal(m.banner, null); assert.equal(m.canRequest, false); assert.deepEqual(m.slot, { kind: 'empty' });
});
test('linkChanged: a new or gone adult means the tree must reload', () => {
  const a = base(); const b = base({ adults: [...a.adults, partner] });
  assert.equal(linkChanged(null, b), false); assert.equal(linkChanged(a, a), false);
  assert.equal(linkChanged(a, b), true); assert.equal(linkChanged(b, a), true);
});
