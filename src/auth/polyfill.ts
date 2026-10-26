import * as ExpoCrypto from 'expo-crypto';

// amazon-cognito-identity-js needs crypto.getRandomValues, which Hermes lacks.
const g = globalThis as { crypto?: { getRandomValues?: unknown } };
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = (array: ArrayBufferView) => ExpoCrypto.getRandomValues(array as any);
}
