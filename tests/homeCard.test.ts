import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickHomeCard } from '../src/client/homeCard.ts';
import type { HomeCards } from '../src/client/types.ts';

const none: HomeCards = { gabbaiLink: null, request: null, imported: false, phoneAsk: false, terms: false };
const all: HomeCards = { gabbaiLink: { gabbaiName: 'א', partnerName: 'ב' }, request: { fromUserId: 'u', fromName: 'ב' }, imported: true, phoneAsk: true, terms: true };

test('priority order', () => {
  assert.equal(pickHomeCard(all, 'gabbai'), 'gabbaiLink');
  assert.equal(pickHomeCard({ ...all, gabbaiLink: null }, 'gabbai'), 'request');
  assert.equal(pickHomeCard({ ...all, gabbaiLink: null, request: null }, 'gabbai'), 'imported');
  assert.equal(pickHomeCard({ ...all, gabbaiLink: null, request: null, imported: false }, 'gabbai'), 'terms');
  assert.equal(pickHomeCard({ ...none, phoneAsk: true, terms: true }, 'gabbai'), 'terms');
  assert.equal(pickHomeCard({ ...none, phoneAsk: true }, 'gabbai'), 'phone');
});

test('listener never gets phone or terms', () => {
  assert.equal(pickHomeCard({ ...none, phoneAsk: true, terms: true }, 'listener'), null);
  assert.equal(pickHomeCard({ ...none, imported: true, phoneAsk: true }, 'listener'), 'imported');
});

test('member never gets terms', () => {
  assert.equal(pickHomeCard({ ...none, terms: true }, 'member'), null);
  assert.equal(pickHomeCard({ ...none, terms: true, phoneAsk: true }, 'member'), 'phone');
});

test('none when nothing pending', () => {
  for (const r of ['listener', 'member', 'gabbai'] as const) assert.equal(pickHomeCard(none, r), null);
});

test('seat-link notice: after the import notice, before terms and phone, members and gabbaim only', () => {
  const link = { seats: 2, at: 1_780_000_000 };
  assert.equal(pickHomeCard({ ...none, seatLink: link, phoneAsk: true }, 'member'), 'seatLink');
  assert.equal(pickHomeCard({ ...none, seatLink: link, terms: true }, 'gabbai'), 'seatLink');
  assert.equal(pickHomeCard({ ...none, seatLink: link, imported: true }, 'member'), 'imported');
  assert.equal(pickHomeCard({ ...none, seatLink: link }, 'listener'), null);
  assert.equal(pickHomeCard({ ...none, seatLink: { seats: 0, at: 1 } }, 'member'), null);
  assert.equal(pickHomeCard({ ...none, seatLink: null }, 'member'), null);
});
