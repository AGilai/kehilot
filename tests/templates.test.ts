import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  TEMPLATES, buildMessage, buildSheetLine, dayLabel, defaultBlessing, fill, missingFields, shortDate, templateOf, withMemorial,
} from '../src/client/templates.ts';
import type { TemplateFields } from '../src/client/types.ts';

const he = JSON.parse(readFileSync(new URL('../src/i18n/he.json', import.meta.url), 'utf8'));
const ISOLATES = /[⁦-⁩]/;

const grandMazal: TemplateFields = {
  occasion: 'birthDaughter', whose: 'grandparents', surname: 'דוגמה', firstNames: 'אברהם ורחל', name: 'נועה', parents: 'דוד ושרה',
  blessing: 'שיזכו לגדלה לתורה',
};
const condolence = (over: TemplateFields): TemplateFields => ({ variant: 'only', surname: 'ניסיון', deceased: 'יוסף', relation: 'אביו של משה', ...over });
const full = { variant: 'full', address: 'רחוב הדוגמה 5', hours: '10:00–13:00', until: '2026-11-09' };

test('event builds title, body and sheet line', () => {
  const f = { name: 'ערב לימוד לנשים', date: '2026-11-03', time: '20:30', place: 'בית הכנסת', for: 'women' };
  const m = buildMessage('event', f, 'he');
  assert.equal(m.title, 'ערב לימוד לנשים');
  assert.match(m.body, /^יום ג׳, .+ \(3\.11\), בשעה 20:30 · בית הכנסת · נשים\.$/);
  assert.ok(!/^יום ג׳, 3\.11/.test(m.body), 'Hebrew date comes first');
  const line = buildSheetLine({ type: 'event', title: m.title, templateId: 'event', fields: f });
  assert.deepEqual(line.main, [{ text: 'ערב לימוד לנשים', bold: true }, { text: ' · ג׳ 20:30 · בית הכנסת', bold: false }]);
  assert.equal(line.cancelled, false);
  assert.equal(line.icon, null);
  const more = buildMessage('event', { ...f, organisers: 'הגבאים', more: 'כיבוד קל' }, 'he').body.split('\n');
  assert.deepEqual(more.slice(1), ['מארגנים: הגבאים', 'כיבוד קל']);
  assert.equal(buildSheetLine({ type: 'event', title: 'x', templateId: 'event', fields: { ...f, cancelled: true } }).cancelled, true);
});

test('event body in English', () => {
  const f = { name: 'Study night', date: '2026-11-03', time: '20:30', place: 'Main hall', for: 'all' };
  assert.match(buildMessage('event', f, 'en').body, /^Tuesday, .+ \(3\.11\), at 20:30 · Main hall · Everyone\.$/);
});

test('mazal tov for grandparents with parents', () => {
  const m = buildMessage('mazal', grandMazal, 'he');
  assert.equal(m.title, 'מזל טוב למשפחת דוגמה');
  assert.equal(m.body, 'להולדת הנכדה נועה, בת לדוד ושרה. שיזכו לגדלה לתורה');
  const line = buildSheetLine({ type: 'celebration', title: m.title, templateId: 'mazal', fields: grandMazal });
  assert.equal(line.sub, 'להולדת הנכדה נועה, בת לדוד ושרה');
  assert.equal(line.blessing, 'שיזכו לגדלה לתורה');
  assert.equal(line.icon, 'heart');
  assert.deepEqual(line.main, [{ text: 'מזל טוב לאברהם ורחל ', bold: false }, { text: 'דוגמה', bold: true }]);
});

test('mazal tov variants: no names, bar mitzvah star, other occasion, parents', () => {
  const bar: TemplateFields = { occasion: 'barMitzvah', whose: 'parents', surname: 'בדיוני' };
  const line = buildSheetLine({ type: 'celebration', title: '', templateId: 'mazal', fields: bar });
  assert.deepEqual(line.main, [{ text: 'מזל טוב למשפחת ', bold: false }, { text: 'בדיוני', bold: true }]);
  assert.equal(line.icon, 'star');
  assert.equal(line.sub, 'לבר המצווה');
  assert.equal(buildMessage('mazal', { ...bar, name: 'אורי' }, 'he').body, 'לבר המצווה של אורי.');
  const other: TemplateFields = { occasion: 'other', occasionOther: 'סיום מסכת', whose: 'other', whoseOther: 'הדודים', surname: 'דוגמה', name: 'מיכל' };
  assert.equal(buildMessage('mazal', other, 'he').body, 'לסיום מסכת של מיכל.');
  assert.equal(buildMessage('mazal', { ...grandMazal, occasion: 'wedding', name: 'דנה' }, 'he').body.startsWith('לנישואי דנה.'), true);
});

