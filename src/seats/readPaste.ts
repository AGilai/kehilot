import { parseHall } from './paste.ts';
import type { ParsedHall, PasteInput } from './paste.ts';

export type PasteProblem = 'empty' | 'too-large' | 'no-seats' | 'responses-tab';
/** What the paste screen does with a clipboard: a hall to check, or the reason there is none. */
export function readPaste(input: PasteInput): { parsed: ParsedHall | null; problem: PasteProblem | null; rows: number; cols: number } {
  const text = typeof input === 'string' ? input : input.text ?? '';
  const html = typeof input === 'string' ? '' : input.html ?? '';
  if (!text.trim() && !html.trim()) return { parsed: null, problem: 'empty', rows: 0, cols: 0 };
  const parsed = parseHall(input);
  if (parsed.warnings.some((w) => w.code === 'too-large')) return { parsed: null, problem: 'too-large', rows: 0, cols: 0 };
  if (parsed.counts.seats === 0) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0] ?? '';
    return { parsed: null, problem: /חותמת זמן|timestamp/i.test(header) ? 'responses-tab' : 'no-seats', rows: lines.length, cols: Math.max(0, ...lines.map((l) => l.split('\t').length)) };
  }
  return { parsed, problem: null, rows: parsed.rows, cols: parsed.cols };
}
