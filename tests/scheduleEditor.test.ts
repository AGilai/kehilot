import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate } from '../src/schedule/formula.ts';
import {
  applyFormulaPatch, changeCount, editorLeaveAsk, classicSections, clockChangeIn, editorReducer, explainFormula, formulaWarnings, hideSuggestions,
  initialEditorState, isDirty, issueTarget, nextId, nudgeClock, parseClockInput, saveDiff, timeOfKind, validateSections, validateWeekOverrides,
  weekEditable, weekList, sectionItems, weekChanges,
} from '../src/schedule/editor.ts';
import type { EditorAction, EditorState } from '../src/schedule/editor.ts';
import type { Formula, Row, Section } from '../src/schedule/types.ts';
import { computeWeek, scheduleWeekOf } from '../src/schedule/week.ts';
import { offlineZmanimFor } from '../src/schedule/zmanim.ts';

const zmanim = offlineZmanimFor();
const week = scheduleWeekOf('2026-10-30');

const fixed = (id: string, he: string, at: string): Row => ({ id, label: { he }, time: { kind: 'fixed', at } });
const doc = () => ({
  sections: [
    { id: 'sh', kind: 'shabbat' as const, title: { he: 'שבת' }, rows: [fixed('a', 'שחרית', '08:30'), fixed('b', 'מנחה', '13:00')] },
    { id: 'wd', kind: 'weekday' as const, title: { he: 'חול' }, rows: [fixed('c', 'שחרית א', '06:15'), fixed('d', 'שחרית ב', '08:00'), fixed('e', 'ערבית', '17:15')] },
  ] as Section[],
  weekOverrides: {},
  updatedAt: 1000,
});
const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);
const ids = (state: EditorState, section: string) => state.draft.sections.find(s => s.id === section)!.rows.map(r => r.id);
const fresh = () => initialEditorState(doc());

// ---- reducer: sections and rows ------------------------------------------------------------------------------

test('a fresh state is clean; edits make it dirty and discard brings it back', () => {
  const s = fresh();
  assert.equal(isDirty(s), false);
  const edited = run(s, { type: 'editRow', rowId: 'a', patch: { label: { he: 'שחרית מרכזי' } } });
  assert.equal(isDirty(edited), true);
  assert.equal(changeCount(edited), 1);
  const back = run(edited, { type: 'discard' });
  assert.equal(isDirty(back), false);
  assert.deepEqual(back.draft, s.saved);
});

test('add, rename, move and delete a section', () => {
  let s = run(fresh(), { type: 'addSection', id: 'x', kind: 'weekday', title: { he: 'חג' } });
  assert.deepEqual(s.draft.sections.map(x => x.id), ['sh', 'wd', 'x']);
  s = run(s, { type: 'renameSection', id: 'x', title: { he: 'חגים', en: 'Holidays' } });
  assert.deepEqual(s.draft.sections[2]!.title, { he: 'חגים', en: 'Holidays' });
  s = run(s, { type: 'moveSection', id: 'x', delta: -1 });
  assert.deepEqual(s.draft.sections.map(x => x.id), ['sh', 'x', 'wd']);
  s = run(s, { type: 'moveSection', id: 'sh', delta: -1 });
  assert.deepEqual(s.draft.sections.map(x => x.id), ['sh', 'x', 'wd'], 'moving past the start does nothing');
  s = run(s, { type: 'deleteSection', id: 'x' });
  assert.deepEqual(s.draft.sections.map(x => x.id), ['sh', 'wd']);
});

test('add a row: after a given row, at the end, and text-only', () => {
  let s = run(fresh(), { type: 'addRow', sectionId: 'wd', id: 'n1', label: { he: 'חדש' }, afterRowId: 'c' });
  assert.deepEqual(ids(s, 'wd'), ['c', 'n1', 'd', 'e']);
  assert.deepEqual(s.draft.sections[1]!.rows[1]!.time, { kind: 'fixed', at: '12:00' });
  s = run(s, { type: 'addRow', sectionId: 'wd', id: 'n2', label: { he: 'טקסט' }, time: { kind: 'none' } });
  assert.deepEqual(ids(s, 'wd'), ['c', 'n1', 'd', 'e', 'n2']);
  assert.deepEqual(s.draft.sections[1]!.rows[4]!.time, { kind: 'none' });
});

test('moving rows: by one place, to another section, never off the ends', () => {
  let s = run(fresh(), { type: 'moveRow', rowId: 'd', delta: -1 });
  assert.deepEqual(ids(s, 'wd'), ['d', 'c', 'e']);
  s = run(s, { type: 'moveRow', rowId: 'd', delta: -1 });
  assert.deepEqual(ids(s, 'wd'), ['d', 'c', 'e']);
  s = run(s, { type: 'moveRow', rowId: 'e', delta: 1 });
  assert.deepEqual(ids(s, 'wd'), ['d', 'c', 'e']);
  s = run(s, { type: 'moveRowTo', rowId: 'a', sectionId: 'wd', index: 1 });
  assert.deepEqual(ids(s, 'wd'), ['d', 'a', 'c', 'e']);
  assert.deepEqual(ids(s, 'sh'), ['b']);
});

