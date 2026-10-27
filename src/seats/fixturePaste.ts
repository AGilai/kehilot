/** Fixture builds only (screenshots): an invented hall as a Sheets TSV paste. Every name here is made up. */
import type { AdminFamily } from '../client/types.ts';

const SHAPE = [
  '.SS.SSS.SS.',
  'SSS.SSS.SSS',
  'SSS.SSS.SSS',
  'SSS.SSS.SSS',
  'SSS.SSS.SSS',
  'SSS.SSS.SSS',
  'SSS.SBS.SSS',
  'SSS.SSS.SS.',
];
// [name, seats, explicit orders]
const FAMILIES: [string, number, number[]?][] = [
  ['בדיוני ד.', 3], ['בדיוני י.', 2], ['דוגמא מ.', 2], ['ניסיון א.', 4, [1, 2, 2, 4]], ['אלמוני', 1], ['דמיון ר.', 3],
  ['הנחל מ.', 2], ['מופת ע.', 2], ['אופק ג.', 3], ['מדומה', 2], ['פיקטיבי ל.', 1], ['כוכב ב.', 4], ['שחר ת.', 2], ['גלעד ש.', 3],
  ['נועם ח.', 2], ['ירוק נ.', 1], ['סלע א.', 2], ['לבנה ד.', 3], ['אורן ק.', 2], ['דקל ז.', 1],
];

export function fixturePasteTsv(): string {
  const seq: string[] = [];
  for (const [name, n, orders] of FAMILIES) for (let i = 0; i < n; i++) seq.push(`${name}-${(orders ?? [])[i] ?? i + 1}`);
  seq.splice(20, 1, 'תכלת-1 / ארגמן-1'); // a cell with two names
  // seats are filled block by block, so a household mostly stays in one block
  const spots: [number, number, number][] = [];
  SHAPE.forEach((line, r) => [...line].forEach((ch, c) => { if (ch === 'S') spots.push([c < 4 ? 0 : c < 8 ? 1 : 2, r, c]); }));
  spots.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const at = new Map(spots.map(([, r, c], i) => [`${r},${c}`, seq[i] ?? 'פנוי']));
  const rows: string[][] = [['', 'מפת מקומות · בית הכנסת (דוגמה)'], ['', 'עודכן 27/10']];
  SHAPE.forEach((line, r) => {
    const label = r === 0 ? '' : String(r);
    rows.push([label, ...[...line].map((ch, c) => (ch === 'S' ? at.get(`${r},${c}`)! : ch === 'B' ? 'בימה' : ''))]);
  });
  const next = spots.length;
  rows.push(['', `סה"כ: ${next}`]);
  return rows.map((r) => r.join('\t')).join('\n');
}

/** The Kehila's households for the seating fixtures (the generic fixture list has only four). */
export function fixtureSeatFamilies(): AdminFamily[] {
  const one = (i: number, last: string, first: string, spouse?: string): AdminFamily => ({
    familyId: `01FIXTUREFAMILY00000001${String(i).padStart(2, '0')}`, name: last,
    adults: [{ userId: `01FIXTUREUSER000000001${String(i).padStart(2, '0')}`, displayName: `${first} ${last}` }, ...(spouse ? [{ userId: `01FIXTUREUSER000000002${String(i).padStart(2, '0')}`, displayName: `${spouse} ${last}` }] : [])],
    children: [],
  });
  return [
    one(1, 'בדיוני', 'דנה', 'יוסי'), one(2, 'דוגמה', 'מיכל'), one(3, 'ניסיון', 'אבי', 'רותי'), one(4, 'אלמוני', 'אברהם'),
    one(5, 'דמיון', 'רון', 'נועה'), one(6, 'הנחל', 'משה', 'שרה'), one(7, 'מופת', 'עדי'), one(8, 'אופק', 'גל', 'מור'),
    one(9, 'אופק', 'דורון'), one(10, 'כוכב', 'בן', 'יעל'), one(11, 'שחר', 'תמר'), one(12, 'גלעד', 'שי', 'לי'),
    one(13, 'נועם', 'חן'), one(14, 'ירוק', 'נדב', 'ענת'), one(15, 'סלע', 'אילן'), one(16, 'לבנה', 'דליה', 'עמית'),
  ];
}
