import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMobile } from '../src/phone.ts';

test('Israeli mobile formats resolve to the same sign-in identity', () => {
  for (const value of ['0501234567', '050-1234567', '+972 (50) 1234567', '00972501234567']) {
    assert.equal(normalizeMobile(value), '+972501234567');
  }
});
test('incomplete, non-mobile and malformed numbers cannot request a code', () => {
  for (const value of ['', '050', '031234567', '+15012345678', '972501234567', '+972+501234567', '0501234567abc']) {
    assert.equal(normalizeMobile(value), null);
  }
});