test('a row moved into the other kind of section gets a formula day that fits it', () => {
  let s = run(fresh(), { type: 'setTimeKind', rowId: 'a', kind: 'formula' });
  assert.equal((s.draft.sections[0]!.rows[0]!.time as { formula: Formula }).formula.day, 'shabbat');
  s = run(s, { type: 'moveRowTo', rowId: 'a', sectionId: 'wd', index: 0 });
  const moved = s.draft.sections[1]!.rows[0]!;
  assert.equal((moved.time as { formula: Formula }).formula.day, 'earliest');
  assert.equal('day' in moved, false);
});

test('duplicate puts the copy right after the original, with its own id', () => {
  const s = run(fresh(), { type: 'duplicateRow', rowId: 'c', id: 'c2' });
  assert.deepEqual(ids(s, 'wd'), ['c', 'c2', 'd', 'e']);
  assert.deepEqual(s.draft.sections[1]!.rows[1]!.label, { he: 'שחרית א' });
});

test('edit label, note, role and day; empty English name and note are removed', () => {
  let s = run(fresh(), { type: 'editRow', rowId: 'a', patch: { label: { he: 'שחרית', en: 'Shacharit' }, note: 'בבית הכנסת', day: 'friday' } });
  const row = () => s.draft.sections[0]!.rows[0]!;
  assert.deepEqual(row().label, { he: 'שחרית', en: 'Shacharit' });
  assert.equal(row().note, 'בבית הכנסת');
  assert.equal(row().day, 'friday');
  s = run(s, { type: 'editRow', rowId: 'a', patch: { label: { he: 'שחרית', en: '' }, note: '', day: null } });
  assert.deepEqual(row().label, { he: 'שחרית' });
  assert.equal('note' in row(), false);
  assert.equal('day' in row(), false);
});

test('delete a row also drops its week overrides and re-anchors the extras', () => {
  const friday = week.friday;
  let s = run(fresh(),
    { type: 'setOverride', friday, rowId: 'd', override: { kind: 'hide' } },
    { type: 'addExtra', friday, extra: { id: 'x1', sectionId: 'wd', afterRowId: 'd', label: { he: 'שיעור מיוחד' }, time: { kind: 'fixed', at: '20:00' } } });
  s = run(s, { type: 'deleteRow', rowId: 'd' });
  assert.deepEqual(ids(s, 'wd'), ['c', 'e']);
  assert.equal(s.draft.weekOverrides[friday]?.rows, undefined);
  assert.equal(s.draft.weekOverrides[friday]!.extra![0]!.afterRowId, null);
});

test('deleting a section removes the extras and overrides that point into it', () => {
  const friday = week.friday;
  let s = run(fresh(),
    { type: 'setOverride', friday, rowId: 'a', override: { kind: 'time', at: '09:00' } },
    { type: 'addExtra', friday, extra: { id: 'x1', sectionId: 'sh', label: { he: 'קידוש' }, time: { kind: 'none' } } });
  s = run(s, { type: 'deleteSection', id: 'sh' });
  assert.deepEqual(s.draft.weekOverrides, {});
});

// ---- reducer: time and formula ----------------------------------------------------------------------------------

test('switching the time kind: fixed keeps a given time, formula starts from a sensible default, none drops the time', () => {
  let s = run(fresh(), { type: 'setTimeKind', rowId: 'c', kind: 'formula' });
  assert.deepEqual((s.draft.sections[1]!.rows[0]!.time as { formula: Formula }).formula,
    { anchor: 'sunset', day: 'earliest', offset: { minutes: 0, direction: 'before' }, rounding: { mode: 'none' } });
  s = run(s, { type: 'setTimeKind', rowId: 'c', kind: 'fixed', at: '07:10' });
  assert.deepEqual(s.draft.sections[1]!.rows[0]!.time, { kind: 'fixed', at: '07:10' });
  s = run(s, { type: 'setTimeKind', rowId: 'c', kind: 'none' });
  assert.deepEqual(s.draft.sections[1]!.rows[0]!.time, { kind: 'none' });
});

