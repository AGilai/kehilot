// List import parsing. No DOM or React imports; parsed rows hold personal data and are never logged or stored.
import { unzipSync, strFromU8 } from 'fflate';
import type { Classification, ImportResult, ImportRow, Role } from '../client/types.ts';

export const IMPORT_MAX_ROWS = 10;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_GROUPS = 20;

export const HEADERS = {
  firstName: ['שם פרטי', 'first name', 'firstname'],
  lastName: ['שם משפחה', 'last name', 'lastname', 'surname'],
  email: ['אימייל', 'דוא"ל', 'מייל', 'email', 'e-mail'],
  role: ['תפקיד', 'role'],
  classification: ['סיווג', 'classification'],
  groups: ['קבוצות', 'קבוצה', 'groups', 'group'],
} as const;

/** Rows of a file; `lines[i]` (non-enumerable) is the physical line / row number of `rows[i]` as the user sees it. */
export type Table = string[][] & { lines?: number[] };
function withLines(rows: string[][], lines: number[]): Table {
  Object.defineProperty(rows, 'lines', { value: lines, enumerable: false });
  return rows;
}

export type Problem = { line: number; code: string };

export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1255').decode(bytes); }
}

function detectDelimiter(src: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const c of src) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && c in counts) counts[c]!++;
  }
  return counts[';']! > counts[',']! && counts[';']! >= counts['\t']! ? ';' : counts['\t']! > counts[',']! ? '\t' : ',';
}

export function parseCsv(text: string): Table {
  const src = text.replace(/^\uFEFF/, '');
  const delim = detectDelimiter(src);
  const rows: string[][] = []; const lineNos: number[] = [];
  let line = 1; let startLine = 1;
  let row: string[] = []; let cell = ''; let quoted = false; let wasQuoted = false;
  const endCell = () => { row.push(cell); cell = ''; wasQuoted = false; };
  const endRow = () => {
    endCell();
    if (row.some(c => c.trim() !== '')) { rows.push(row); lineNos.push(startLine); }
    row = [];
    startLine = line;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { cell += c; if (c === '\n') line++; }
    } else if (c === '"' && cell === '' && !wasQuoted) { quoted = true; wasQuoted = true; }
    else if (c === delim) endCell();
    else if (c === '\r') { if (src[i + 1] === '\n') i++; line++; endRow(); }
    else if (c === '\n') { line++; endRow(); }
    else cell += c;
  }
  if (cell !== '' || row.length > 0) endRow();
  return withLines(rows, lineNos);
}

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'amp') return '&';
    if (e === 'quot') return '"'; if (e === 'apos') return "'";
    return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}
