import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiCodeError } from '../src/client/errors.ts';
import { DEFAULT_REMINDERS, OPENS } from '../src/seats/times.ts';
import type { SeatTimes } from '../src/seats/times.ts';
import { applyTimes, failMessage } from '../src/seats/timesSave.ts';

const before: SeatTimes = {
  opens: OPENS, reminders: { '1': { ...DEFAULT_REMINDERS['1'] }, '2': { ...DEFAULT_REMINDERS['2'] } },
  deadline: '14:00', week: '2026-10-30', layout: true, pending: 4, sent: { '1': false, '2': false },
};
const after: SeatTimes = { ...before, reminders: { ...before.reminders, '1': { ...before.reminders['1'], on: false } } };

test('applyTimes: the server answer replaces the times', async () => {
  const r = await applyTimes(async () => after, before, { reminders: { '1': { on: false } } });
  assert.deepEqual(r, { times: after, failure: null });
});

test('applyTimes: a refusal puts the old times back and says why', async () => {
  const r = await applyTimes(async () => { throw new ApiCodeError(400, 'seat_times_order', 'reminders.1'); }, before, { reminders: { '1': { on: true } } });
  assert.equal(r.times, before);
  assert.deepEqual(r.failure, { code: 'seat_times_order', field: 'reminders.1' });
});

test('applyTimes: try_again after the http layer gave up surfaces once, with no second retry here', async () => {
  let calls = 0;
  const r = await applyTimes(async () => { calls++; throw new ApiCodeError(409, 'try_again'); }, before, { deadline: '15:00' });
  assert.equal(calls, 1);
  assert.equal(r.times, before);
  assert.equal(r.failure?.code, 'try_again');
});

test('failMessage: errDeadline names the reminder from `field` and its time', () => {
  const m = failMessage(before, 'deadline', { code: 'seat_reminder_after_deadline', field: 'reminders.2' }, 'he');
  assert.deepEqual(m, { key: 'admin.seats.errDeadline', params: { reminder: 'admin.seats.r2', when: 'ו׳ 11:00' } });
  const noField = failMessage(before, 'deadline', { code: 'seat_reminder_after_deadline' }, 'en');
  assert.deepEqual(noField, { key: 'admin.seats.errDeadline', params: { reminder: 'admin.seats.r2', when: 'Fri 11:00' } });
});

test('failMessage: errOrder between two neighbours, errAfter for the deadline', () => {
  assert.deepEqual(failMessage(before, '1', { code: 'seat_times_order' }, 'he'), { key: 'admin.seats.errOrder', params: { prev: 'ה׳ 08:00', next: 'ו׳ 11:00' } });
  assert.deepEqual(failMessage(before, 'deadline', { code: 'seat_times_order' }, 'he'), { key: 'admin.seats.errAfter', params: { prev: 'ו׳ 11:00' } });
});

test('failMessage: other codes have no mapping (the caller shows the generic error text)', () => {
  assert.equal(failMessage(before, '1', { code: 'try_again' }, 'he'), null);
});
