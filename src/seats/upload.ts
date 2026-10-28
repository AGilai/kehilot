/**
 * The responses upload (UX-DESIGN §16.6, frame P27; pure): matching a Form name to a household, and the plan the preview shows and the
 * apply sends. The server decides the last word (`POST …/admin/seats/week/{week}/responses`); this only predicts it so the gabbai
 * sees, before applying, who changes, whose app answer stays, and what is refused. Nothing here touches the network or React.
 */
import { isDecisionValid } from './decisions.ts';
import type { Decision } from './decisions.ts';
import type { FormAnswer } from './formCsv.ts';
import { AREAS } from './formCsv.ts';
import { normalizeName, suggestMatches } from './match.ts';
import type { Holder, KehilaFamily, MatchCandidate, MatchResult } from './match.ts';
import { householdsOf } from './wire.ts';
import type { WeekWire, WirePrayer } from './wire.ts';

/** The events the Form covers. Only Shabbat (erev + day) is wired on the server; the others are shown disabled. */
export type UploadEvent = 'shabbat' | 'hag' | 'megila';
export const EVENT_PRAYERS: Record<UploadEvent, WirePrayer[]> = { shabbat: ['erev', 'day'], hag: [], megila: [] };
export const WIRED_EVENTS: UploadEvent[] = ['shabbat'];

// ---------------------------------------------------------------- matching a Form name

const TITLE = /^(משפחת|משפחה|משפ|בית)$/;
const stripTitle = (tokens: string[]) => (tokens.length > 1 && TITLE.test(normalizeName(tokens[0]!)) ? tokens.slice(1) : tokens);
const firstLetter = (s: string) => normalizeName(s).charAt(0);

/** The Form's "שם" is free text: "בדיוני שמעון", "שמעון בדיוני", "ש. משל", "בדיוני ש.", "משפחת דוגמה". Try both orders. */
export function nameVariants(name: string): { family: string; initial?: string }[] {
  const tokens = stripTitle(name.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean));
  if (tokens.length <= 1) return [{ family: tokens[0] ?? '' }];
  const first = tokens[0]!, last = tokens[tokens.length - 1]!;
  return [
    { family: tokens.slice(1).join(' '), initial: firstLetter(first) },
    { family: tokens.slice(0, -1).join(' '), initial: firstLetter(last) },
  ];
}

/** Suggestions for one Form name: the better of both name orders per household, ambiguity recomputed. Never a decision. */
export function suggestForName(key: string, name: string, families: KehilaFamily[], holders: Holder[]): MatchResult {
  const vs = nameVariants(name);
  const runs = suggestMatches(vs.map((v, i) => ({ familyKey: String(i), family: v.family, initial: v.initial })), families, holders);
  const best = new Map<string, MatchCandidate>();
  const order: string[] = [];
  const rank = (c: MatchCandidate) => (c.level === 'exact' ? 2 : 1);
  for (const run of runs) {
    for (const c of run.candidates) {
      const id = `${c.kind}:${c.id}`;
      const cur = best.get(id);
      if (!cur) { best.set(id, c); order.push(id); } else if (rank(c) > rank(cur)) best.set(id, c);
    }
  }
  let candidates = order.map((id) => best.get(id)!);
  candidates.sort((a, b) => rank(b) - rank(a));
  const exact = candidates.filter((c) => c.level === 'exact');
  const ambiguous = exact.length > 1 || runs.some((r) => r.ambiguous);
  if (ambiguous) candidates = candidates.map((c) => (c.level === 'exact' ? { ...c, level: 'likely' as const } : c));
  return { familyKey: key, level: !candidates.length ? 'none' : exact.length === 1 && !ambiguous ? 'exact' : 'likely', ambiguous, candidates };
}

// ---------------------------------------------------------------- the plan

