/** Fixture builds only (screenshots): an invented hall as a Sheets TSV paste. Every name here is made up. */
import type { AdminFamily } from '../client/types.ts';
import { HALL_GRID, parseHall } from './hall.ts';
import type { LayoutBody } from './savePlan.ts';

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

// ---- the map editor's fixture (`?screen=seat-map`): the real hall's SHAPE with 64 invented households ----

const MAP_SURNAMES = ['בדיוני', 'דוגמה', 'ניסיון', 'מדומה', 'אלמוני', 'פיקטיבי', 'דמיוני', 'הדגמה', 'ניסוי', 'אופק', 'נועם', 'שחר', 'מופת', 'כוכב', 'סלע', 'ירוק'];
const MAP_FIRSTS = ['דנה', 'יוסי', 'מיכל', 'אבי', 'רותי', 'רון', 'נועה', 'משה', 'שרה', 'עדי', 'גל', 'מור', 'דורון', 'בן', 'יעל', 'תמר', 'שי', 'לי', 'חן', 'נדב', 'ענת', 'אילן', 'דליה', 'עמית'];
/** 64 invented households: 16 surnames, four first names each (so a surname repeats and the cells show an initial). */
export function fixtureMapFamilies(): AdminFamily[] {
  return MAP_SURNAMES.flatMap((last, i) => [0, 1, 2, 3].map((j) => {
    const n = i * 4 + j;
    const first = MAP_FIRSTS[(i * 3 + j * 5) % MAP_FIRSTS.length]!;
    const spouse = n % 2 === 0 ? MAP_FIRSTS[(i * 3 + j * 5 + 7) % MAP_FIRSTS.length]! : undefined;
    return {
      familyId: `01FIXTUREMAPFAM0000000${String(n).padStart(3, '0')}`, name: last,
      adults: [{ userId: `01FIXTUREMAPUSR0000000${String(n).padStart(3, '0')}`, displayName: `${first} ${last}` }, ...(spouse ? [{ userId: `01FIXTUREMAPSPO0000000${String(n).padStart(3, '0')}`, displayName: `${spouse} ${last}` }] : [])],
      children: [],
    };
  }));
}

/** The hall's shape as a saved layout (an ark row on top, labels ק,1-13) and who sits where, by "row:col". */
export function fixtureMap(): { layout: LayoutBody; assign: Record<string, string> } {
  const lines = HALL_GRID.trim().split('\n').map((l) => l.trim());
  const hall = parseHall(HALL_GRID);
  const cols = hall.cols;
  const usedCol = Array.from({ length: cols }, (_, c) => lines.some((l) => l[c] === 'S' || l[c] === 'B'));
  const cells: LayoutBody['cells'] = [Array.from({ length: cols }, (_, c) => (c >= 12 && c <= 16 ? 'ark' : 'empty'))];
  for (const l of lines) cells.push([...l].map((ch, c) => (ch === 'S' ? 'seat' : ch === 'B' ? 'bimah' : usedCol[c] ? 'empty' : 'aisle')));
  const blocks = hall.blocks.map((b) => ({ name: b.name, colStart: b.x, colEnd: b.x + b.cols - 1 })).sort((a, c) => a.colStart - c.colStart);
  const layout: LayoutBody = { rows: cells.length, cols, cells, blocks, rowLabels: [null, 'ק', ...Array.from({ length: lines.length - 1 }, (_, i) => String(i + 1))] };
  // fill block by block (right to left), rows front to back, so a household sits together
  const spots: string[] = [];
  for (const b of [...blocks].reverse()) for (let r = 0; r < cells.length; r++) for (let c = b.colStart; c <= b.colEnd; c++) if (cells[r]![c] === 'seat') spots.push(`${r}:${c}`);
  const fams = fixtureMapFamilies();
  const sizes = [3, 2, 4, 2, 3, 1, 4, 3, 2, 4];
  const assign: Record<string, string> = {};
  let at = 0;
  fams.forEach((f, i) => { for (let j = 0; j < sizes[i % sizes.length]! && at < spots.length; j++) assign[spots[at++]!] = `family:${f.familyId}`; });
  for (let j = 0; j < 3 && at < spots.length; j++) assign[spots[at++]!] = 'holder:01FIXTUREHOLDER00000000001';
  return { layout, assign };
}
