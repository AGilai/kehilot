import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MIGRATED, meLayout, menuRows, menuTarget } from '../src/client/meMap.ts';
import { initials, listState, mutedCount, myTreeName } from '../src/client/meView.ts';
import type { Person } from '../src/tree/types.ts';

// All names are invented.
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const he = JSON.parse(readFileSync(new URL('../src/i18n/he.json', import.meta.url), 'utf8'));
const keyOf = (k: string): unknown => k.split('.').reduce<any>((o, p) => o?.[p], he);

const ME = src('views/Me.tsx');
const meBody = ME.slice(ME.indexOf('export function Me('));
const DETAILS = src('views/me/DetailsCard.tsx');
const MENU = src('views/KehilaMenu.tsx');
const MINE = src('views/tree/MineBlock.tsx') + src('views/tree/PersonSheet.tsx');
const LINK = src('views/tree/LinkParts.tsx') + src('views/tree/useLinking.ts');
const TREE = src('views/tree/TreeScreen.tsx');

/** Each destination in the §18.1 map must exist in the code that renders it (screen or menu entry). */
const check: Record<string, (v: string) => boolean> = {
  menu: v => v === 'kehilot' ? MENU.includes("'kehila.menu.mine'") && MENU.includes("'kehila.menu.join'") : (['gabbai', 'member'] as const).some(r => menuRows(r).includes(v as never)) && MENU.includes(`'kehila.menu.${v}'`),
  me: v => { const [sec, row] = v.split('.'); return meLayout('member').sections.some(s => s.id === sec && s.rows.some(r => r.id === row)); },
  card: v => ({ tags: DETAILS.includes('kehila.tags'), phone: DETAILS.includes("'me.details.phone'"), inList: DETAILS.includes("'me.details.inList'"), treeButton: DETAILS.includes("'me.details.toTree'") } as Record<string, boolean>)[v] === true,
  tree: v => ({ me: MINE.includes('showPhone'), partner: LINK.includes('tree.link'), children: TREE.includes('tree-add-child') } as Record<string, boolean>)[v] === true,
  listener: v => v === 'account.privacy' && ME.includes('NameSheet') && ME.includes("role === 'listener'"),
};

test('inventory map: every §18.1 Me item has a reachable destination after the change', () => {
  for (const [item, dests] of Object.entries(MIGRATED)) {
    assert.ok(Object.keys(dests).length > 0, item);
    for (const [kind, v] of Object.entries(dests)) assert.ok(check[kind]!(v as string), `${item} -> ${kind}:${v}`);
  }
  assert.equal(Object.keys(MIGRATED).length, 20); // rows 1-19 and the Kehila switcher
});

test('inventory map: the management items stay wired in the overview (Task 4 regroups them)', () => {
  const overview = src('views/admin/Overview.tsx');
  for (const h of ['onApprovals', 'onInvite', 'onGroups', 'onChannels', 'onImport', 'onPushTexts', 'onSeatPrint', 'onSchedule', 'onSeatEditor', 'onSeatResponses', 'onSeatHolders', 'onSimchas']) assert.ok(overview.includes(h), h);
});

test('Me renders no edit controls: read-only card, links, actions and the language switch', () => {
  for (const code of [meBody, DETAILS]) for (const bad of ['<Field', 'TextInput', '<Toggle', 'setPhone', 'setShowPhone', 'ChildSheet', 'PartnerPicker', 'FamilyCard', 'PhoneCard', "'admin.enter'"]) assert.ok(!code.includes(bad), bad);
  for (const role of ['member', 'gabbai', 'listener'] as const) {
    for (const s of meLayout(role).sections) for (const r of s.rows) assert.ok(['nav', 'action', 'danger', 'langSwitch'].includes(r.kind), r.id);
  }
  // The one exception outside the tree: a listener's name, reached from the account's privacy sheet.
  assert.ok(src('views/me/NameSheet.tsx').includes('<Field'));
});