test('formula patches: offset, direction, rounding with its step, bounds', () => {
  const base: Formula = { anchor: 'sunset', day: 'earliest', offset: { minutes: 15, direction: 'before' }, rounding: { mode: 'none' } };
  assert.deepEqual(applyFormulaPatch(base, { minutes: 20 }).offset, { minutes: 20, direction: 'before' });
  assert.deepEqual(applyFormulaPatch(base, { direction: 'after' }).offset, { minutes: 15, direction: 'after' });
  assert.deepEqual(applyFormulaPatch(base, { roundMode: 'down' }).rounding, { mode: 'down', step: 5 }, 'a mode needs a step: 5 by default');
  const down10 = applyFormulaPatch(base, { roundMode: 'down', roundStep: 10 });
  assert.deepEqual(down10.rounding, { mode: 'down', step: 10 });
  assert.deepEqual(applyFormulaPatch(down10, { roundMode: 'up' }).rounding, { mode: 'up', step: 10 }, 'the step is kept across modes');
  assert.deepEqual(applyFormulaPatch(down10, { roundMode: 'none' }).rounding, { mode: 'none' }, 'none has no step');
  const bounded = applyFormulaPatch(base, { notLaterThan: '18:30', notEarlierThan: '16:00' });
  assert.equal(bounded.notLaterThan, '18:30');
  assert.equal(bounded.notEarlierThan, '16:00');
  const cleared = applyFormulaPatch(bounded, { notLaterThan: null });
  assert.equal('notLaterThan' in cleared, false);
  assert.equal(applyFormulaPatch(base, { minutes: 5000 }).offset.minutes, 720, 'offset is clamped to the server cap');
  assert.equal(applyFormulaPatch(base, { minutes: -3 }).offset.minutes, 0);
});

test('the reducer applies a formula patch to the row', () => {
  const s = run(fresh(), { type: 'setTimeKind', rowId: 'e', kind: 'formula' }, { type: 'setFormula', rowId: 'e', patch: { anchor: 'tzeit', day: 'latest', minutes: 0, roundMode: 'up' } });
  const f = (s.draft.sections[1]!.rows[2]!.time as { formula: Formula }).formula;
  assert.equal(f.anchor, 'tzeit');
  assert.equal(f.day, 'latest');
  assert.deepEqual(f.rounding, { mode: 'up', step: 5 });
});

test('timeOfKind picks the formula day by section kind', () => {
  assert.equal((timeOfKind('formula', 'shabbat') as { formula: Formula }).formula.day, 'shabbat');
  assert.equal((timeOfKind('formula', 'weekday') as { formula: Formula }).formula.day, 'earliest');
});

// ---- reducer: this week only ------------------------------------------------------------------------------------

test('week overrides: a time with a note, hide, and removing them; empty weeks are pruned', () => {
  const friday = week.friday;
  let s = run(fresh(), { type: 'setOverride', friday, rowId: 'b', override: { kind: 'time', at: '12:45', note: 'בגלל הקידוש' } });
  assert.deepEqual(s.draft.weekOverrides[friday], { rows: { b: { kind: 'time', at: '12:45', note: 'בגלל הקידוש' } } });
  assert.equal(changeCount(s), 1);
  s = run(s, { type: 'setOverride', friday, rowId: 'd', override: { kind: 'hide' } });
  assert.equal(Object.keys(s.draft.weekOverrides[friday]!.rows!).length, 2);
  s = run(s, { type: 'setOverride', friday, rowId: 'b', override: null }, { type: 'setOverride', friday, rowId: 'd', override: null });
  assert.deepEqual(s.draft.weekOverrides, {});
  assert.equal(isDirty(s), false, 'back to what was saved');
});

test('extra rows of one week: add, edit, delete', () => {
  const friday = week.friday;
  let s = run(fresh(), { type: 'addExtra', friday, extra: { id: 'x1', sectionId: 'sh', afterRowId: 'a', label: { he: 'קידוש' }, time: { kind: 'none' } } });
  s = run(s, { type: 'editExtra', friday, id: 'x1', patch: { label: { he: 'קידוש לכבוד בר מצווה' }, time: { kind: 'fixed', at: '10:30' } } });
  assert.deepEqual(s.draft.weekOverrides[friday]!.extra![0], { id: 'x1', sectionId: 'sh', afterRowId: 'a', label: { he: 'קידוש לכבוד בר מצווה' }, time: { kind: 'fixed', at: '10:30' } });
  s = run(s, { type: 'deleteExtra', friday, id: 'x1' });
  assert.deepEqual(s.draft.weekOverrides, {});
});

test('another week keeps its own overrides', () => {
  const next = scheduleWeekOf('2026-11-06').friday;
  const s = run(initialEditorState({ ...doc(), weekOverrides: { [week.friday]: { rows: { a: { kind: 'hide' } } } } }), { type: 'setOverride', friday: next, rowId: 'b', override: { kind: 'hide' } });
  assert.deepEqual(Object.keys(s.draft.weekOverrides).sort(), [week.friday, next].sort());
});

// ---- undo ------------------------------------------------------------------------------------------------------

test('undo steps back one change; typing in one field is a single step', () => {
  let s = run(fresh(), { type: 'moveRow', rowId: 'd', delta: -1 });
  s = run(s, { type: 'editRow', rowId: 'a', patch: { label: { he: 'ש' } }, key: 'label:a' }, { type: 'editRow', rowId: 'a', patch: { label: { he: 'שח' } }, key: 'label:a' }, { type: 'editRow', rowId: 'a', patch: { label: { he: 'שחר' } }, key: 'label:a' });
  s = run(s, { type: 'undo' });
  assert.equal(s.draft.sections[0]!.rows[0]!.label.he, 'שחרית');
  assert.deepEqual(ids(s, 'wd'), ['d', 'c', 'e']);
  s = run(s, { type: 'undo' });
  assert.deepEqual(ids(s, 'wd'), ['c', 'd', 'e']);
  assert.equal(run(s, { type: 'undo' }), s, 'nothing left to undo');
});