test('condolence variants change only the shiva sentence', () => {
  const only = buildMessage('condolence', condolence({}), 'he');
  const later = buildMessage('condolence', condolence({ variant: 'later' }), 'he');
  const fl = buildMessage('condolence', condolence(full), 'he');
  const closing = he.tpl.condolence.closing;
  assert.equal(only.title, 'משפחת ניסיון');
  assert.ok(only.body.startsWith('אנו משתתפים בצער משפחת ניסיון במות יוסף ז״ל, אביו של משה.'));
  assert.ok(!only.body.includes('שבעה') && !only.body.includes('השבעה'));
  assert.ok(later.body.includes(he.tpl.condolence.laterLine));
  assert.ok(fl.body.includes('השבעה ברחוב הדוגמה 5, עד יום ב׳'));
  assert.ok(fl.body.includes('(9.11). ניחום אבלים בשעות 10:00–13:00.'));
  assert.ok(!fl.body.includes('תפילות'));
  assert.ok(buildMessage('condolence', condolence({ ...full, prayers: 'שחרית 7:00' }), 'he').body.includes('תפילות: שחרית 7:00.'));
  for (const m of [only, later, fl]) assert.ok(m.body.endsWith(closing));
  assert.equal(only.body.replace(closing, '').trim(), only.body.split(closing)[0]!.trim());
});

test('condolence sheet lines', () => {
  const at = (f: TemplateFields) => buildSheetLine({ type: 'condolence', title: '', templateId: 'condolence', fields: f });
  const only = at(condolence({}));
  assert.deepEqual(only.main, [{ text: 'משפחת ', bold: false }, { text: 'ניסיון', bold: true }, { text: ' · במות יוסף ז״ל', bold: false }]);
  assert.equal(only.sub, '');
  assert.equal(only.icon, null);
  assert.equal(at(condolence({ variant: 'later' })).sub, 'פרטי השבעה בהמשך');
  assert.equal(at(condolence(full)).sub, 'השבעה ברחוב הדוגמה 5 עד ב׳');
});

test('deceased gets ז״ל once', () => {
  assert.equal(withMemorial('יוסף ניסיון', 'he'), 'יוסף ניסיון ז״ל');
  assert.equal(withMemorial('יוסף ניסיון ז״ל', 'he'), 'יוסף ניסיון ז״ל');
  assert.equal(withMemorial('יוסף ניסיון ז"ל', 'he'), 'יוסף ניסיון ז"ל');
  assert.equal(withMemorial('יוסף ניסיון ע״ה', 'he'), 'יוסף ניסיון ע״ה');
  assert.equal(withMemorial('מרים ניסיון ע"ה', 'he'), 'מרים ניסיון ע"ה');
  assert.equal(withMemorial('Joseph Example', 'en'), 'Joseph Example');
});

test('missing fields follow variant and occasion', () => {
  assert.deepEqual(missingFields('condolence', { variant: 'full', surname: 'ניסיון', deceased: 'יוסף', relation: 'אביו' }), ['address', 'hours', 'until']);
  assert.deepEqual(missingFields('mazal', { occasion: 'other', whose: 'parents', surname: 'דוגמה' }), ['occasionOther']);
  assert.deepEqual(missingFields('mazal', { occasion: 'wedding', whose: 'other', surname: 'דוגמה' }), ['whoseOther']);
  assert.deepEqual(missingFields('event', { name: '  ', date: '2026-11-03' }), ['name', 'time', 'place', 'for']);
  assert.deepEqual(missingFields('condolence', condolence({})), []);
});