const textOf = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unescapeXml(m[1]!)).join('');
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export function readXlsx(bytes: Uint8Array): Table {
  const files = unzipSync(bytes);
  const sstFile = files['xl/sharedStrings.xml'];
  const strings = sstFile ? [...strFromU8(sstFile).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]!)) : [];
  let path = 'xl/worksheets/sheet1.xml';
  const wb = files['xl/workbook.xml']; const rels = files['xl/_rels/workbook.xml.rels'];
  if (wb && rels) {
    const rid = /<sheet\b[^>]*?\br:id="([^"]*)"/.exec(strFromU8(wb))?.[1];
    for (const m of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
      if (rid && new RegExp(`\\bId="${rid}"`).test(m[0])) {
        const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1];
        if (target) path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
      }
    }
  }
  const sheet = files[path] ?? files['xl/worksheets/sheet1.xml'];
  if (!sheet) return withLines([], []);
  const out: string[][] = []; const lineNos: number[] = []; let rowNo = 0;
  for (const rm of strFromU8(sheet).matchAll(/<row(\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    rowNo = Number(/\br="(\d+)"/.exec(rm[1] ?? '')?.[1]) || rowNo + 1;
    const cells: string[] = [];
    let next = 0;
    for (const cm of rm[2]!.matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? ''; const inner = cm[2] ?? '';
      const ref = /\br="([A-Za-z]+\d*)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : next;
      const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = '';
      if (type === 's') val = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') val = textOf(inner);
      else if (v !== undefined) val = unescapeXml(v);
      while (cells.length < idx) cells.push('');
      cells[idx] = val;
      next = idx + 1;
    }
    if (cells.some(c => c.trim() !== '')) { out.push(cells); lineNos.push(rowNo); }
  }
  return withLines(out, lineNos);
}

const ROLES: Record<string, Role> = { 'אורח': 'listener', listener: 'listener', 'חבר': 'member', member: 'member', 'גבאי': 'gabbai', gabbai: 'gabbai', 'טכני': 'tech', tech: 'tech' };
const CLASSES: Record<string, Classification> = { 'א': 'א', 'קבוע': 'קבוע', '': '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MappedRows = { rows: ImportRow[]; lines: number[]; problems: Problem[] };

/** `lines[i]` is the 1-based line (row of the table, header = 1) of `rows[i]`. */
export function mapRows(table: Table): MappedRows {
  const head = (table[0] ?? []).map(h => h.trim().toLowerCase());
  const col = (names: readonly string[]) => head.findIndex(h => names.includes(h));
  const idx = Object.fromEntries((Object.keys(HEADERS) as (keyof typeof HEADERS)[]).map(key => [key, col(HEADERS[key])])) as Record<keyof typeof HEADERS, number>;
  if (idx.firstName < 0 || idx.lastName < 0 || idx.email < 0) return { rows: [], lines: [], problems: [{ line: table.lines?.[0] ?? 1, code: 'missing_column' }] };
  const rows: ImportRow[] = []; const lines: number[] = []; const problems: Problem[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < table.length; i++) {
    const line = table.lines?.[i] ?? i + 1; const r = table[i]!;
    const get = (c: number) => (c >= 0 ? (r[c] ?? '').trim() : '');
    const firstName = get(idx.firstName); const lastName = get(idx.lastName); const email = get(idx.email).toLowerCase();
    const roleText = get(idx.role).toLowerCase();
    const role = roleText === '' ? 'member' : ROLES[roleText];
    const classification = CLASSES[get(idx.classification)];
    let code: string | null = null;
    if (!firstName || [...firstName].length > 60) code = 'invalid_first_name';
    else if (!lastName || [...lastName].length > 60) code = 'invalid_last_name';
    else if (!EMAIL_RE.test(email)) code = 'invalid_email';
    else if (!role) code = 'invalid_role';
    else if (classification === undefined) code = 'invalid_classification';
    else if (seen.has(email)) code = 'duplicate_email';
    if (code) { problems.push({ line, code }); continue; }
    seen.add(email);
    const row: ImportRow = { firstName, lastName, email, role: role!, classification: classification! };
    if (idx.groups >= 0) {
      const groups = get(idx.groups).split(/[;,|]/).map(s => s.trim()).filter(Boolean).slice(0, MAX_GROUPS);
      if (groups.length) row.groups = groups;
    }
    rows.push(row); lines.push(line);
  }
  return { rows, lines, problems };
}

export function checkGroups(rows: ImportRow[], knownNames: string[], lines?: number[]): Problem[] {
  const known = new Set(knownNames.map(n => n.trim().toLowerCase()));
  const out: Problem[] = [];
  rows.forEach((r, i) => {
    if ((r.groups ?? []).some(g => !known.has(g.trim().toLowerCase()))) out.push({ line: lines ? lines[i]! : i + 2, code: 'unknown_group' });
  });
  return out;
}

export type ImportSummary = {
  counts: Record<ImportResult['status'], number>;
  invalid: Problem[];
  /** Set when the run stopped early: the error code (or `skipped_too_long`) and how many rows were not sent. */
  stopped?: { code: string; remaining: number };
};

/**
 * Sends the rows one batch at a time (IMPORT_MAX_ROWS each). `skipped` rows go back to the front of the queue;
 * `try_again` retries the same batch up to 3 times. Any other error stops the run.
 */
export async function runBatches(
  rows: ImportRow[], lines: number[],
  send: (batch: ImportRow[]) => Promise<ImportResult[]>,
  onProgress: (done: number, total: number) => void,
  opts: { shouldStop?: () => boolean; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ImportSummary> {
  const counts = { created: 0, added: 0, upgraded: 0, skipped: 0, exists: 0, invalid: 0 };
  const invalid: Problem[] = [];
  let queue = rows.map((row, i) => ({ row, line: lines[i] ?? i + 2 }));
  let done = 0; let skipRounds = 0;
  onProgress(0, rows.length);
  const sleep = opts.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  while (queue.length) {
    if (opts.shouldStop?.()) return { counts, invalid, stopped: { code: 'aborted', remaining: queue.length } };
    const batch = queue.slice(0, IMPORT_MAX_ROWS);
    let results: ImportResult[] | null = null;
    for (let attempt = 0; results === null; attempt++) {
      try { results = await send(batch.map(b => b.row)); }
      catch (e) {
        const code = (e as { code?: unknown } | null)?.code;
        if (code === 'try_again' && attempt < 3) { await sleep(1000 * 2 ** attempt); continue; }
        return { counts, invalid, stopped: { code: typeof code === 'string' ? code : 'network', remaining: queue.length } };
      }
    }
    const redo: typeof queue = [];
    batch.forEach((b, i) => {
      const res = results!.find(x => x.index === i);
      if (!res || res.status === 'skipped') { redo.push(b); return; }
      counts[res.status]++; done++;
      if (res.status === 'invalid') invalid.push({ line: b.line, code: res.error ?? 'invalid' });
    });
    skipRounds = redo.length === batch.length ? skipRounds + 1 : 0;
    queue = [...redo, ...queue.slice(batch.length)];
    onProgress(done, rows.length);
    if (skipRounds >= 3) return { counts, invalid, stopped: { code: 'skipped_too_long', remaining: queue.length } };
  }
  return { counts, invalid };
}
