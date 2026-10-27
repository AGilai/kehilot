import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureScheduleDoc } from '../src/client/fixtures.ts';
import type { Message } from '../src/client/types.ts';
import { esc, safeImage, sheetBodyHtml, sheetHtml } from '../src/schedule/sheetHtml.ts';
import { BASE_FIT, fitSheet, innerBox, mazalParts, neededHeight, sheetLayout, sheetModel, textLines, weekCelebrations } from '../src/schedule/sheetModel.ts';
import type { Celebration, SheetModel, SheetVariant } from '../src/schedule/sheetModel.ts';
import type { Row, ScheduleDoc } from '../src/schedule/types.ts';
import { computeWeek } from '../src/schedule/week.ts';
import { offlineZmanimFor } from '../src/schedule/zmanim.ts';

const FRIDAY = '2026-10-30';
const zf = offlineZmanimFor();
const doc = fixtureScheduleDoc(FRIDAY);
const mazal: Celebration[] = [
  { id: 'c1', title: 'מזל טוב למשה ורחל בדיוני', body: 'להולדת הנכדה, בת לשירה ואורי דוגמה. שתזכו לגדלה לתורה, לחופה ולמעשים טובים', family: 'בדיוני' },
  { id: 'c2', title: 'מזל טוב לדני ונועה ניסיון', body: 'לרגל בר המצווה של הבן איתי', family: 'ניסיון' },
];
const build = (over: Partial<{ doc: ScheduleDoc; celebrations: Celebration[]; variant: SheetVariant; pinned: SheetModel['pinned'] }> = {}) => {
  const d = over.doc ?? doc;
  return sheetModel({
    doc: d, week: computeWeek(d, FRIDAY, zf), kehilaName: 'קהילת אור הדוגמה', logoUri: null,
    celebrations: over.celebrations ?? mazal, pinned: over.pinned ?? null, variant: over.variant ?? 'a4',
  });
};
const withRows = (extra: Row[], section = 1): ScheduleDoc => ({ ...doc, sections: doc.sections.map((s, i) => (i === section ? { ...s, rows: [...s.rows, ...extra] } : s)) });
const fixed = (id: string, label: string, at = '21:00'): Row => ({ id, label: { he: label }, time: { kind: 'fixed', at } });

// ---- model -----------------------------------------------------------------------------------------------------------

test('model: parasha title, dates, columns with Shabbat first, candle band with both cities', () => {
  const m = build();
  assert.equal(m.parasha, 'וירא');
  assert.equal(m.civilDate, '31.10.2026');
  assert.match(m.hebrewDate, /חשוון/);
  assert.equal(m.shabbat!.title, 'שבת קודש');
  assert.equal(m.weekday!.title, 'תפילות ימי החול');
  const band = m.shabbat!.band!;
  assert.equal(band.kind, 'candles');
  if (band.kind === 'candles') assert.deepEqual(band.cities.map(c => c.name), ['ירושלים', 'ת״א']);
  const wb = m.weekday!.band!;
  assert.equal(wb.kind, 'dates');
  assert.equal(m.initial, 'א');
});

test('model: the candle row is the band, not a row; hidden rows are left off', () => {
  const m = build();
  assert.ok(!m.shabbat!.rows.some(r => r.id === 'candles'));
  const hidden: ScheduleDoc = { ...doc, weekOverrides: { [FRIDAY]: { rows: { 's-daf2': { kind: 'hide' } } } } };
  assert.ok(!build({ doc: hidden }).shabbat!.rows.some(r => r.id === 's-daf2'));
});

test('model: an override gets an asterisk and the footnote; no overrides, no footnote', () => {
  const m = build();
  const gedola = m.shabbat!.rows.find(r => r.id === 's-gedola')!;
  assert.equal(gedola.override, true);
  assert.equal(gedola.kind === 'row' && gedola.time, '12:45');
  assert.equal(m.footnote, true);
  assert.equal(m.shabbat!.rows.filter(r => r.override).length, 1);
  const plain = build({ doc: { ...doc, weekOverrides: {} } });
  assert.equal(plain.footnote, false);
  assert.ok(!plain.shabbat!.rows.some(r => r.override));
  const html = sheetBodyHtml(m);
  assert.match(html, /מנחה גדולה \*/);
  assert.match(html, /\* שינוי לשבוע זה/);
  assert.doesNotMatch(sheetBodyHtml(plain), /שינוי לשבוע זה/);
});

