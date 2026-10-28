// The editor's version choice, the scheduled-version note, the save default, the selection bar and the holder actions (owner bug
// report 2026-10-28). Invented names only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignKeys, emptyDraft } from '../src/seats/editModel.ts';
import { defaultSaveFrom } from '../src/seats/effectiveFrom.ts';
import { dismissNote, noteDismissed, noteKey, scheduledNote, versionToOpen } from '../src/seats/mapSave.ts';
import { deleteLines, isMine, myFamily, selectionActions } from '../src/seats/holderActions.ts';
import type { AdminFamily } from '../src/client/types.ts';

type Row = { effectiveFrom: string; updatedAt: number; seats: number; assigned: number; current: boolean };
const WED = new Date('2026-10-28T10:00:00+02:00'); // current Shabbat = Friday 2026-10-30, not open for answers yet
const THU_PM = new Date('2026-10-29T12:30:00+02:00'); // the card for 10-30 is open
const row = (effectiveFrom: string, current = false, updatedAt = 1): Row => ({ effectiveFrom, updatedAt, seats: 225, assigned: 198, current });

test('the editor opens the version that governs the coming Shabbat, not the one the server calls current today', () => {
  // the owner's case: 10-23 is in effect today, a version from this Friday exists -> edit that one (10-23 is read-only anyway)
  assert.equal(versionToOpen([row('2026-10-23', true), row('2026-10-30')], WED), '2026-10-30');
  assert.equal(versionToOpen([row('2026-10-23', true)], WED), '2026-10-23');
  assert.equal(versionToOpen([row('2026-10-23', true), row('2026-11-13')], WED), '2026-10-23');
  assert.equal(versionToOpen([row('2026-11-13'), row('2026-11-20')], WED), '2026-11-13'); // only future ones: the first
  assert.equal(versionToOpen([], WED), null);
  // Saturday still belongs to its Friday
  assert.equal(versionToOpen([row('2026-10-30'), row('2026-11-06')], new Date('2026-10-31T10:00:00+02:00')), '2026-10-30');
});

test('the scheduled note names the next version after the open one, and is dismissed per device per version', () => {
  const rows = [row('2026-10-23', true), row('2026-11-13', false, 77)];
  assert.deepEqual(scheduledNote(rows, '2026-10-23'), { from: '2026-11-13', updatedAt: 77 });
  assert.equal(scheduledNote(rows, '2026-11-13'), null);
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  const key = noteKey('K1', { from: '2026-11-13', updatedAt: 77 });
  assert.equal(noteDismissed(store, key), false);
  dismissNote(store, key);
  assert.equal(noteDismissed(store, key), true);
  assert.equal(noteDismissed(store, noteKey('K1', { from: '2026-11-13', updatedAt: 78 })), false); // saved again: a new version state
  assert.equal(noteDismissed(store, noteKey('K2', { from: '2026-11-13', updatedAt: 77 })), false);
  // no storage, or storage that throws: never dismissed, never throws
  assert.equal(noteDismissed(undefined, key), false);
  const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  assert.equal(noteDismissed(bad, key), false);
  dismissNote(bad, key);
});

test('save default: in place on the open version when it can still be written; a new version only when it must be', () => {
  // assignments only, the open version is this Shabbat's: in place (also once answers are open: the dialog warns)
  assert.equal(defaultSaveFrom('2026-10-30', WED, false), '2026-10-30');
  assert.equal(defaultSaveFrom('2026-10-30', THU_PM, false), '2026-10-30');
  // the open version is in the past: a new version, from the first Shabbat not yet open
  assert.equal(defaultSaveFrom('2026-10-23', WED, false), '2026-10-30');
  assert.equal(defaultSaveFrom('2026-10-23', THU_PM, false), '2026-11-06');
  // the hall itself changed: never into a Shabbat that already takes answers
  assert.equal(defaultSaveFrom('2026-10-30', WED, true), '2026-10-30');
  assert.equal(defaultSaveFrom('2026-10-30', THU_PM, true), '2026-11-06');
  assert.equal(defaultSaveFrom('2026-11-13', THU_PM, true), '2026-11-13');
  assert.equal(defaultSaveFrom(null, WED, true), '2026-10-30');
});

test('selection bar: a seat of the selected household offers "free" first and no no-op assign', () => {
  const d = assignKeys(assignKeys(emptyDraft(2, 3), ['0:0', '0:1'], 'holder:H1'), ['1:0'], 'family:F1');
  assert.deepEqual(selectionActions(d, ['0:0'], 'holder:H1'), { assignTo: false, free: 1, owner: 'holder:H1' });
  assert.deepEqual(selectionActions(d, ['0:0', '1:0'], 'holder:H1'), { assignTo: true, free: 2, owner: null });
  assert.deepEqual(selectionActions(d, ['0:2'], 'holder:H1'), { assignTo: true, free: 0, owner: null });
  assert.deepEqual(selectionActions(d, ['1:0'], null), { assignTo: false, free: 1, owner: 'family:F1' });
});

const fam = (familyId: string, name: string, adults: [string, string][]): AdminFamily => ({ familyId, name, adults: adults.map(([userId, displayName]) => ({ userId, displayName })), children: [] });

test('"this is me": the gabbai\'s own family, matched to a holder by surname (and the initial when the holder has one)', () => {
  const families = [fam('F1', 'בדיוני', [['U1', 'מיכאל בדיוני'], ['U2', 'שרה בדיוני']]), fam('F2', 'דוגמה', [['U3', 'אבי דוגמה']])];
  const mine = myFamily(families, 'U2')!;
  assert.equal(mine.familyId, 'F1');
  assert.equal(myFamily(families, 'nobody'), null);
  assert.equal(myFamily(families, undefined), null);
  assert.ok(isMine('בדיוני', mine));
  assert.ok(isMine('משפחת בדיוני', mine));
  assert.ok(isMine('בדיוני מ.', mine));
  assert.ok(isMine('בדיוני ש', mine));
  assert.ok(!isMine('בדיוני א.', mine));
  assert.ok(!isMine('דוגמה', mine));
  assert.ok(!isMine('בדיוני', null));
});

test('delete confirm lines: per version, past ones marked, nothing when the holder holds no seat', () => {
  const usage = { total: 3, versions: [{ effectiveFrom: '2026-10-23', seats: 2, past: true }, { effectiveFrom: '2026-10-30', seats: 1, past: false }] };
  assert.deepEqual(deleteLines(usage), [{ from: '2026-10-23', seats: 2, past: true }, { from: '2026-10-30', seats: 1, past: false }]);
  assert.deepEqual(deleteLines({ total: 0, versions: [] }), []);
});