// ---- saving -----------------------------------------------------------------------------------------------------

test('save diff: only what changed, and a week whose overrides were all removed is deleted', () => {
  const friday = week.friday;
  const base = initialEditorState({ ...doc(), weekOverrides: { [friday]: { rows: { a: { kind: 'hide' } } } } });
  assert.deepEqual(saveDiff(base.saved, base.draft), { sections: false, weeks: [] });
  const s1 = run(base, { type: 'setOverride', friday, rowId: 'a', override: null });
  assert.deepEqual(saveDiff(s1.saved, s1.draft), { sections: false, weeks: [{ friday, overrides: null }] });
  const s2 = run(base, { type: 'moveRow', rowId: 'd', delta: -1 }, { type: 'setOverride', friday, rowId: 'b', override: { kind: 'hide' } });
  const diff = saveDiff(s2.saved, s2.draft);
  assert.equal(diff.sections, true);
  assert.deepEqual(diff.weeks, [{ friday, overrides: { rows: { a: { kind: 'hide' }, b: { kind: 'hide' } } } }]);
});

test('after a save the baseline moves, the draft is clean, and the new updatedAt is kept', () => {
  let s = run(fresh(), { type: 'moveRow', rowId: 'd', delta: -1 });
  assert.equal(s.updatedAt, 1000);
  s = run(s, { type: 'saved', snapshot: s.draft, updatedAt: 2000 });
  assert.equal(isDirty(s), false);
  assert.equal(s.updatedAt, 2000);
});

test('edits made while a save was running stay dirty', () => {
  const s0 = run(fresh(), { type: 'moveRow', rowId: 'd', delta: -1 });
  const snapshot = s0.draft;
  const s1 = run(s0, { type: 'moveRow', rowId: 'e', delta: -1 }, { type: 'saved', snapshot, updatedAt: 2000 });
  assert.equal(isDirty(s1), true);
  assert.equal(changeCount(s1), 1);
});

test('the change count adds up sections, rows and week entries', () => {
  const friday = week.friday;
  let s = run(fresh(), { type: 'addRow', sectionId: 'wd', id: 'n', label: { he: 'חדש' } }, { type: 'deleteRow', rowId: 'a' }, { type: 'editRow', rowId: 'b', patch: { note: 'x' } });
  assert.equal(changeCount(s), 3);
  s = run(s, { type: 'setOverride', friday, rowId: 'c', override: { kind: 'hide' } });
  assert.equal(changeCount(s), 4);
  s = run(s, { type: 'moveRow', rowId: 'e', delta: -1 });
  assert.equal(changeCount(s), 5, 'a reorder counts once');
});

// ---- validation (mirrors server/cloud/schedule_rules.py) ---------------------------------------------------------

const sectionsWith = (row: Partial<Row> | ((r: Row) => Row), kind: 'shabbat' | 'weekday' = 'weekday'): Section[] => {
  const base: Row = { id: 'r1', label: { he: 'מנחה' }, time: { kind: 'fixed', at: '16:00' } };
  return [{ id: 's1', kind, title: { he: 'חול' }, rows: [typeof row === 'function' ? row(base) : { ...base, ...row }] }];
};

test('validation accepts a normal schedule and an empty one', () => {
  assert.deepEqual(validateSections(doc().sections), []);
  assert.deepEqual(validateSections([]), []);
});

test('validation: caps on sections, rows, labels and notes use the server paths', () => {
  const many = Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, kind: 'weekday' as const, title: { he: 'x' }, rows: [] }));
  assert.deepEqual(validateSections(many).map(i => [i.path, i.code]), [['sections', 'count']]);
  const rows = Array.from({ length: 41 }, (_, i) => fixed(`r${i}`, 'x', '10:00'));
  assert.deepEqual(validateSections([{ id: 's', kind: 'weekday', title: { he: 'x' }, rows }]).map(i => [i.path, i.code]), [['sections[0].rows', 'count']]);
  assert.deepEqual(validateSections(sectionsWith({ label: { he: 'א'.repeat(61) } })).map(i => [i.path, i.code]), [['sections[0].rows[0].label.he', 'tooLong']]);
  assert.deepEqual(validateSections(sectionsWith({ label: { he: 'א'.repeat(60) } })), []);
  assert.deepEqual(validateSections(sectionsWith({ label: { he: 'x', en: 'e'.repeat(61) } })).map(i => i.path), ['sections[0].rows[0].label.en']);
  assert.deepEqual(validateSections(sectionsWith({ note: 'n'.repeat(201) })).map(i => i.path), ['sections[0].rows[0].note']);
  assert.deepEqual(validateSections(sectionsWith({ note: 'n'.repeat(200) })), []);
});