export type RowStatus = 'change' | 'same' | 'skipped' | 'error' | 'duplicate';
export type PrayerLine = {
  prayer: WirePrayer;
  /** The file's count (a blank cell is zero), the count released now, and whether the household answered in the app. */
  file: number; now: number; app: boolean;
  /** The app's answer stays unless the gabbai picks the file. */
  kept: boolean;
};
export type PlanRow = {
  key: string; name: string; ref: string | null; refName: string; noAccount: boolean;
  seats: number; lines: PrayerLine[]; requests: Record<string, number>;
  status: RowStatus;
  /** `above` released more than held; `noSeats` has no seats on the map this week; `request-only` would only carry requests. */
  reason?: 'above' | 'noSeats' | 'duplicate' | 'skip';
  /** An earlier answer of this household replaced by this one. */
  earlier: number;
  /** The file differs from an app answer: offers "use the file's answer". */
  conflict: boolean;
  overridden: boolean;
};
export type ResponseRow = { household: string; released: number; requests?: Record<string, number>; override?: true };
export type ResponseCall = { event: WirePrayer; rows: ResponseRow[] };
export type UploadPlan = {
  rows: PlanRow[];
  calls: ResponseCall[];
  summary: { change: number; changeNoAccount: number; same: number; skipped: number; errors: number; kept: number };
  requests: { area: string; seats: number; households: number }[];
};

export type PlanInput = {
  week: WeekWire;
  answers: FormAnswer[];
  /** By `key(answer.name)`. */
  decisions: Record<string, Decision | undefined>;
  key?: (name: string) => string;
  /** Households (refs) whose row uses the file's answer over the app's. */
  overrides: ReadonlySet<string>;
  prayers: WirePrayer[];
  /** Name of a household that holds no seats this week (from the registered families and holders lists). */
  nameOf?: (ref: string) => string;
};

export const refOf = (d: Decision | undefined): string | null => (d?.kind === 'family' ? `family:${d.id}` : d?.kind === 'holder' ? `holder:${d.id}` : null);

export function planUpload(inp: PlanInput): UploadPlan {
  const key = inp.key ?? normalizeName;
  const w = inp.week;
  const held = new Map(householdsOf(w).map((h) => [h.ref, h]));
  const rowsOut: PlanRow[] = [];
  const winner = new Map<string, PlanRow>();

  for (const a of inp.answers) {
    const k = key(a.name);
    const d = inp.decisions[k];
    const ref = refOf(d);
    const base = { key: k, name: a.name, ref, refName: '', noAccount: ref?.startsWith('holder:') ?? false, seats: 0, lines: [] as PrayerLine[], requests: a.requests, earlier: a.earlier ?? 0, conflict: false, overridden: false };
    if (!ref || !isDecisionValid(d)) { rowsOut.push({ ...base, status: 'skipped', reason: 'skip' }); continue; }
    const h = held.get(ref);
    const seats = h?.seats.length ?? 0;
    const refName = h?.name || w.households[ref] || inp.nameOf?.(ref) || a.name;
    const lines = inp.prayers.map((p): PrayerLine => {
      const st = w.prayers[p]?.seats ?? {};
      const mine = h?.seats ?? [];
      const now = mine.filter((s) => st[s.id]?.released).length;
      const app = mine.some((s) => st[s.id]?.by === 'member');
      const file = a.counts[p] ?? 0;
      return { prayer: p, file, now, app, kept: false };
    });
    const overridden = inp.overrides.has(ref);
    for (const l of lines) l.kept = l.app && l.file !== l.now && !overridden;
    const conflict = lines.some((l) => l.app && l.file !== l.now);
    const row: Omit<PlanRow, 'status'> = { ...base, ref, refName, seats, lines, conflict, overridden };
    const hasRequests = Object.keys(a.requests).length > 0;
    if (lines.some((l) => l.file > seats) && seats > 0) rowsOut.push({ ...row, status: 'error', reason: 'above' });
    else if (seats === 0 && (lines.some((l) => l.file > 0) || !hasRequests)) {
      const wants = lines.some((l) => l.file > 0);
      rowsOut.push({ ...row, status: wants ? 'error' : 'skipped', reason: 'noSeats' });
    } else {
      // a household with no seats still gets its requests stored (ruling): a request-only row is applied
      const changed = seats === 0 || lines.some((l) => l.file !== l.now && !l.kept);
      const out: PlanRow = { ...row, status: changed ? 'change' : 'same' };
      // two names for one household: the later answer wins, here as on the server
      const prev = winner.get(ref);
      const at = (x: PlanRow) => inp.answers.find((y) => key(y.name) === x.key)?.at ?? 0;
      if (prev && at(prev) >= at(out)) { rowsOut.push({ ...out, status: 'duplicate', reason: 'duplicate' }); continue; }
      if (prev) { const i = rowsOut.indexOf(prev); rowsOut[i] = { ...prev, status: 'duplicate', reason: 'duplicate' }; }
      winner.set(ref, out);
      rowsOut.push(out);
    }
  }

  const live = [...winner.values()].filter((r) => rowsOut.includes(r));
  const calls: ResponseCall[] = inp.prayers.map((p, i) => {
    const rows: ResponseRow[] = [];
    for (const r of live) {
      const l = r.lines.find((x) => x.prayer === p)!;
      const wantsRequests = i === 0 && Object.keys(r.requests).length > 0;
      const changes = l.file !== l.now && !l.kept;
      if (!changes && !wantsRequests) continue;
      rows.push({ household: r.ref!, released: l.file, ...(wantsRequests ? { requests: r.requests } : {}), ...(r.overridden && l.app ? { override: true as const } : {}) });
    }
    return { event: p, rows };
  }).filter((c) => c.rows.length > 0);

  const summary = { change: 0, changeNoAccount: 0, same: 0, skipped: 0, errors: 0, kept: 0 };
  for (const r of rowsOut) {
    if (r.status === 'change') { summary.change++; if (r.noAccount) summary.changeNoAccount++; }
    else if (r.status === 'same') summary.same++;
    else if (r.status === 'error') summary.errors++;
    else summary.skipped++;
    if (r.status !== 'duplicate' && r.lines.some((l) => l.kept)) summary.kept++;
  }
  const requests = AREAS.flatMap((area) => {
    const asking = live.filter((r) => (r.requests[area] ?? 0) > 0);
    return asking.length ? [{ area: area as string, seats: asking.reduce((n, r) => n + r.requests[area]!, 0), households: asking.length }] : [];
  });
  return { rows: rowsOut, calls, summary, requests };
}

