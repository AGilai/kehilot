import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { checkGroups, decodeCsv, mapRows, parseCsv, readXlsx } from '../src/import/parse.ts';

const HDR = 'שם פרטי,שם משפחה,אימייל,תפקיד,סיווג';

test('decodes windows-1255', () => {
  // "דנה" in windows-1255: ד=0xE3, נ=0xF0, ה=0xE4 (not valid UTF-8)
  assert.equal(decodeCsv(new Uint8Array([0xe3, 0xf0, 0xe4])), 'דנה');
});

test('strips UTF-8 BOM', () => {
  const b = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8('a,b')]);
  assert.equal(decodeCsv(b), 'a,b');
});

test('decodes UTF-16LE with BOM', () => {
  const b = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00]);
  assert.equal(decodeCsv(b), 'ab');
});

test('quoted comma and newline', () => {
  const t = parseCsv('a,"b,c","d\ne ""q"""\r\n\r\nx,y,z\r\n');
  assert.deepEqual(t, [['a', 'b,c', 'd\ne "q"'], ['x', 'y', 'z']]);
});

test('semicolon delimiter detected', () => {
  assert.deepEqual(parseCsv('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('Hebrew headers map', () => {
  const r = mapRows(parseCsv(`${HDR}\nדנה,בדויה,Dana@Example.com,חבר,א\nיוסי,בדיוני,yossi@example.com,אורח,`));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.rows, [
    { firstName: 'דנה', lastName: 'בדויה', email: 'dana@example.com', role: 'member', classification: 'א' },
    { firstName: 'יוסי', lastName: 'בדיוני', email: 'yossi@example.com', role: 'listener', classification: '' },
  ]);
});

test('English headers, gabbai and קבוע', () => {
  const r = mapRows(parseCsv('First Name,Last Name,E-mail,Role,Classification\nA,B,a@x.org,Gabbai,קבוע'));
  assert.equal(r.rows[0]!.role, 'gabbai');
  assert.equal(r.rows[0]!.classification, 'קבוע');
});

test('dedupes case-insensitively', () => {
  const r = mapRows(parseCsv(`${HDR}\nA,B,a@x.org,,\nC,D,A@X.ORG,,`));
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.problems, [{ line: 3, code: 'duplicate_email' }]);
});

test('bad role reported by line', () => {
  const r = mapRows(parseCsv(`${HDR}\nA,B,a@x.org,נשיא,\nC,D,c@x.org,חבר,`));
  assert.deepEqual(r.problems, [{ line: 2, code: 'invalid_role' }]);
  assert.equal(r.rows.length, 1);
});

test('empty role means member', () => {
  const r = mapRows(parseCsv(`${HDR}\nA,B,a@x.org,,`));
  assert.equal(r.rows[0]!.role, 'member');
});

test('missing required column is one problem on line 1', () => {
  const r = mapRows(parseCsv('שם פרטי,אימייל\nA,a@x.org'));
  assert.deepEqual(r.problems, [{ line: 1, code: 'missing_column' }]);
  assert.deepEqual(r.rows, []);
});

test('groups column split and trimmed', () => {
  const r = mapRows(parseCsv(`${HDR},קבוצות\nA,B,a@x.org,חבר,,"נוער; כולל | , בית כנסת ,"`));
  assert.deepEqual(r.rows[0]!.groups, ['נוער', 'כולל', 'בית כנסת']);
  const many = Array.from({ length: 25 }, (_, i) => `g${i}`).join(';');
  assert.equal(mapRows(parseCsv(`${HDR},groups\nA,B,a@x.org,,,${many}`)).rows[0]!.groups!.length, 20);
});

test('unknown group reported by line', () => {
  const r = mapRows(parseCsv(`${HDR},groups\nA,B,a@x.org,,,נוער\nC,D,c@x.org,,,Nowhere\nE,F,e@x.org,,,`));
  assert.deepEqual(checkGroups(r.rows, ['נוער', 'כולל']), [{ line: 3, code: 'unknown_group' }]);
  assert.deepEqual(checkGroups(r.rows, ['נוער', 'nowhere']), []);
});

test('reads a minimal xlsx', () => {
  const sst = '<sst><si><t>שם פרטי</t></si><si><t>שם משפחה</t></si><si><t>אימייל</t></si><si><t>Tom &amp; Jerry</t></si></sst>';
  const sheet = '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="C2" t="inlineStr"><is><t>a@x.org</t></is></c><c r="D2"><v>42</v></c></row>'
    + '</sheetData></worksheet>';
  const zip = zipSync({ 'xl/sharedStrings.xml': strToU8(sst), 'xl/worksheets/sheet1.xml': strToU8(sheet) });
  assert.deepEqual(readXlsx(zip), [['שם פרטי', 'שם משפחה', 'אימייל'], ['Tom & Jerry', '', 'a@x.org', '42']]);
});

