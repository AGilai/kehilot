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
