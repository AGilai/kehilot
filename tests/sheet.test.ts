import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureScheduleDoc, printItemsFixture } from '../src/client/fixtures.ts';
import type { SheetGroup } from '../src/client/types.ts';
import { buildSheet } from '../src/schedule/sheetSource.ts';
import { esc, safeImage, sheetBodyHtml, sheetHtml } from '../src/schedule/sheetHtml.ts';
import { BASE_FIT, MAX_EVENTS, MAX_MAZAL, fitSheet, innerBox, mazalParts, neededHeight, placement, sheetLayout, sheetModel, squareBand, textLines } from '../src/schedule/sheetModel.ts';
import type { SheetLineItem, SheetModel, SheetVariant } from '../src/schedule/sheetModel.ts';
import type { Row, ScheduleDoc } from '../src/schedule/types.ts';
import { computeWeek } from '../src/schedule/week.ts';
import { offlineZmanimFor } from '../src/schedule/zmanim.ts';

const FRIDAY = '2026-10-30';
const zf = offlineZmanimFor();
const doc = fixtureScheduleDoc(FRIDAY);
const li = (id: string, group: SheetGroup, text: string, bold: string, over: Partial<SheetLineItem> = {}): SheetLineItem => ({
  id, group, main: mazalParts(text, bold), sub: '', blessing: '', icon: group === 'mazal' ? 'heart' : null, cancelled: false, ...over,
});
const mazal: SheetLineItem[] = [
  li('c1', 'mazal', 'מזל טוב למשפחת בדיוני', 'בדיוני', { sub: 'להולדת הנכדה, בת לשירה ואורי דוגמה', blessing: 'שתזכו לגדלה לתורה, לחופה ולמעשים טובים' }),
  li('c2', 'mazal', 'מזל טוב למשפחת ניסיון', 'ניסיון', { sub: 'לרגל בר המצווה של הבן איתי' }),
];
const build = (over: Partial<{ doc: ScheduleDoc; items: SheetLineItem[]; variant: SheetVariant; pinned: SheetModel['pinned'] }> = {}) => {
  const d = over.doc ?? doc;
  return sheetModel({
    doc: d, week: computeWeek(d, FRIDAY, zf), kehilaName: 'קהילת אור הדוגמה', logoUri: null,
    items: over.items ?? mazal, pinned: over.pinned ?? null, variant: over.variant ?? 'a4',
  });
};
const withRows = (extra: Row[], section = 1): ScheduleDoc => ({ ...doc, sections: doc.sections.map((s, i) => (i === section ? { ...s, rows: [...s.rows, ...extra] } : s)) });
const fixed = (id: string, label: string, at = '21:00'): Row => ({ id, label: { he: label }, time: { kind: 'fixed', at } });

// ---- model -----------------------------------------------------------------------------------------------------------