test('validation counts code points, not UTF-16 units', () => {
  assert.deepEqual(validateSections(sectionsWith({ label: { he: '😀'.repeat(60) } })), []);
  assert.equal(validateSections(sectionsWith({ label: { he: '😀'.repeat(61) } })).length, 1);
});

test('validation: a name is required, control and bidi characters are refused', () => {
  assert.deepEqual(validateSections(sectionsWith({ label: { he: '   ' } })).map(i => [i.path, i.code]), [['sections[0].rows[0].label.he', 'required']]);
  assert.deepEqual(validateSections(sectionsWith({ label: { he: 'a\u202eb' } })).map(i => i.code), ['unsafe']);
  assert.deepEqual(validateSections(sectionsWith({ note: 'a\nb' })).map(i => i.code), ['unsafe']);
  const titled: Section[] = [{ id: 's', kind: 'weekday', title: { he: '' }, rows: [] }];
  assert.deepEqual(validateSections(titled).map(i => i.path), ['sections[0].title.he']);
});

test('validation: ids are unique and well-formed', () => {
  const dup: Section[] = [{ id: 's', kind: 'weekday', title: { he: 'x' }, rows: [fixed('r', 'a', '10:00'), fixed('r', 'b', '11:00')] }];
  assert.deepEqual(validateSections(dup).map(i => [i.path, i.code]), [['sections[0].rows[1].id', 'duplicate']]);
  assert.deepEqual(validateSections(sectionsWith({ id: 'bad id' })).map(i => i.path), ['sections[0].rows[0].id']);
  const acrossSections: Section[] = [{ id: 's', kind: 'weekday', title: { he: 'x' }, rows: [fixed('r', 'a', '10:00')] }, { id: 't', kind: 'shabbat', title: { he: 'y' }, rows: [fixed('r', 'b', '11:00')] }];
  assert.equal(validateSections(acrossSections).length, 1);
});

test('validation: times, offsets, bounds, day source per section kind', () => {
  const formulaRow = (formula: Formula, kind: 'shabbat' | 'weekday') => sectionsWith({ time: { kind: 'formula', formula } }, kind);
  const ok: Formula = { anchor: 'sunset', day: 'earliest', offset: { minutes: 15, direction: 'before' }, rounding: { mode: 'down', step: 5 } };
  assert.deepEqual(validateSections(formulaRow(ok, 'weekday')), []);
  assert.deepEqual(validateSections(formulaRow({ ...ok, day: 'friday' }, 'weekday')).map(i => i.path), ['sections[0].rows[0].time.formula.day']);
  assert.deepEqual(validateSections(formulaRow({ ...ok, day: 'shabbat' }, 'shabbat')), []);
  assert.deepEqual(validateSections(formulaRow({ ...ok, day: 'earliest' }, 'shabbat')).map(i => i.path), ['sections[0].rows[0].time.formula.day']);
  assert.deepEqual(validateSections(formulaRow({ ...ok, offset: { minutes: 721, direction: 'before' } }, 'weekday')).map(i => i.path), ['sections[0].rows[0].time.formula.offset.minutes']);
  assert.deepEqual(validateSections(formulaRow({ ...ok, offset: { minutes: 1.5, direction: 'before' } }, 'weekday')).map(i => i.path), ['sections[0].rows[0].time.formula.offset.minutes']);
  assert.deepEqual(validateSections(formulaRow({ ...ok, rounding: { mode: 'down', step: 7 as 5 } }, 'weekday')).map(i => i.path), ['sections[0].rows[0].time.formula.rounding.step']);
  assert.deepEqual(validateSections(formulaRow({ ...ok, notLaterThan: '25:00' }, 'weekday')).map(i => i.path), ['sections[0].rows[0].time.formula.notLaterThan']);
  assert.deepEqual(validateSections(sectionsWith({ time: { kind: 'fixed', at: '8:30' } })).map(i => i.path), ['sections[0].rows[0].time.at']);
  assert.deepEqual(validateSections(sectionsWith({ day: 'friday' })).map(i => i.path), ['sections[0].rows[0].day'], 'Row.day only in Shabbat sections');
  assert.deepEqual(validateSections(sectionsWith({ day: 'friday' }, 'shabbat')), []);
});

test('validation of week overrides: shape and caps, server paths', () => {
  assert.deepEqual(validateWeekOverrides({ rows: { a: { kind: 'time', at: '12:45', note: 'x' }, b: { kind: 'hide' } }, extra: [{ id: 'x', sectionId: 's', label: { he: 'קידוש' }, time: { kind: 'none' } }] }), []);
  assert.deepEqual(validateWeekOverrides({ rows: { a: { kind: 'time', at: '99:99' } } }).map(i => i.path), ['rows.a.at']);
  assert.deepEqual(validateWeekOverrides({ rows: { a: { kind: 'time', at: '12:00', note: 'n'.repeat(201) } } }).map(i => i.path), ['rows.a.note']);
  assert.deepEqual(validateWeekOverrides({ extra: [{ id: 'x', sectionId: 's', label: { he: '' }, time: { kind: 'none' } }] }).map(i => i.path), ['extra[0].label.he']);
  const tooMany = Array.from({ length: 41 }, (_, i) => ({ id: `x${i}`, sectionId: 's', label: { he: 'a' }, time: { kind: 'none' as const } }));
  assert.deepEqual(validateWeekOverrides({ extra: tooMany }).map(i => [i.path, i.code]), [['extra', 'count']]);
});