test('model: an extra row of the week counts as a change too', () => {
  const extra: ScheduleDoc = { ...doc, weekOverrides: { [FRIDAY]: { extra: [{ id: 'x1', sectionId: 'shabbat', label: { he: 'קידוש לכבוד בר המצווה' }, time: { kind: 'none' } }] } } };
  const m = build({ doc: extra });
  const row = m.shabbat!.rows.find(r => r.id === 'x1')!;
  assert.equal(row.kind, 'text');
  assert.equal(row.override, true);
  assert.equal(m.footnote, true);
});

test('model: text rows stay text; group gaps follow text lines and 3-hour jumps', () => {
  const m = build();
  const rows = m.weekday!.rows;
  assert.equal(rows.find(r => r.id === 'w-gedola')!.gap, true); // 08:00 -> 13:15
  assert.equal(rows.find(r => r.id === 'w-daf')!.gap, false);
  assert.equal(m.shabbat!.rows.find(r => r.id === 's-shiur')!.kind, 'text');
  assert.equal(m.shabbat!.rows.find(r => r.id === 's-gedola')!.gap, true); // after the text line
});

test('mazal tov: a guest with no celebration messages prints none; the block is the week\'s celebrations only', () => {
  assert.equal(build({ celebrations: [] }).mazalTov.length, 0);
  assert.doesNotMatch(sheetBodyHtml(build({ celebrations: [] })), /class="mt"/);
  const id = (ms: number, n: number) => {
    const C = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let t = ''; let v = ms;
    for (let i = 0; i < 10; i++) { t = C[v % 32] + t; v = Math.floor(v / 32); }
    return t + '0000000000000000'.slice(0, 15) + C[n % 32];
  };
  const msg = (date: string, type: Message['type'], n: number, title = 'מזל טוב'): Message => ({
    messageId: id(Date.parse(`${date}T12:00:00+02:00`), n), channelId: 'c', type, title, body: '', authorId: 'a', authorName: 'a', authorKind: 'management', joinCount: 0, targetName: 'דוגמה',
  });
  const week = { friday: FRIDAY, thursday: '2026-11-05' };
  const got = weekCelebrations([
    msg('2026-10-24', 'celebration', 1, 'לפני השבוע'), msg('2026-10-25', 'celebration', 2, 'ראשון'), msg('2026-10-28', 'weekly', 3), msg('2026-10-29', 'celebration', 4, 'חמישי'), msg('2026-11-06', 'celebration', 5, 'אחרי'),
  ], week);
  assert.deepEqual(got.map(c => c.title), ['ראשון', 'חמישי']);
});

test('mazal tov: the family name is bold; square drops the body', () => {
  assert.deepEqual(mazalParts('מזל טוב למשה בדיוני היקר', 'בדיוני'), [{ text: 'מזל טוב למשה ', bold: false }, { text: 'בדיוני', bold: true }, { text: ' היקר', bold: false }]);
  assert.deepEqual(mazalParts('מזל טוב', 'אחר'), [{ text: 'מזל טוב', bold: false }]);
  assert.equal(build({ variant: 'square' }).mazalTov[0]!.body, '');
  assert.ok(build().mazalTov[0]!.body.length > 0);
});

test('model: square has no pinned notice and a short candle label', () => {
  const m = build({ variant: 'square', pinned: { title: 'ערב לימוד' } });
  assert.equal(m.pinned, null);
  const band = m.shabbat!.band!;
  assert.equal(band.kind === 'candles' && band.label, 'נרות');
});

// ---- fitting ---------------------------------------------------------------------------------------------------------

test('fit: the fixture sheet fits at the base size on both variants', () => {
  for (const variant of ['a4', 'square'] as const) {
    const m = build({ variant });
    assert.deepEqual(fitSheet(m), BASE_FIT(variant));
    assert.ok(neededHeight(m, BASE_FIT(variant)) <= sheetLayout(variant, BASE_FIT(variant)).h);
  }
});