test('model: parasha title, dates, columns with Shabbat first, candle band with both cities', () => {
  const m = build();
  assert.equal(m.parasha, 'וירא');
  assert.equal(m.hebrewDate, 'כ׳ בחשוון תשפ״ז (31.10.2026)');
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

test('mazal tov: no items prints none; mazal tov then condolences, events apart', () => {
  assert.equal(build({ items: [] }).mazalTov.length, 0);
  assert.doesNotMatch(sheetBodyHtml(build({ items: [] })), /class="mt"/);
  const m = build({ items: [li('e1', 'events', 'ערב לימוד', 'ערב לימוד'), li('k1', 'condolence', 'משפחת ניסיון', 'ניסיון'), li('m1', 'mazal', 'מזל טוב למשפחת דוגמה', 'דוגמה')] });
  assert.deepEqual(m.mazalTov.map(i => i.id), ['m1', 'k1']);
  assert.deepEqual(m.events.map(i => i.id), ['e1']);
  assert.deepEqual(build({ variant: 'square', items: [li('e1', 'events', 'ערב לימוד', 'ערב לימוד'), ...mazal] }).events, []);
});

test('mazal tov: the family name is bold; the sub and blessing stay on the line', () => {
  assert.deepEqual(mazalParts('מזל טוב למשה בדיוני היקר', 'בדיוני'), [{ text: 'מזל טוב למשה ', bold: false }, { text: 'בדיוני', bold: true }, { text: ' היקר', bold: false }]);
  assert.deepEqual(mazalParts('מזל טוב', 'אחר'), [{ text: 'מזל טוב', bold: false }]);
  assert.ok(build().mazalTov[0]!.sub.length > 0);
  assert.ok(build().mazalTov[0]!.blessing.length > 0);
});

test('events head the start cell without a picture; mazal spans both columns without events or picture', () => {
  const ev = li('e1', 'events', 'ערב לימוד', 'ערב לימוד');
  const pic = { imageUri: 'data:image/png;base64,AAAA' };
  assert.deepEqual(placement(build(), BASE_FIT('a4')), { note: false, events: false, mazalSpansBoth: true });
  assert.deepEqual(placement(build({ items: [...mazal, ev] }), BASE_FIT('a4')), { note: false, events: true, mazalSpansBoth: false });
  assert.deepEqual(placement(build({ pinned: pic }), BASE_FIT('a4')), { note: true, events: false, mazalSpansBoth: false });
  assert.deepEqual(placement(build({ items: [...mazal, ev], pinned: pic }), BASE_FIT('a4')), { note: true, events: true, mazalSpansBoth: false });
  assert.equal(placement(build({ items: [...mazal, ev], pinned: pic }), { ...BASE_FIT('a4'), dropImage: true }).note, false);
  assert.equal(build({ items: [...mazal, ev] }).events.length, 1);
});

test('square band lists four families and the rest', () => {
  const five = ['א', 'ב', 'ג', 'ד', 'ה'].map((n, i) => li(`s${i}`, 'mazal', `מזל טוב למשפחת ${n}דוגמה`, `${n}דוגמה`));
  assert.equal(squareBand(five.slice(0, 2)), 'מזל טוב: משפחת אדוגמה · משפחת בדוגמה');
  assert.equal(squareBand(five), 'מזל טוב: משפחת אדוגמה · משפחת בדוגמה · משפחת גדוגמה · משפחת דדוגמה · … ועוד 1');
  assert.equal(squareBand([]), '');
  assert.match(sheetBodyHtml(build({ variant: 'square', items: five })), /class="mtband"/);
});

test('a cancelled event keeps its line and is flagged', () => {
  const cancelled = li('e1', 'events', 'ערב לימוד · ג׳ 20:30', 'ערב לימוד', { cancelled: true });
  const m = build({ items: [...mazal, cancelled] });
  assert.equal(m.events.length, 1);
  assert.equal(m.events[0]!.cancelled, true);
  assert.equal(m.events[0]!.main.map(p => p.text).join(''), 'ערב לימוד · ג׳ 20:30');
  assert.deepEqual(fitSheet(m).out, []);
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
  const long = Array.from({ length: 5 }, (_, i) => li(`c${i}`, 'mazal', `מזל טוב למשפחת בדיוני מספר ${i} להולדת הנכד`, 'בדיוני', { sub: 'שתזכו לגדלו לתורה, לחופה ולמעשים טובים ולהרבה נחת' }));
  const m = build({ items: long, pinned: { imageUri: 'data:image/png;base64,AAAA' } });
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
  assert.equal(f.more, f.out.length);
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
    items: [li('c', 'mazal', `מזל טוב ${evil}`, evil, { sub: evil, blessing: evil }), li('ev', 'events', evil, evil)], pinned: { title: evil, line: evil, imageUri: '"><script>alert(1)</script>' }, variant: 'a4',
  });
  for (const html of [sheetHtml(m), sheetBodyHtml(m)]) {
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&amp;&#39;/);
  }
  const sq = sheetHtml(sheetModel({ ...{ doc: d, week: computeWeek(d, FRIDAY, zf), kehilaName: evil, logoUri: null, items: [li('c', 'mazal', evil, evil)], variant: 'square' as const } }));
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
  const withLogo = sheetModel({ doc, week: computeWeek(doc, FRIDAY, zf), kehilaName: 'קהילה', logoUri: 'data:image/png;base64,AAAA', items: [], variant: 'a4' });
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

// ---- items beyond the max, blessings ---------------------------------------------------------------------------------

test('blessings are dropped before anything else', () => {
  const blessing = 'שתזכו לגדלו לתורה ולחופה';
  const six = Array.from({ length: 6 }, (_, i) => li(`b${i}`, 'mazal', `מזל טוב למשפחת בדיוני ${i}`, 'בדיוני', { blessing, icon: null }));
  // Add rows until the base size no longer fits with the blessings but fits without them.
  let found = false;
  for (let n = 0; n <= 20 && !found; n++) {
    const extra = Array.from({ length: n }, (_, i) => fixed(`e${i}`, `שורה נוספת מספר ${i + 1}`, `${(10 + i) % 24}:15`));
    const m = build({ doc: withRows(extra), items: six });
    const withB = neededHeight(m, BASE_FIT('a4'));
    const without = neededHeight(m, { ...BASE_FIT('a4'), dropBlessings: true });
    if (withB > 842 && without <= 842) {
      found = true;
      const f = fitSheet(m);
      assert.equal(f.dropBlessings, true);
      assert.equal(f.rowFont, 14.5);
      assert.equal(f.mazalFont, 13);
      assert.equal(f.imageScale, 1);
      assert.equal(f.droppedMazal, 0);
      assert.deepEqual(f.out, []);
      assert.equal(f.more, 0);
    }
  }
  assert.ok(found, 'a size exists where only the blessings need to go');
  assert.equal(fitSheet(build({ items: six.slice(0, 1) })).dropBlessings, false);
});

test('over the max is out and counted', () => {
  const eight = Array.from({ length: 8 }, (_, i) => li(`m${i}`, 'mazal', `מזל טוב למשפחת בדיוני ${i}`, 'בדיוני'));
  const four = Array.from({ length: 4 }, (_, i) => li(`v${i}`, 'events', `אירוע מספר ${i}`, `אירוע מספר ${i}`));
  assert.equal(MAX_MAZAL, 6);
  assert.equal(MAX_EVENTS, 3);
  const f = fitSheet(build({ items: [...eight, ...four] }));
  assert.deepEqual(f.out, ['m6', 'm7', 'v3']);
  assert.equal(f.more, 3);
  assert.equal(f.droppedMazal, 0);
  assert.equal(f.droppedEvents, 0);
  assert.deepEqual(f.dropped, []);
  assert.equal(fitSheet(build({ items: [...eight.slice(0, 6), ...four.slice(0, 3)] })).more, 0);
});

test('mazal tov is dropped before events, and both are listed', () => {
  const six = Array.from({ length: 6 }, (_, i) => li(`m${i}`, 'mazal', `מזל טוב למשפחת בדיוני ${i}`, 'בדיוני'));
  const three = Array.from({ length: 3 }, (_, i) => li(`v${i}`, 'events', `אירוע מספר ${i} עם שם ארוך מאוד שממלא שורה שלמה בגיליון`, `אירוע מספר ${i}`));
  const rows = Array.from({ length: 40 }, (_, i) => fixed(`x${i}`, 'שיעור מיוחד בנושא ארוך מאוד של הלכות שבת ומועד לכל הקהל', `${String(6 + (i % 17)).padStart(2, '0')}:00`));
  const f = fitSheet(build({ doc: withRows(rows), items: [...six, ...three] }));
  assert.equal(f.droppedMazal, 6);
  assert.equal(f.droppedEvents > 0 || f.scale < 1, true);
  assert.deepEqual(f.out.slice(0, 6), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
  assert.equal(f.more, f.out.length);
});

// ---- renderers: the bottom cells from the item list (Task 12) ----------------------------------------------------------

const PIC = 'data:image/png;base64,AAAA';
const fixtureModel = (kind: 'items' | 'many', variant: SheetVariant = 'a4') => {
  const items = printItemsFixture(FRIDAY, kind).filter(i => i.state === 'in');
  return buildSheet(doc, computeWeek(doc, FRIDAY, zf), { kehilaName: 'קהילת אור הדוגמה', logoUri: PIC, items, pinned: kind === 'items' ? { title: 'ערב לימוד לנשים', imageUri: PIC } : null }, variant);
};
const countOf = (html: string, needle: string) => html.split(needle).length - 1;

test('html: print-items puts events in the start cell before mazal tov, bold surnames, one "בוטל", the logo on a white tile', () => {
  const m = fixtureModel('items');
  for (const html of [sheetBodyHtml(m), sheetHtml(m)]) {
    const mazalAt = html.indexOf('class="mt mz"');
    const eventAt = html.indexOf('class="mt ev"');
    assert.ok(eventAt > 0 && mazalAt > eventAt, 'events before mazal tov in document order');
    for (const item of m.mazalTov) {
      const surname = item.main.find(p => p.bold)!.text;
      assert.ok(html.includes(`<b>${surname}</b>`), surname);
    }
    assert.equal(countOf(html, 'בוטל'), 1);
    assert.match(html, /<div class="logo"[^>]*style="[^"]*background:#fff[^"]*padding:2px[^"]*"[^>]*><img src="data:image\/png;base64,AAAA"/);
    assert.match(html, /class="ic"/);
    assert.doesNotMatch(html, /ועוד \d+ ברכות/);
  }
});

test('html: print-items-many says "ועוד 3 ברכות באפליקציה" and holds 6 mazal tov and 3 events', () => {
  const html = sheetBodyHtml(fixtureModel('many'));
  assert.equal(countOf(html, 'ועוד 3 ברכות באפליקציה'), 1);
  assert.equal(countOf(html, 'class="mt mz"'), 6);
  assert.equal(countOf(html, 'class="mt ev"'), 3);
});

test('html: a condolence has no icon; with no events and no picture mazal tov spans both columns; the square shows the band', () => {
  const m = fixtureModel('items');
  assert.equal(countOf(sheetBodyHtml(m), 'class="ic"'), m.mazalTov.filter(i => i.icon).length);
  const bare = sheetModel({ doc, week: computeWeek(doc, FRIDAY, zf), kehilaName: 'ק', logoUri: null, items: mazal, variant: 'a4' });
  assert.match(sheetBodyHtml(bare), /class="span"/);
  const sq = sheetBodyHtml(fixtureModel('items', 'square'));
  assert.match(sq, /class="mtband"/);
  assert.match(sq, /<b>[^<]+<\/b>/);
  assert.doesNotMatch(sq, /class="mt ev"/);
});

test('print gate: only a loaded item list prints (loading and failed both wait for a retry); the failure text exists in both languages', async () => {
  const { canPrintSheet, ITEMS_LOAD_ERROR } = await import('../src/schedule/sheetSource.ts');
  assert.equal(canPrintSheet('ready'), true);
  assert.equal(canPrintSheet('loading'), false);
  assert.equal(canPrintSheet('error'), false);
  assert.ok(ITEMS_LOAD_ERROR.he && ITEMS_LOAD_ERROR.en);
});

test('html: the weekday band keeps the Gregorian range in one isolated left-to-right piece', async () => {
  const { rangeParts } = await import('../src/schedule/sheetModel.ts');
  const m = build();
  const band = m.weekday!.band!;
  assert.equal(band.kind, 'dates');
  const parts = rangeParts(band.kind === 'dates' ? band.range : '');
  assert.match(parts.greg, /^\(⁦1\.11–5\.11⁩\)$/);
  assert.match(sheetBodyHtml(m), /<bdi dir="ltr" style="white-space:nowrap">\(⁦1\.11–5\.11⁩\)<\/bdi>/);
});
