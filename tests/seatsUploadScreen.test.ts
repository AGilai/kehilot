import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { exactDecisions, initialMatchState } from '../src/seats/decisions.ts';
import { fixtureHolderFamilies, fixtureHolders, createUploadFixture, fixtureResponsesCsv } from '../src/seats/fixtureUpload.ts';
import { inWeek, latestPerName, parseFormCsv } from '../src/seats/formCsv.ts';
import { normalizeName } from '../src/seats/match.ts';
import { familiesForMatch } from '../src/seats/savePlan.ts';
import { combineResults, planUpload, suggestForName } from '../src/seats/upload.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FRIDAY = '2026-10-30';

function fixturePlan(overrides: Set<string> = new Set()) {
  const fx = createUploadFixture(FRIDAY);
  const week = fx.adminWeek();
  const parsed = parseFormCsv(fixtureResponsesCsv(FRIDAY));
  assert.ok(parsed.ok);
  const win = inWeek(parsed.answers, FRIDAY);
  const answers = latestPerName(win.rows, normalizeName).latest;
  const holding = new Set(Object.keys(week.households).filter((r) => r.startsWith('family:')).map((r) => r.slice(7)));
  const families = familiesForMatch(fixtureHolderFamilies(), holding);
  const holders = fixtureHolders().map((h) => ({ id: h.holderId, name: h.name, phone: h.phone ?? undefined }));
  const results = answers.map((a) => suggestForName(normalizeName(a.name), a.name, families, holders));
  const decisions = exactDecisions(results, initialMatchState());
  return { fx, week, win, answers, results, decisions, plan: planUpload({ week, answers, decisions, overrides, prayers: ['erev', 'day'] }) };
}

test('the fixture export: this week only, the latest per household, an app answer kept, an error and a request-only row', () => {
  const { win, answers, plan, decisions } = fixturePlan();
  assert.equal(win.older, 1);
  assert.equal(answers.length, 8);
  assert.equal(answers.find((a) => a.name === 'בדיוני דנה')!.counts.erev, 1); // the later answer
  assert.equal(Object.keys(decisions).length, 7); // everyone but the request-only 'ש. משל' (no household of that name) matches exactly
  const by = (name: string) => plan.rows.find((r) => r.name === name);
  assert.equal(by('דמיון רון')!.conflict, true);
  assert.equal(by('בדיוני דנה')!.conflict, true);
  assert.equal(by('מדומה')!.noAccount, true);
  assert.equal(by('מדומה')!.status, 'change');
  assert.ok(plan.summary.kept >= 1);
});

test('apply then undo through the fixture server leaves the week as it was (one level)', () => {
  const { fx, week, plan } = fixturePlan(new Set());
  const before = JSON.stringify(week.prayers.erev.seats);
  const results = plan.calls.map((c) => fx.apply(c));
  const after = fx.adminWeek();
  assert.notEqual(JSON.stringify(after.prayers.erev.seats), before);
  assert.equal(after.prayers.erev.canUndo, true);
  const s = combineResults(results);
  assert.ok(s.released > 0);
  for (const c of plan.calls) fx.undoApply(c.event);
  assert.equal(JSON.stringify(fx.adminWeek().prayers.erev.seats), before);
  assert.throws(() => fx.undoApply('erev'), /nothing_to_undo/);
});

test('override sends the file over an app answer, and the server stand-in accepts it', () => {
  const { fx, plan } = fixturePlan(new Set([`family:${fixtureHolderFamilies()[4]!.familyId}`]));
  const dem = plan.rows.find((r) => r.name === 'דמיון רון')!;
  assert.equal(dem.overridden, true);
  assert.equal(dem.lines[0]!.kept, false);
  const erev = plan.calls.find((c) => c.event === 'erev')!;
  assert.ok(erev.rows.some((r) => r.override === true));
  const res = fx.apply(erev);
  assert.ok(!res.warnings.some((w) => w.code === 'app_answer_kept' && w.household.endsWith(fixtureHolderFamilies()[4]!.familyId)));
});

test('every seatUpload.* and seatHolders.* key used by the screens exists in he and en', () => {
  const flatten = (o: unknown, prefix = ''): Record<string, string> => Object.entries(o as Record<string, unknown>).reduce((acc, [k, v]) => (typeof v === 'string' ? { ...acc, [prefix + k]: v } : { ...acc, ...flatten(v, `${prefix}${k}.`) }), {} as Record<string, string>);
  const he = flatten(JSON.parse(read('src/i18n/he.json'))), en = flatten(JSON.parse(read('src/i18n/en.json')));
  const files = ['src/views/admin/SeatResponses.tsx', 'src/views/admin/SeatHolders.tsx', 'src/views/admin/Approvals.tsx', 'src/views/admin/Overview.tsx', ...readdirSync(new URL('../src/views/admin/seatUpload/', import.meta.url)).map((f) => `src/views/admin/seatUpload/${f}`)];
  const keys = new Set<string>();
  for (const f of files) for (const m of read(f).matchAll(/['"`](seat(?:Upload|Holders)\.[A-Za-z0-9_.-]+)['"`]/g)) keys.add(m[1]!);
  for (const e of ['label', 'shabbat', 'hag', 'megila']) keys.add(`seatUpload.event.${e}`);
  for (const p of ['empty', 'no-timestamp', 'no-name', 'no-counts', 'big', 'read']) keys.add(`seatUpload.problem.${p}`);
  for (const c of ['stamp', 'name', 'erev', 'day', 'unused', 'requests']) keys.add(`seatUpload.meaning.${c}`);
  for (const w of ['app_answer_kept', 'no_seats', 'above_seats']) keys.add(`seatUpload.warn.${w}`);
  for (const s of ['upload', 'columns', 'match', 'preview']) keys.add(`seatUpload.step.${s}`);
  for (const w of ['phone-surname', 'phone', 'surname-initial', 'spelling', 'surname-only', 'surname-other-initial', 'other']) keys.add(`seatHolders.why.${w}`);
  assert.ok(keys.size > 80);
  for (const key of keys) { assert.ok(he[key], `he ${key}`); assert.ok(en[key], `en ${key}`); }
});

test('Main opens the upload and holders screens only for a gabbai; the approval card and Overview take the new props', () => {
  const main = read('src/views/Main.tsx');
  assert.match(main, /case 'seatResponses':\s*body = seatEditorAllowed\(kehila\?\.role\) \? <SeatResponses/);
  assert.match(main, /case 'seatHolders':\s*body = seatEditorAllowed\(kehila\?\.role\) \? <SeatHolders/);
  assert.match(main, /<Approvals [^>]*onHolders=\{seatEditorAllowed/);
  assert.match(read('src/views/admin/Approvals.tsx'), /row\.seatSuggestions/);
});

test('the holders screen links only on the explicit confirm, with the holder updatedAt, and never from a suggestion alone', () => {
  const src = read('src/views/admin/SeatHolders.tsx');
  assert.equal((src.match(/linkSeatHolder\(/g) ?? []).length, 1);
  assert.match(src, /ifUpdatedAt: link\.holder\.updatedAt/);
  assert.match(src, /onPress=\{\(\) => \{ void doLink\(\); \}\}/);
});