import { runBatches } from '../src/import/parse.ts';
import type { ImportResult, ImportRow } from '../src/client/types.ts';
const mk = (n: number): ImportRow[] => Array.from({ length: n }, (_, i) => ({ firstName: 'A', lastName: 'B', email: `u${i}@x.org`, role: 'member', classification: '' }));

test('batches of 10, skipped rows are sent again', async () => {
  const sizes: number[] = []; let first = true;
  const sum = await runBatches(mk(12), mk(12).map((_, i) => i + 2), async b => {
    sizes.push(b.length);
    return b.map((_, index): ImportResult => (first && index === 3 ? (first = false, { index, status: 'skipped' }) : { index, status: 'created' }));
  }, () => {});
  assert.deepEqual(sizes, [10, 3]); // 9 done + 1 skipped back in front of the remaining 2
  assert.equal(sum.counts.created, 12);
  assert.equal(sum.stopped, undefined);
});

test('stops on a non-retryable error, retries try_again', async () => {
  let calls = 0;
  const sum = await runBatches(mk(15), [], async b => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('x'), { code: 'try_again' });
    if (calls === 3) throw Object.assign(new Error('x'), { code: 'forbidden' });
    return b.map((_, index): ImportResult => ({ index, status: 'exists' }));
  }, () => {});
  assert.equal(sum.counts.exists, 10);
  assert.deepEqual(sum.stopped, { code: 'forbidden', remaining: 5 });
});

test('physical line numbers: blank line and multi-line quoted cell before a bad row', () => {
  const csv = `${HDR}\n\nA,"B\nC",a@x.org,,\nD,E,d@x.org,נשיא,\n`;
  // file lines: 1 header, 2 blank, 3-4 record A, 5 bad role
  assert.deepEqual(mapRows(parseCsv(csv)).problems, [{ line: 5, code: 'invalid_role' }]);
});

test('xlsx problem lines use the row r attribute', () => {
  const sst = '<sst><si><t>שם פרטי</t></si><si><t>שם משפחה</t></si><si><t>אימייל</t></si><si><t>תפקיד</t></si></sst>';
  const sheet = '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>A</t></is></c><c r="B2" t="inlineStr"><is><t>B</t></is></c><c r="C2" t="inlineStr"><is><t>a@x.org</t></is></c></row>'
    + '<row r="5"><c r="A5" t="inlineStr"><is><t>C</t></is></c><c r="B5" t="inlineStr"><is><t>D</t></is></c><c r="C5" t="inlineStr"><is><t>c@x.org</t></is></c><c r="D5" t="inlineStr"><is><t>נשיא</t></is></c></row>'
    + '</sheetData></worksheet>';
  const zip = zipSync({ 'xl/sharedStrings.xml': strToU8(sst), 'xl/worksheets/sheet1.xml': strToU8(sheet) });
  assert.deepEqual(mapRows(readXlsx(zip)).problems, [{ line: 5, code: 'invalid_role' }]);
});

test('xlsx first tab is resolved through workbook.xml and its rels', () => {
  const wb = '<workbook xmlns:r="x"><sheets><sheet name="Main" sheetId="2" r:id="rId7"/><sheet name="Other" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const rels = '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId7" Type="t" Target="worksheets/sheet3.xml"/></Relationships>';
  const mk = (v: string) => `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${v}</t></is></c></row></sheetData></worksheet>`;
  const zip = zipSync({ 'xl/workbook.xml': strToU8(wb), 'xl/_rels/workbook.xml.rels': strToU8(rels), 'xl/worksheets/sheet1.xml': strToU8(mk('wrong')), 'xl/worksheets/sheet3.xml': strToU8(mk('right')) });
  assert.deepEqual(readXlsx(zip), [['right']]);
});

test('delimiter detection ignores quoted text and finds tabs', () => {
  assert.deepEqual(parseCsv('"a;b;c;d",e,f\n1,2,3'), [['a;b;c;d', 'e', 'f'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a\tb\tc\n1\t2\t3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('try_again backs off 1s, 2s, 4s; unmount stops the loop', async () => {
  const waits: number[] = []; let calls = 0;
  const sum = await runBatches(mk(1), [], async () => { calls++; throw Object.assign(new Error('x'), { code: 'try_again' }); }, () => {}, { sleep: async ms => { waits.push(ms); } });
  assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(sum.stopped?.code, 'try_again');
  let stop = false; let sent = 0;
  const s2 = await runBatches(mk(25), [], async b => { sent++; stop = true; return b.map((_, index): ImportResult => ({ index, status: 'created' })); }, () => {}, { shouldStop: () => stop });
  assert.equal(sent, 1);
  assert.equal(s2.stopped?.code, 'aborted');
});
