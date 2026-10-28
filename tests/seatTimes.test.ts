import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_REMINDERS, MIN_GAP, OPENS, allowedRange, fits, onCount, slotLabel, weekMinute } from '../src/seats/times.ts';
import type { SeatTimes } from '../src/seats/times.ts';
import { DEFAULT_DEADLINE_HM, DEFAULT_WINDOW } from '../src/seats/window.ts';

const defaults: SeatTimes = {
  opens: OPENS, reminders: { '1': { ...DEFAULT_REMINDERS['1'] }, '2': { ...DEFAULT_REMINDERS['2'] } },
  deadline: DEFAULT_DEADLINE_HM, week: '2026-10-30', layout: true, pending: 4, sent: { '1': false, '2': false },
};

test('times: allowed range and the 30-minute gap', () => {
  const t = { ...defaults };
  assert.deepEqual(allowedRange(t, '1'), { from: { day: 'thu', time: '08:30' }, to: { day: 'fri', time: '10:30' } });
  assert.deepEqual(allowedRange(t, '2'), { from: { day: 'thu', time: '20:30' }, to: { day: 'fri', time: '13:30' } });
  assert.deepEqual(allowedRange(t, 'deadline'), { from: { day: 'fri', time: '11:30' }, to: { day: 'fri', time: '23:45' } });
  assert.equal(fits(t, '2', { day: 'fri', time: '13:45' }), false);
  assert.equal(fits(t, '2', { day: 'fri', time: '13:30' }), true);
  assert.equal(fits(t, '1', { day: 'thu', time: '20:10' }), false); // not a quarter hour
  assert.equal(fits(t, '1', { day: 'thu', time: '08:15' }), false); // too close to the opening
  assert.equal(MIN_GAP, 30);
});

test('times: a reminder that is off leaves the chain', () => {
  const t: SeatTimes = { ...defaults, reminders: { '1': { ...defaults.reminders['1'] }, '2': { ...defaults.reminders['2'], on: false } } };
  assert.deepEqual(allowedRange(t, '1'), { from: { day: 'thu', time: '08:30' }, to: { day: 'fri', time: '13:30' } });
  assert.deepEqual(allowedRange(t, 'deadline'), { from: { day: 'fri', time: '00:00' }, to: { day: 'fri', time: '23:45' } });
  assert.equal(allowedRange(t, '2'), null, 'an off reminder has no range');
  assert.equal(fits(t, 'deadline', { day: 'thu', time: '21:00' }), false, 'the deadline is on Friday');
});

test('times: slotLabel, weekMinute, onCount', () => {
  assert.equal(slotLabel({ day: 'thu', time: '08:30' }, 'he'), 'ה׳\u00a008:30');
  assert.equal(slotLabel({ day: 'fri', time: '11:00' }, 'he'), 'ו׳\u00a011:00');
  assert.equal(slotLabel({ day: 'thu', time: '08:30' }, 'en'), 'Thu\u00a008:30');
  assert.equal(weekMinute({ day: 'fri', time: '00:15' }), 1440 + 15);
  assert.equal(onCount(defaults), 2);
  assert.equal(onCount({ ...defaults, reminders: { '1': { ...defaults.reminders['1'], on: false }, '2': { ...defaults.reminders['2'], on: false } } }), 0);
});

test('client defaults equal the server', () => {
  const py = (f: string) => readFileSync(new URL(`../server/cloud/${f}`, import.meta.url), 'utf8');
  const wk = py('seating_week.py');
  assert.equal(/^DEFAULT_DEADLINE = '(\d\d:\d\d)'/m.exec(wk)![1], DEFAULT_DEADLINE_HM);
  assert.equal(DEFAULT_WINDOW.deadline.time, DEFAULT_DEADLINE_HM);
  const st = py('seat_times.py');
  const opens = /^OPENS = \{'day': '(\w+)', 'time': '([\d:]+)'\}/m.exec(st)!;
  assert.deepEqual(OPENS, { day: opens[1], time: opens[2] });
  assert.equal(DEFAULT_WINDOW.opens.time, opens[2]);
  assert.equal(DEFAULT_WINDOW.opens.daysBefore, 1); // Thursday for a Friday deadline
  const rem = /^DEFAULT_REMINDERS = \{(.*)\}$/m.exec(st)![1]!;
  const parsed = [...rem.matchAll(/'(\d)': \{'on': (True|False), 'day': '(\w+)', 'time': '([\d:]+)'\}/g)];
  const server = Object.fromEntries(parsed.map((m) => [m[1]!, { on: m[2] === 'True', day: m[3], time: m[4] }]));
  assert.deepEqual(DEFAULT_REMINDERS, server);
  assert.equal(Number(/^MIN_GAP = (\d+)/m.exec(st)![1]), MIN_GAP);
});