test('Me sections by role: the same four groups; the card carries the tree only for members and gabbaim', () => {
  for (const role of ['member', 'gabbai', 'listener'] as const) assert.deepEqual(meLayout(role).sections.map(s => s.id), ['mine', 'notify', 'account']);
  assert.deepEqual(meLayout('member').card, { phone: true, tree: true });
  assert.deepEqual(meLayout('gabbai').card, { phone: true, tree: true });
  assert.deepEqual(meLayout('listener').card, { phone: false, tree: false });
  assert.deepEqual(meLayout('member').sections[2]!.rows.map(r => r.id), ['privacy', 'leave', 'signOut', 'delete']);
});

test('Kehila menu rows by role; a listener sees nothing family-related; management only for gabbaim', () => {
  assert.deepEqual(menuRows('gabbai'), ['manage', 'tree', 'phoneList', 'invite', 'about']);
  assert.deepEqual(menuRows('member'), ['tree', 'phoneList', 'invite', 'about']);
  assert.deepEqual(menuRows('listener'), ['about']);
  assert.equal(menuTarget('manage', 'member'), null);
  assert.equal(menuTarget('tree', 'listener'), null);
  assert.equal(menuTarget('manage', 'gabbai'), 'overview');
  assert.equal(menuTarget('invite', 'member'), 'myInvite');
  assert.equal(menuTarget('phoneList', 'member'), 'phoneList');
});

test('copy keys used by Me and the menu exist (he)', () => {
  const keys = [...(DETAILS + meBody + MENU + src('views/TopBar.tsx') + src('views/me/NameSheet.tsx') + src('views/me/PrivacySheet.tsx')).matchAll(/\bt\(\s*['`]([\w.]+)['`]/g)].map(m => m[1]!);
  for (const k of keys) assert.ok(typeof keyOf(k) === 'string', k);
  assert.equal(keyOf('me.details.aliyah'), 'השם לעלייה לתורה');
  assert.equal(keyOf('me.details.mi'), 'השם למי שברך');
  assert.equal(keyOf('me.details.toTree'), 'צפייה ועריכה בעץ המשפחה ‹');
});

const person = (over: Partial<Person> & Pick<Person, 'id' | 'relation' | 'gender'>): Person => ({ ...over });
test('tree name by gender: men aliyah (with the tribe), women Mi Sheberach; missing parts listed', () => {
  const man = [person({ id: 'a', relation: 'self', gender: 'm', hebrewFirst: 'דוד', tribe: 'levi' }), person({ id: 'f', relation: 'father', of: 'a', gender: 'm', hebrewFirst: 'אברהם' })];
  assert.deepEqual(myTreeName(man), { label: 'aliyah', text: 'דוד בן אברהם הלוי', missing: [] });
  const woman = [person({ id: 'b', relation: 'self', gender: 'f', hebrewFirst: 'יעל' }), person({ id: 'm', relation: 'mother', of: 'b', gender: 'f', hebrewFirst: 'רחל' })];
  assert.deepEqual(myTreeName(woman), { label: 'mi', text: 'יעל בת רחל', missing: [] });
  assert.deepEqual(myTreeName([person({ id: 'b', relation: 'self', gender: 'f', hebrewFirst: 'יעל' })]), { label: 'mi', text: 'יעל', missing: ['mother'] });
  assert.equal(myTreeName([]), null);
});

test('card helpers: phone-list state, initials, muted count', () => {
  assert.equal(listState(null, true), null);
  assert.equal(listState('+972500000001', true), 'toAll');
  assert.equal(listState('+972500000001', false), 'gabbaimOnly');
  assert.equal(initials('יעל', 'דוגמה'), 'יד');
  assert.equal(initials('Dana', ''), 'D');
  assert.equal(mutedCount({ mutedChannels: ['a'], mutedTypes: ['event', 'x'], mutedMembers: [] }), 3);
});