test('fit: steps run in the stated order; the first that fits wins', () => {
  const many = Array.from({ length: 9 }, (_, i) => fixed(`m${i}`, `שורה ארוכה מספר ${i + 1} בלוח`, `${10 + i}:00`));
  let order = 0;
  for (let n = 0; n <= 14; n++) {
    const extra = Array.from({ length: n }, (_, i) => fixed(`e${i}`, `שורה נוספת מספר ${i + 1}`, `${(10 + i) % 24}:15`));
    const m = build({ doc: withRows([...many.slice(0, 4), ...extra]), pinned: { imageUri: 'data:image/png;base64,AAAA', title: 'ערב לימוד' } });
    const f = fitSheet(m);
    // Each fit step is cumulative: a later step never has an earlier one undone.
    const rank = f.droppedMazal > 0 ? 6 : f.dropImage ? 5 : f.tight ? 4 : f.rowFont < 14.5 ? 3 : f.imageScale < 1 ? 2 : f.mazalFont < 13 ? 1 : 0;
    assert.ok(rank >= order, `rank ${rank} after ${order} at ${n} extra rows`);
    order = rank;
    if (!f.overflow) assert.ok(neededHeight(m, f) <= 842, `fits at ${n}`);
    if (rank >= 3) assert.ok(f.imageScale <= 0.3 + 1e-9 && f.mazalFont === 12);
    if (rank >= 4) assert.equal(f.rowFont, 12.5);
  }
  assert.ok(order >= 3, 'the long fixtures exercise the row-font step');
});

test('fit: mazal tov goes to 12 first, then the picture shrinks (never below 30%)', () => {
  const long: Celebration[] = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, title: `מזל טוב למשפחת בדיוני מספר ${i} להולדת הנכד`, body: 'שתזכו לגדלו לתורה, לחופה ולמעשים טובים ולהרבה נחת', family: 'בדיוני' }));
  const m = build({ celebrations: long, pinned: { imageUri: 'data:image/png;base64,AAAA' } });
  const f = fitSheet(m);
  assert.ok(f.mazalFont === 12 || f.imageScale < 1 || f.rowFont < 14.5 || f.dropImage || f.droppedMazal > 0);
  assert.ok(f.imageScale >= 0.3);
});

test('fit: absurdly long labels and rows set overflow instead of a second page, and drop optional parts first', () => {
  const rows = Array.from({ length: 40 }, (_, i) => fixed(`x${i}`, 'שיעור מיוחד בנושא ארוך מאוד של הלכות שבת ומועד לכל הקהל', `${String(6 + (i % 17)).padStart(2, '0')}:00`));
  const m = build({ doc: withRows(rows), pinned: { imageUri: 'data:image/png;base64,AAAA' } });
  const f = fitSheet(m);
  assert.equal(f.overflow, true);
  assert.equal(f.dropImage, true);
  assert.equal(f.droppedMazal, m.mazalTov.length);
  assert.equal(f.rowFont, 12.5);
  assert.deepEqual(f.dropped.map(d => d.kind), ['image', ...m.mazalTov.map(() => 'mazal')]);
  assert.ok(f.scale >= 0.75);
});

test('fit: the square never goes below 12.5 for rows, and whatever is dropped is listed', () => {
  const rows = Array.from({ length: 12 }, (_, i) => fixed(`q${i}`, `שורה מספר ${i + 1}`, `${10 + i}:00`));
  const m = build({ doc: withRows(rows), variant: 'square' });
  const f = fitSheet(m);
  assert.ok(f.rowFont >= 12.5);
  assert.equal(f.dropped.length, f.droppedMazal + (f.dropImage ? 1 : 0));
  assert.deepEqual(fitSheet(build()).dropped, []);
});

