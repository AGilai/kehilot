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

// ---- Home seat slot: the card (Thursday, closed) or the row, never both (UX §21.2-21.3)
import he from '../src/i18n/he.json' with { type: 'json' };
import { translate } from '../src/i18n/translate.ts';
import { closedCardText, rowStatus } from '../src/seats/homeText.ts';
import { shabbatEndFor } from '../src/seats/window.ts';
import { cardModel, homeSeatSlot, memberFromWire, rowModel } from '../src/seats/wire.ts';
import type { MemberWire } from '../src/seats/wire.ts';

const tHe = (key: string, params?: Record<string, string | number>) => translate(he, he, key, params).replace(/[⁦-⁩]/g, '').replace(/ /g, ' ');
const frames = (erev: 'kept' | 'released', day: 'kept' | 'released' = 'kept'): MemberWire['frames'] => [{ blockName: 'מרכז', cols: 3, rowFrom: '6', rowTo: '6', rows: [{ label: '6', mine: true, bimah: false, cells: [1, 2, 3].map((k) => ({ kind: 'mine' as const, k, n: 3, state: { erev: k === 1 ? erev : 'kept' as const, day: k === 1 ? day : 'kept' as const } })) }] }];
const wire = (over: Partial<MemberWire> = {}, erev: 'kept' | 'released' = 'kept'): MemberWire => ({ week: '2026-10-30', deadline: '2026-10-30T12:00:00+00:00', open: true, remindable: true, seats: 3, updatedByGabbai: false, answered: { erev: false, day: false }, frames: frames(erev), ...over });
const mem = (over: Partial<MemberWire> = {}, erev: 'kept' | 'released' = 'kept') => memberFromWire(wire(over, erev));
const wed = new Date('2026-10-28T10:00:00Z');
const thu = new Date('2026-10-29T07:00:00Z');
const fri15 = new Date('2026-10-30T13:00:00Z');

test('row: five states with the exact Hebrew status lines', () => {
  const row = (m: ReturnType<typeof mem>) => { const r = rowModel(m)!; return { state: r.state, text: rowStatus(r, tHe, 'he'), pressable: r.pressable }; };
  assert.deepEqual(row(mem()), { state: 'open', text: 'עוד לא עניתם · אפשר עד יום ו׳ 14:00', pressable: true });
  assert.deepEqual(row(mem({ answered: { erev: true, day: true } }, 'released')), { state: 'answered', text: 'עניתם: 1 פנוי לאחרים · אפשר לשנות עד יום ו׳ 14:00', pressable: true });
  assert.equal(row(mem({ answered: { erev: true, day: true } })).text, 'עניתם: כולם מגיעים · אפשר לשנות עד יום ו׳ 14:00');
  assert.deepEqual(row(mem({ answered: { erev: true, day: true }, updatedByGabbai: true })), { state: 'byGabbai', text: 'הגבאי עדכן · אפשר לשנות עד יום ו׳ 14:00', pressable: true });
  assert.deepEqual(row(mem({ open: false })), { state: 'closed', text: 'הטופס נסגר · כל המקומות נשמרו לכם', pressable: true });
  assert.equal(row(mem({ open: false, answered: { erev: true, day: true } }, 'released')).text, 'הטופס נסגר · 1 פנוי לאחרים');
  assert.deepEqual(row(memberFromWire({ week: '2026-10-30', deadline: '2026-10-30T12:00:00+00:00', open: true, remindable: true, seats: 0, hadSeats: true })), { state: 'none', text: 'השבת אין לכם מקומות. לשאלות פנו לגבאי.', pressable: false });
});

test('slot: remindable adult gets the row on a weekday, the card from Thursday 08:00 and after the deadline; never both', () => {
  const m = mem();
  assert.equal(homeSeatSlot(m, wed), 'row');
  assert.equal(homeSeatSlot(m, thu), 'card');
  assert.equal(cardModel(m, thu)!.state, 'ask');
  const closed = mem({ open: false });
  assert.equal(homeSeatSlot(closed, fri15), 'card');
  assert.equal(cardModel(closed, fri15)!.state, 'closed');
  for (const at of [wed, thu, fri15]) assert.equal(!!cardModel(m, at) && homeSeatSlot(m, at) === 'row', false);
});

test('closed card (a): the real closed copy, sent or not sent, and no answer state', () => {
  assert.equal(tHe('seats.card.closedTitle'), 'טופס מקומות לשבת · נסגר');
  const sent = cardModel(mem({ open: false, answered: { erev: true, day: true } }, 'released'), fri15)!;
  assert.equal(sent.state, 'closed');
  assert.equal(closedCardText(sent.summary, tHe), 'שלחתם: 1 פנוי לאחרים. לשינוי פנו לגבאי.');
  const notSent = cardModel(mem({ open: false }), fri15)!;
  assert.equal(notSent.state, 'closed');
  assert.equal(closedCardText(notSent.summary, tHe), 'לא שלחתם השבת. כל המקומות נשמרו לכם. לשינוי פנו לגבאי.');
});

test('not remindable (b): an adult with seats keeps the row every day, Thursday included, and no card', () => {
  const m = mem({ remindable: false });
  for (const at of [wed, thu, fri15]) { assert.equal(homeSeatSlot(m, at), 'row'); assert.equal(cardModel(m, at), null); }
  assert.equal(rowModel(m)!.state, 'open');
  assert.equal(rowModel(mem({ remindable: false, open: false }))!.state, 'closed');
  const old = memberFromWire({ ...wire(), remindable: undefined as unknown as boolean });
  assert.equal(homeSeatSlot(old, thu), 'row', 'a server without the flag degrades to the row');
});

test('shabbatEndFor: Saturday only; the Kehila schedule time wins over nightfall; none known gives null', () => {
  const sat = new Date('2026-10-31T10:00:00Z');
  assert.equal(shabbatEndFor(wed, { scheduleHm: '17:30' }), null);
  assert.equal(shabbatEndFor(sat, { scheduleHm: '17:30', nightfall: '2026-10-31T15:16:00Z' })!.toISOString(), '2026-10-31T15:30:00.000Z');
  assert.equal(shabbatEndFor(sat, { scheduleHm: null, nightfall: '2026-10-31T15:16:00Z' })!.toISOString(), '2026-10-31T15:16:00.000Z');
  assert.equal(shabbatEndFor(sat, {}), null);
});