test('an issue path maps to the row and the control it belongs to', () => {
  const sections = doc().sections;
  assert.deepEqual(issueTarget('sections[1].rows[2].time.formula.rounding.step', sections), { sectionId: 'wd', rowId: 'e', control: 'rounding' });
  assert.deepEqual(issueTarget('sections[1].rows[0].label.he', sections), { sectionId: 'wd', rowId: 'c', control: 'label' });
  assert.deepEqual(issueTarget('sections[0].rows[1].time.at', sections), { sectionId: 'sh', rowId: 'b', control: 'time' });
  assert.deepEqual(issueTarget('sections[0].rows[0].note', sections), { sectionId: 'sh', rowId: 'a', control: 'note' });
  assert.deepEqual(issueTarget('sections[0].title.he', sections), { sectionId: 'sh', rowId: null, control: 'title' });
  assert.deepEqual(issueTarget('sections[1].rows[2].time.formula.notLaterThan', sections), { sectionId: 'wd', rowId: 'e', control: 'notLaterThan' });
  assert.deepEqual(issueTarget('sections[0].rows[0].time.formula.offset.minutes', sections), { sectionId: 'sh', rowId: 'a', control: 'minutes' });
  assert.deepEqual(issueTarget('sections', sections), { sectionId: null, rowId: null, control: 'sections' });
  assert.equal(issueTarget('sections[9].rows[0].label.he', sections).rowId, null);
});

// ---- clock input ---------------------------------------------------------------------------------------------------

test('time fields accept 830, 8:30 and 08:30', () => {
  for (const [input, out] of [['830', '08:30'], ['8:30', '08:30'], ['08:30', '08:30'], ['0830', '08:30'], ['1645', '16:45'], ['16:45', '16:45'], ['8.30', '08:30'], [' 9:05 ', '09:05'], ['000', '00:00']] as const) {
    assert.equal(parseClockInput(input), out, input);
  }
  for (const input of ['', '8', '24:00', '8:60', '99', 'abc', '12345', '8:3']) assert.equal(parseClockInput(input), null, input);
});

test('arrow keys nudge a time by 5 minutes and wrap nowhere', () => {
  assert.equal(nudgeClock('08:30', 5), '08:35');
  assert.equal(nudgeClock('08:58', 5), '09:03');
  assert.equal(nudgeClock('23:58', 5), '23:59');
  assert.equal(nudgeClock('00:02', -5), '00:00');
});

test('nextId finds the lowest free id with the prefix', () => {
  assert.equal(nextId('r', new Set()), 'r1');
  assert.equal(nextId('r', new Set(['r1', 'r2', 'r4'])), 'r3');
});

// ---- the result box: explanation, per-day breakdown ------------------------------------------------------------

const mincha: Formula = { anchor: 'sunset', day: 'earliest', offset: { minutes: 15, direction: 'before' }, rounding: { mode: 'down', step: 5 }, notLaterThan: '18:30' };

test('explainFormula agrees with evaluate and shows each step', () => {
  const e = explainFormula(mincha, week, zmanim)!;
  assert.equal(e.result, evaluate(mincha, week, zmanim));
  assert.equal(e.days.length, 5);
  assert.deepEqual(e.days.map(d => d.date), week.weekdays);
  const picked = e.days[e.pick]!;
  assert.equal(picked.anchor, e.steps.anchor);
  const minutes = (c: string) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3));
  assert.equal(minutes(e.steps.afterOffset), minutes(e.steps.anchor) - 15);
  assert.equal(minutes(e.steps.rounded) % 5, 0);
  assert.ok(minutes(e.steps.rounded) <= minutes(e.steps.afterOffset));
  assert.equal(Math.min(...e.days.map(d => minutes(d.anchor!))), minutes(picked.anchor!), 'earliest is the picked day');
});

test('explainFormula for a Friday formula has one day; for latest it picks the latest', () => {
  const candles: Formula = { anchor: 'candleLighting', day: 'friday', offset: { minutes: 0, direction: 'before' }, rounding: { mode: 'none' } };
  const e = explainFormula(candles, week, zmanim)!;
  assert.equal(e.days.length, 1);
  assert.equal(e.days[0]!.date, week.friday);
  const latest = explainFormula({ ...mincha, anchor: 'tzeit', day: 'latest', offset: { minutes: 0, direction: 'after' }, notLaterThan: undefined }, week, zmanim)!;
  const minutes = (c: string) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3));
  assert.equal(minutes(latest.days[latest.pick]!.anchor!), Math.max(...latest.days.map(d => minutes(d.anchor!))));
});

