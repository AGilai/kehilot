/**
 * Fixture builds only (screenshots and `?screen=seat-upload*`): an invented Form export and a small hall with a tiny stand-in for the
 * server's responses apply/undo, so the upload screens can be walked through without a backend. Every name here is made up.
 */
import { ApiCodeError } from '../client/errors.ts';
import { fixtureSeatFamilies } from './fixturePaste.ts';
import type { ApplyResult, ResponseCall } from './upload.ts';
import type { WeekWire, WirePrayer } from './wire.ts';

export const FIXTURE_HOLDER_ID = '01FIXTUREHOLDER00000000001';
const fam = (i: number) => `family:${fixtureSeatFamilies()[i - 1]!.familyId}`;
// [ref, name, seats]
const HOUSEHOLDS: [string, string, number][] = [
  [fam(1), 'בדיוני', 3], [fam(2), 'דוגמה', 2], [fam(3), 'ניסיון', 4], [fam(4), 'אלמוני', 1], [fam(5), 'דמיון', 3], [fam(6), 'הנחל', 2],
  [`holder:${FIXTURE_HOLDER_ID}`, 'משפחת מדומה', 2],
];

const pad = (n: number) => String(n).padStart(2, '0');
/** "M/D/YYYY H:MM:SS" like the Form, `daysFromFriday` days from the week's Friday. */
function stamp(friday: string, daysFromFriday: number, h: number, m: number): string {
  const [y, mo, d] = friday.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, mo - 1, d + daysFromFriday));
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}/${t.getUTCFullYear()} ${h}:${pad(m)}:00`;
}

/** The Form's responses tab: this week's answers (one household twice), an older week's, a request-only row and one that asks for too many. */
export function fixtureResponsesCsv(friday: string): string {
  const head = ['Timestamp', 'שם', 'ערב שבת: כמה מקומות לא אצטרך', 'יום שבת: כמה מקומות לא אצטרך', 'חג: כמה מהמקומות יתפנו', 'קריאת מגילה: כמה יתפנו', 'בקשה לשמירת מקומות נשים · בית הכנסת', 'בקשה לשמירת מקומות גברים · אולם', 'בקשה לשמירת מקומות נשים · אולם'];
  const rows: string[][] = [
    [stamp(friday, -2, 20, 41), 'בדיוני דנה', '0', '0', '', '', '', '', ''],
    [stamp(friday, -1, 8, 2), 'בדיוני דנה', '1', '1', '', '', '', '', ''],
    [stamp(friday, -1, 9, 30), 'דוגמה מיכל', '2', '0', '', '', '', '', ''],
    [stamp(friday, -2, 21, 5), 'ניסיון אבי', '1', '2', '', '', '2', '', ''],
    [stamp(friday, -1, 7, 15), 'אלמוני אברהם', '5', '0', '', '', '', '', ''],
    [stamp(friday, -1, 10, 0), 'דמיון רון', '1', '0', '', '', '', '', ''],
    [stamp(friday, -2, 12, 0), 'הנחל משה', '0', '0', '', '', '', '', ''],
    [stamp(friday, -1, 8, 12), 'מדומה', '1', '1', '', '', '', '', ''],
    [stamp(friday, -1, 9, 41), 'ש. משל', '', '', '', '', '2', '', '1'],
    [stamp(friday, -9, 18, 5), 'דוגמה מיכל', '2', '2', '', '', '', '', ''],
  ];
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

type Rec = { released: boolean; by: 'member' | 'gabbai'; at: number };
type Undo = { at: number; seats: Record<string, Rec | null> };

export function createUploadFixture(friday: string) {
  const ids: string[] = [];
  const assignments: Record<string, string> = {};
  const households: Record<string, string> = {};
  const order = new Map<string, string[]>();
  let col = 0;
  for (const [ref, name, n] of HOUSEHOLDS) {
    households[ref] = name;
    order.set(ref, []);
    for (let i = 0; i < n; i++) { const id = `u${String(col).padStart(3, '0')}`; ids.push(id); assignments[id] = ref; order.get(ref)!.push(id); col++; }
  }
  const state: Record<WirePrayer, Record<string, Rec>> = { erev: {}, day: {} };
  const undo: Record<WirePrayer, Undo | null> = { erev: null, day: null };
  // Two households answered in the app for Shabbat evening: one of them freed two seats
  const dem = order.get(fam(5))!;
  state.erev[dem[0]!] = { released: true, by: 'member', at: 1_790_000_000_000 };
  state.erev[dem[1]!] = { released: true, by: 'member', at: 1_790_000_000_000 };
  state.erev[dem[2]!] = { released: false, by: 'member', at: 1_790_000_000_000 };
  const bd = order.get(fam(1))!;
  state.erev[bd[0]!] = { released: false, by: 'member', at: 1_790_000_000_000 };

  const adminWeek = (): WeekWire => ({
    week: friday, deadline: new Date(Date.now() + 86_400_000).toISOString(), open: true,
    layout: { effectiveFrom: '2026-01-02', rows: 1, cols: ids.length, cells: [ids.map(() => 'seat' as const)], blocks: [{ name: 'מרכז', colStart: 0, colEnd: ids.length - 1 }], rowLabels: [null], seats: ids.map((id, i) => ({ id, row: 0, col: i })) },
    assignments, households,
    prayers: Object.fromEntries((['erev', 'day'] as const).map((p) => [p, { seats: structuredClone(state[p]), requests: {}, canUndo: !!undo[p], updatedAt: 1_790_000_000_000 }])) as WeekWire['prayers'],
  });

  function apply(call: ResponseCall): ApplyResult {
    const warnings: ApplyResult['warnings'] = [];
    const seats = state[call.event];
    const before: Record<string, Rec | null> = {};
    const now = Date.now();
    let released = 0, applied = 0;
    const totals: Record<string, number> = {};
    for (const row of call.rows) {
      const own = order.get(row.household) ?? [];
      if (!own.length) { warnings.push({ household: row.household, code: 'no_seats' }); continue; }
      const app = own.some((id) => seats[id]?.by === 'member');
      for (const [a, n] of Object.entries(row.requests ?? {})) totals[a] = (totals[a] ?? 0) + n;
      if (app && !row.override) { warnings.push({ household: row.household, code: 'app_answer_kept' }); continue; }
      if (row.released > own.length) warnings.push({ household: row.household, code: 'above_seats' });
      const free = new Set(own.slice(Math.max(0, own.length - row.released)));
      applied++;
      for (const id of own) {
        const want = free.has(id);
        if (!!seats[id]?.released !== want) { before[id] = seats[id] ?? null; seats[id] = { released: want, by: 'gabbai', at: now }; if (want) released++; }
      }
    }
    undo[call.event] = { at: now, seats: before };
    return { event: call.event, households: applied, released, kept: 0, duplicates: 0, warnings, requestTotals: totals };
  }
  function undoApply(event: WirePrayer): { event: string; restored: boolean; skipped: number } {
    const u = undo[event];
    if (!u) throw new ApiCodeError(404, 'nothing_to_undo');
    for (const [id, prev] of Object.entries(u.seats)) { if (prev) state[event][id] = prev; else delete state[event][id]; }
    undo[event] = null;
    return { event, restored: true, skipped: 0 };
  }
  return { adminWeek, apply, undoApply };
}

// ---- holders without an account (`?screen=seat-holders`, `seat-link`, `seat-approval`) ----

export const FX_FAMILY_MEDUMEH = '01FIXTUREFAMILY0000000198';
export const FX_FAMILY_MASHAL = '01FIXTUREFAMILY0000000199';
/** The generic seating families plus two that just registered (a suggestion each). */
export function fixtureHolderFamilies() {
  return [
    ...fixtureSeatFamilies(),
    { familyId: FX_FAMILY_MEDUMEH, name: 'מדומה', adults: [{ userId: '01FIXTUREUSER000000000198', displayName: 'אורי מדומה' }, { userId: '01FIXTUREUSER000000000298', displayName: 'דנה מדומה' }], children: [] },
    { familyId: FX_FAMILY_MASHAL, name: 'משל', adults: [{ userId: '01FIXTUREUSER000000000199', displayName: 'שלמה משל' }, { userId: '01FIXTUREUSER000000000299', displayName: 'רחל משל' }], children: [] },
  ];
}
const H = (n: number) => `01FIXTUREHOLDER0000000000${n}`;
export function fixtureHolders() {
  const at = 1_780_000_000_000;
  return [
    { holderId: FIXTURE_HOLDER_ID, name: 'משפחת מדומה', phone: '+972500000014', createdAt: at, updatedAt: at },
    { holderId: H(2), name: 'משל ש.', phone: null, createdAt: at + 86_400_000 * 24, updatedAt: at + 86_400_000 * 24 },
    { holderId: H(3), name: 'סקיצה מ.', phone: '+972520000031', createdAt: at, updatedAt: at },
    { holderId: H(4), name: 'שרטוט י.', phone: null, createdAt: at + 86_400_000 * 17, updatedAt: at + 86_400_000 * 17 },
    { holderId: H(5), name: 'היפותטי ר.', phone: null, createdAt: at + 86_400_000 * 18, updatedAt: at + 86_400_000 * 18 },
  ];
}
export function fixtureLinkSuggestions() {
  return {
    count: 2,
    suggestions: [
      { holderId: FIXTURE_HOLDER_ID, holderName: 'משפחת מדומה', familyId: FX_FAMILY_MEDUMEH, familyName: 'אורי ודנה מדומה', why: 'phone-surname', level: 'exact' as const, familyHoldsSeats: false },
      { holderId: H(2), holderName: 'משל ש.', familyId: FX_FAMILY_MASHAL, familyName: 'שלמה ורחל משל', why: 'surname-initial', level: 'exact' as const, familyHoldsSeats: true },
    ],
  };
}
/** One layout version for the holders list's seat counts: seats h00..h13 in a row and who holds them. */
export function fixtureHolderLayout() {
  const seats = Array.from({ length: 14 }, (_, i) => ({ id: `h${String(i).padStart(2, '0')}`, row: 0, col: i }));
  const refs = [`holder:${FIXTURE_HOLDER_ID}`, `holder:${FIXTURE_HOLDER_ID}`, `holder:${H(2)}`, `holder:${H(2)}`, `holder:${H(3)}`, `holder:${H(3)}`, `holder:${H(3)}`, `holder:${H(4)}`, `holder:${H(4)}`, `family:${FX_FAMILY_MASHAL}`, `family:${FX_FAMILY_MASHAL}`, fam(1), fam(1), fam(1)];
  return { seats, asg: Object.fromEntries(seats.map((s, i) => [s.id, refs[i]!])), body: { rows: 1, cols: 14, cells: [seats.map(() => 'seat')], blocks: [{ name: 'מרכז', colStart: 0, colEnd: 13 }], rowLabels: [null] } };
}
