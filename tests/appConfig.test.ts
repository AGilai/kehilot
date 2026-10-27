import assert from 'node:assert/strict';
import { test } from 'node:test';

async function load(env: Record<string, string | undefined>) {
  const keys = ['APP_VARIANT', 'BUILD_NUMBER'];
  const old = keys.map(k => process.env[k]);
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try { return ((await import(`../app.config.ts?${Math.random()}`)) as { default: { expo: any } }).default.expo; }
  finally { keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; }); }
}

test('store build is unchanged without APP_VARIANT', async () => {
  const c = await load({});
  assert.equal(c.android.package, 'com.shulregular.member');
  assert.equal(c.name, 'הקהילה שלי');
  assert.equal(c.android.versionCode, undefined);
});

test('BUILD_NUMBER alone does not change the store build', async () => {
  assert.equal((await load({ BUILD_NUMBER: '7' })).android.versionCode, undefined);
});

test('APP_VARIANT=test: own package, name marker, versionCode from BUILD_NUMBER', async () => {
  const c = await load({ APP_VARIANT: 'test', BUILD_NUMBER: '42' });
  assert.equal(c.android.package, 'com.shulregular.member.test');
  assert.equal(c.name, 'בדיקה · הקהילה שלי');
  assert.equal(c.android.versionCode, 42);
  assert.equal(c.version, '0.1.0');
  assert.equal(c.ios.bundleIdentifier, 'com.shulregular.member');
});

test('APP_VARIANT=test without BUILD_NUMBER leaves versionCode unset', async () => {
  assert.equal((await load({ APP_VARIANT: 'test' })).android.versionCode, undefined);
});