test('explainFormula reports which bound won, and null when a zman is missing', () => {
  const tight = explainFormula({ ...mincha, notLaterThan: '10:00' }, week, zmanim)!;
  assert.equal(tight.bound, 'notLaterThan');
  assert.equal(tight.result, '10:00');
  assert.equal(explainFormula(mincha, week, zmanim)!.bound, null);
  assert.equal(explainFormula(mincha, week, () => null), null);
});

// ---- warnings ---------------------------------------------------------------------------------------------------

const codes = (formula: Formula, kind: 'shabbat' | 'weekday', w = week) => formulaWarnings(formula, kind, w, zmanim).map(x => x.code);

test('warning: ends after sunset although it is "before" (rounding up pushes it past), with a one-tap fix', () => {
  const rowUp: Formula = { anchor: 'sunset', day: 'earliest', offset: { minutes: 1, direction: 'before' }, rounding: { mode: 'up', step: 15 } };
  const w = formulaWarnings(rowUp, 'weekday', week, zmanim);
  const hit = w.find(x => x.code === 'afterSunset');
  assert.ok(hit, JSON.stringify(w));
  assert.deepEqual(hit!.fix, { roundMode: 'down' });
  assert.deepEqual(codes({ ...rowUp, rounding: { mode: 'down', step: 15 } }, 'weekday'), []);
  assert.deepEqual(codes({ anchor: 'sunset', day: 'earliest', offset: { minutes: 15, direction: 'before' }, rounding: { mode: 'none' } }, 'weekday'), []);
});

test('warning: Shabbat end or nightfall rounded down comes out earlier than the exact time', () => {
  const end: Formula = { anchor: 'shabbatEnd', day: 'shabbat', offset: { minutes: 0, direction: 'before' }, rounding: { mode: 'down', step: 15 } };
  const exact = evaluate({ ...end, rounding: { mode: 'none' } }, week, zmanim)!;
  const rounded = evaluate(end, week, zmanim)!;
  const hit = formulaWarnings(end, 'shabbat', week, zmanim).find(x => x.code === 'earlyEnd');
  if (exact === rounded) assert.equal(hit, undefined);
  else { assert.ok(hit); assert.deepEqual(hit!.fix, { roundMode: 'up' }); assert.deepEqual(hit!.params, { time: rounded, exact }); }
  // a week where the exact time is certainly not on a 15 minute mark
  const w2 = scheduleWeekOf('2026-11-13');
  const exact2 = evaluate({ ...end, rounding: { mode: 'none' } }, w2, zmanim)!;
  const rounded2 = evaluate(end, w2, zmanim)!;
  if (exact2 !== rounded2) assert.ok(formulaWarnings(end, 'shabbat', w2, zmanim).some(x => x.code === 'earlyEnd'));
});

test('warning: candle lighting rounded up is later than the exact time', () => {
  const found = [week, scheduleWeekOf('2026-11-13'), scheduleWeekOf('2026-11-20'), scheduleWeekOf('2026-11-27')].some(w => {
    const f: Formula = { anchor: 'candleLighting', day: 'friday', offset: { minutes: 0, direction: 'before' }, rounding: { mode: 'up', step: 10 } };
    const exact = evaluate({ ...f, rounding: { mode: 'none' } }, w, zmanim)!;
    const rounded = evaluate(f, w, zmanim)!;
    const hit = formulaWarnings(f, 'shabbat', w, zmanim).find(x => x.code === 'lateCandles');
    if (exact === rounded) { assert.equal(hit, undefined); return false; }
    assert.ok(hit); assert.deepEqual(hit!.fix, { roundMode: 'down' }); return true;
  });
  assert.ok(found, 'at least one of the weeks is off the 10 minute mark');
});

test('warning: crossing bounds, and a bound that wins every day', () => {
  const crossing: Formula = { ...mincha, notEarlierThan: '18:00', notLaterThan: '17:00' };
  assert.ok(codes(crossing, 'weekday').includes('boundsCross'));
  assert.ok(!codes(mincha, 'weekday').includes('boundsCross'));
  assert.ok(codes({ ...mincha, notLaterThan: '10:00' }, 'weekday').includes('boundWins'));
  assert.ok(codes({ ...mincha, notEarlierThan: '23:00', notLaterThan: undefined }, 'weekday').includes('boundWins'));
  assert.ok(!codes(mincha, 'weekday').includes('boundWins'));
});

// ---- hide-row suggestions for a sheet that is too long --------------------------------------------------------------

