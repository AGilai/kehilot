import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPhone, normalizePhone, telUrl, whatsappUrl } from '../src/client/phone.ts';

// The same cases as server/tests/cloud/test_phone_list.py test_normalize_phone.
test('normalize matches server cases', () => {
  for (const raw of ['050-123 4567', '+972 50 123 4567', '00972501234567', '+972-0501234567']) assert.equal(normalizePhone(raw), '+972501234567', raw);
  assert.equal(normalizePhone('02-6234567'), '+97226234567');
  assert.equal(normalizePhone('077-1234567'), '+972771234567');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  for (const raw of ['', '12345', '050-123', 'abc', '+0123456789', '+1234567890123456', '0'.repeat(40)]) assert.equal(normalizePhone(raw), null, raw);
});

test('formats Israeli mobile and landline', () => {
  assert.equal(formatPhone('+972501234567'), '050-1234567');
  assert.equal(formatPhone('+972771234567'), '077-1234567');
  assert.equal(formatPhone('+97226234567'), '02-6234567');
  assert.equal(formatPhone('+442079460958'), '+442079460958');
});

test('whatsapp link has digits only', () => {
  assert.equal(whatsappUrl('+972501234567'), 'https://wa.me/972501234567');
  assert.equal(telUrl('+972501234567'), 'tel:+972501234567');
});