/** The matching list is ready when every answer has a valid decision (skip counts). */
export const allDecided = (answers: FormAnswer[], decisions: Record<string, Decision | undefined>, key: (n: string) => string = normalizeName): boolean =>
  answers.every((a) => isDecisionValid(decisions[key(a.name)]));

// ---------------------------------------------------------------- result of an apply

export type ApplyWarning = { household: string; code: 'app_answer_kept' | 'no_seats' | 'above_seats' | string };
export type ApplyResult = { event: WirePrayer; households: number; released: number; kept: number; duplicates: number; warnings: ApplyWarning[]; requestTotals: Record<string, number> };
export type ApplySummary = { households: number; released: number; warnings: ApplyWarning[]; requestTotals: Record<string, number>; events: WirePrayer[] };

/** Two calls (erev, day) read as one result. Requests travel with the first call only, so their totals are not added twice. */
export function combineResults(rs: ApplyResult[]): ApplySummary {
  const totals: Record<string, number> = {};
  let released = 0;
  const warnings: ApplyWarning[] = [];
  for (const r of rs) {
    released += r.released;
    for (const [area, n] of Object.entries(r.requestTotals ?? {})) totals[area] = (totals[area] ?? 0) + n;
    for (const wn of r.warnings ?? []) if (!warnings.some((x) => x.household === wn.household && x.code === wn.code)) warnings.push(wn);
  }
  return { households: Math.max(0, ...rs.map((r) => r.households)), released, warnings, requestTotals: totals, events: rs.map((r) => r.event) };
}

// ---------------------------------------------------------------- the screen's state

/** Upload, columns (recognised by their words, confirmed once), matching, preview. The result of an apply replaces the preview. */
export type UploadStep = 'upload' | 'columns' | 'match' | 'preview';
export const UPLOAD_STEPS: UploadStep[] = ['upload', 'columns', 'match', 'preview'];
export type UploadState = { step: UploadStep; event: UploadEvent; overrides: ReadonlySet<string> };
export type UploadAction =
  | { type: 'event'; event: UploadEvent }
  | { type: 'step'; step: UploadStep }
  | { type: 'override'; ref: string; on: boolean }
  | { type: 'reset' };
export const initialUpload = (): UploadState => ({ step: 'upload', event: 'shabbat', overrides: new Set() });
export function uploadReducer(s: UploadState, a: UploadAction): UploadState {
  switch (a.type) {
    case 'event': return WIRED_EVENTS.includes(a.event) ? { ...s, event: a.event } : s;
    case 'step': return { ...s, step: a.step };
    case 'override': {
      const overrides = new Set(s.overrides);
      if (a.on) overrides.add(a.ref); else overrides.delete(a.ref);
      return { ...s, overrides };
    }
    case 'reset': return initialUpload();
  }
}