test('hide suggestions: text rows and long names first, never candles, never rows already hidden', () => {
  const longLabel = 'שיעור מיוחד בנושא הלכות שבת ומועד מפי הרב לדוגמה מספר שלוש';
  const schedule = {
    version: 1 as const,
    sections: [
      { id: 'sh', kind: 'shabbat' as const, title: { he: 'שבת' }, rows: [{ ...fixed('candles', 'נרות', '16:00'), role: 'candles' as const }, fixed('a', 'שחרית', '08:30'), { id: 't', label: { he: 'שיעורים אחרי התפילה' }, time: { kind: 'none' as const } }, fixed('l', longLabel, '10:00')] },
      { id: 'wd', kind: 'weekday' as const, title: { he: 'חול' }, rows: [fixed('c', 'שחרית', '06:15'), fixed('h', 'מוסתר ' + longLabel, '07:00')] },
    ],
    weekOverrides: { [week.friday]: { rows: { h: { kind: 'hide' as const } } } },
  };
  const computed = computeWeek(schedule, week.friday, zmanim);
  const out = hideSuggestions(computed, 3);
  assert.deepEqual(out.map(r => r.id), ['t', 'l', 'a']);
  assert.ok(!out.some(r => r.id === 'candles' || r.id === 'h'));
  assert.equal(hideSuggestions(computed, 1).length, 1);
});

// ---- weeks -------------------------------------------------------------------------------------------------------------

test('the clock-change week of late October is marked', () => {
  assert.equal(clockChangeIn(scheduleWeekOf('2026-10-23')), 'winter');
  assert.equal(clockChangeIn(scheduleWeekOf('2026-10-30')), null);
  assert.equal(clockChangeIn(scheduleWeekOf('2027-03-26')), 'summer');
});

test('week list starts at the current schedule week and marks the coming Shabbat', () => {
  const sunday = weekList('2026-10-25', 4);
  assert.equal(sunday[0]!.friday, '2026-10-23');
  assert.equal(sunday[0]!.upcoming, false, 'its Shabbat has passed');
  assert.equal(sunday[1]!.upcoming, true);
  assert.equal(sunday.length, 4);
  assert.equal(sunday[0]!.clockChange, 'winter');
  const friday = weekList('2026-10-30', 3);
  assert.equal(friday[0]!.upcoming, true);
  assert.equal(friday.filter(w => w.upcoming).length, 1);
});

test('week-only edits are possible for the weeks the server sends: the current and the next', () => {
  assert.equal(weekEditable('2026-10-23', '2026-10-25'), true);
  assert.equal(weekEditable('2026-10-30', '2026-10-25'), true);
  assert.equal(weekEditable('2026-11-06', '2026-10-25'), false);
  assert.equal(weekEditable('2026-10-16', '2026-10-25'), false);
});

// ---- the classic structure ----------------------------------------------------------------------------------------------

test('the classic layout is a valid schedule with a candle row', () => {
  const sections = classicSections();
  assert.deepEqual(validateSections(sections), []);
  assert.deepEqual(sections.map(s => s.kind), ['shabbat', 'weekday']);
  assert.ok(sections[0]!.rows.some(r => r.role === 'candles'));
  const all = sections.flatMap(s => s.rows);
  assert.ok(all.some(r => r.time.kind === 'none'));
  assert.ok(all.some(r => r.time.kind === 'formula'));
  assert.equal(new Set(all.map(r => r.id)).size, all.length);
});

// ---- a section as the editor lists it ---------------------------------------------------------------------------------------------------

test('section items: hidden rows stay, extras follow their row or go last', () => {
  const friday = week.friday;
  const schedule = {
    version: 1 as const, sections: doc().sections,
    weekOverrides: { [friday]: { rows: { d: { kind: 'hide' as const }, a: { kind: 'time' as const, at: '09:00' } }, extra: [
      { id: 'x1', sectionId: 'wd', afterRowId: 'c', label: { he: 'שיעור' }, time: { kind: 'fixed' as const, at: '20:00' } },
      { id: 'x2', sectionId: 'wd', label: { he: 'סוף' }, time: { kind: 'none' as const } },
      { id: 'x3', sectionId: 'wd', afterRowId: 'gone', label: { he: 'יתום' }, time: { kind: 'none' as const } },
    ] } },
  };
  const computed = computeWeek(schedule, friday, zmanim);
  const items = sectionItems(schedule.sections[1]!, schedule.weekOverrides[friday], computed.sections[1]);
  assert.deepEqual(items.map(i => (i.kind === 'row' ? i.row.id : i.extra.id)), ['c', 'x1', 'd', 'e', 'x2', 'x3']);
  const d = items.find(i => i.kind === 'row' && i.row.id === 'd')!;
  assert.equal(d.kind === 'row' && d.hidden, true);
  assert.equal(d.computed?.time, '08:00', 'a hidden row still has its usual time');
  const a = sectionItems(schedule.sections[0]!, schedule.weekOverrides[friday], computed.sections[0])[0]!;
  assert.equal(a.kind === 'row' && a.computed?.time, '09:00');
  assert.equal(weekChanges(schedule.weekOverrides[friday]), 5);
  assert.equal(weekChanges(undefined), 0);
});

test('leaving the editor asks only when there are unsaved changes', () => {
  assert.equal(editorLeaveAsk('scheduleEditor', true), true);
  assert.equal(editorLeaveAsk('scheduleEditor', false), false);
  assert.equal(editorLeaveAsk('overview', true), false);
});