test('fit: long labels wrap instead of clipping, and cost height', () => {
  const short = build();
  const long = build({ doc: withRows([fixed('l1', 'מנחה גדולה וסעודה שלישית עם דברי תורה מפי הרב ושירה בציבור'), fixed('l2', 'ערבית')]) });
  const a = neededHeight(short, BASE_FIT('a4'));
  const b = neededHeight(long, BASE_FIT('a4'));
  assert.ok(b > a + 20);
  assert.ok(textLines('מנחה גדולה וסעודה שלישית עם דברי תורה מפי הרב ושירה בציבור', 14.5, 150) >= 3);
  assert.equal(textLines('', 14, 100), 0);
  assert.equal(textLines('אבגדהוזחטיכלמנסעפצקרשת'.repeat(5), 14, 100) > 1, true);
});

// ---- html ------------------------------------------------------------------------------------------------------------

test('html: labels, notes, mazal tov, kehila name, title and logo are escaped', () => {
  const evil = '<img src=x onerror=alert(1)>"&\'';
  const rows = [fixed('ev', evil), { id: 'ev2', label: { he: evil }, time: { kind: 'none' } } as Row];
  const d = withRows(rows);
  d.sections[0]!.title = { he: evil };
  const m = sheetModel({
    doc: d, week: computeWeek(d, FRIDAY, zf), kehilaName: evil, logoUri: 'javascript:alert(1)',
    celebrations: [{ id: 'c', title: `מזל טוב ${evil}`, body: evil, family: evil }], pinned: { title: evil, line: evil, imageUri: '"><script>alert(1)</script>' }, variant: 'a4',
  });
  for (const html of [sheetHtml(m), sheetBodyHtml(m)]) {
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&amp;&#39;/);
  }
  const sq = sheetHtml(sheetModel({ ...{ doc: d, week: computeWeek(d, FRIDAY, zf), kehilaName: evil, logoUri: null, celebrations: [{ id: 'c', title: evil }].map(c => ({ ...c, body: '' })), variant: 'square' as const } }));
  assert.doesNotMatch(sq, /<img src=x/);
});

test('html: only data: and https: images pass', () => {
  assert.equal(safeImage('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(safeImage('https://example.invalid/a.png'), 'https://example.invalid/a.png');
  for (const bad of ['javascript:alert(1)', 'http://example.invalid/a.png', 'data:text/html;base64,AAAA', 'data:image/png;base64,"onerror=x', '', null, undefined]) assert.equal(safeImage(bad), '');
  assert.equal(esc('<&>"\''), '&lt;&amp;&gt;&quot;&#39;');
});

test('html: A4 page size, the footnote only with changes, the initial tile without a logo, the logo with one', () => {
  const m = build();
  const html = sheetHtml(m);
  assert.match(html, /@page\{size:595px 842px;margin:0\}/);
  assert.match(html, /class="logo ph">א</);
  assert.match(html, /שבת פרשת <b>וירא<\/b>/);
  const withLogo = sheetModel({ doc, week: computeWeek(doc, FRIDAY, zf), kehilaName: 'קהילה', logoUri: 'data:image/png;base64,AAAA', celebrations: [], variant: 'a4' });
  assert.match(sheetHtml(withLogo), /<img src="data:image\/png;base64,AAAA"/);
  assert.match(sheetHtml(build({ variant: 'square' })), /size:540px 540px/);
});

test('fit: too long for the steps shrinks everything uniformly instead of clipping; the inner box fills the content area exactly', () => {
  const rows = Array.from({ length: 22 }, (_, i) => fixed(`s${i}`, 'שיעור מיוחד בנושא ארוך של הלכות שבת ומועד לכל הקהל', `${String(6 + (i % 17)).padStart(2, '0')}:00`));
  const m = build({ doc: withRows(rows), variant: 'square' });
  const f = fitSheet(m);
  assert.equal(f.overflow, true);
  assert.ok(f.scale < 1 && f.scale >= 0.75, `scale ${f.scale}`);
  assert.ok(neededHeight(m, f) <= 540 || f.scale === 0.75, 'fits after the shrink');
  const box = innerBox('square', f);
  const L = sheetLayout('square', f);
  assert.ok(Math.abs(box.w * f.scale - L.bodyW) < 1e-6);
  assert.ok(Math.abs(box.h * f.scale - (L.h - L.padTop - L.padBottom)) < 1e-6);
  assert.match(sheetBodyHtml(m), /transform:scale\(/);
  assert.doesNotMatch(sheetBodyHtml(build()), /transform:scale/);
});