test('built text has no bidi isolates', () => {
  const outs = [
    buildMessage('event', { name: 'ערב', date: '2026-11-03', time: '20:30', place: 'האולם', for: 'men', organisers: 'צוות', more: 'עוד' }, 'he'),
    buildMessage('mazal', grandMazal, 'he'), buildMessage('mazal', grandMazal, 'en'),
    buildMessage('condolence', condolence({ ...full, prayers: 'מנחה' }), 'he'), buildMessage('condolence', condolence({ ...full, prayers: 'x' }), 'en'),
  ];
  for (const m of outs) assert.ok(!ISOLATES.test(m.title + m.body), m.body);
  assert.equal(fill('{a} ו{b}', { a: 'x', b: 'y' }), 'x וy');
  assert.equal(fill('{a} {zz}', { a: 'x' }), 'x {zz}');
});

test('schema keys match the server contract', () => {
  const server: Record<string, string[]> = {
    event: ['name', 'date', 'time', 'place', 'for', 'organisers', 'more', 'cancelled'],
    mazal: ['occasion', 'occasionOther', 'whose', 'whoseOther', 'surname', 'firstNames', 'name', 'parents', 'blessing'],
    condolence: ['variant', 'surname', 'deceased', 'relation', 'address', 'hours', 'until', 'prayers'],
  };
  const extra: Record<string, string[]> = { event: ['cancelled'], mazal: ['firstNames'], condolence: [] };
  for (const id of ['event', 'mazal', 'condolence'] as const) {
    const keys = [...TEMPLATES[id].map(s => s.key), ...extra[id]!];
    assert.deepEqual([...keys].sort(), [...server[id]!].sort(), id);
  }
  assert.deepEqual(TEMPLATES.event.map(s => s.key), ['name', 'date', 'time', 'place', 'for', 'organisers', 'more']);
  assert.deepEqual(TEMPLATES.condolence.map(s => s.key), ['variant', 'surname', 'deceased', 'relation', 'address', 'hours', 'until', 'prayers']);
  assert.equal(TEMPLATES.mazal.find(s => s.key === 'surname')!.kind, 'family');
  for (const spec of Object.values(TEMPLATES).flat()) assert.equal(typeof (he.tpl as any) === 'object' && spec.labelKey.startsWith('tpl.') || spec.labelKey === 'tpl.family', true);
});

test('every template label and built-text key exists in he', () => {
  const get = (k: string) => k.split('.').reduce((o: any, p) => o?.[p], he);
  for (const spec of Object.values(TEMPLATES).flat()) assert.equal(typeof get(spec.labelKey), 'string', spec.labelKey);
});

test('free text line bolds the family name', () => {
  const line = buildSheetLine({ type: 'celebration', title: 'מזל טוב למשפחת דוגמה', targetName: 'דוגמה' });
  assert.deepEqual(line.main, [{ text: 'מזל טוב למשפחת ', bold: false }, { text: 'דוגמה', bold: true }]);
  assert.equal(line.sub, '');
  assert.equal(line.icon, null);
});

test('templateOf, day labels, short date, default blessing', () => {
  assert.equal(templateOf('event'), 'event');
  assert.equal(templateOf('celebration'), 'mazal');
  assert.equal(templateOf('condolence'), 'condolence');
  assert.equal(templateOf('general'), null);
  assert.equal(templateOf('weekly'), null);
  assert.equal(dayLabel('2026-11-03', 'he', 'long'), 'יום ג׳');
  assert.equal(dayLabel('2026-11-03', 'he', 'short'), 'ג׳');
  assert.equal(dayLabel('2026-11-03', 'en', 'long'), 'Tuesday');
  assert.equal(dayLabel('2026-11-03', 'en', 'short'), 'Tue');
  assert.equal(shortDate('2026-11-03'), '3.11');
  assert.equal(defaultBlessing('other', 'he'), '');
  assert.equal(defaultBlessing('wedding', 'he'), defaultBlessing('engagement', 'he'));
  assert.equal(defaultBlessing('barMitzvah', 'he'), 'שיזכה לגדול בתורה ובמצוות');
  assert.notEqual(defaultBlessing('birthSon', 'en'), '');
});
