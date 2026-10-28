import { NAME_MAX } from '../auth/validate.ts';
import { normalizePhone } from './phone.ts';

/** "הפרטים שלי בקהילה": what the account holds now (E.164 phone). */
export type Mine = { first: string; last: string; phone: string | null; showPhone: boolean };
/** What the block edits (the phone as typed). */
export type MineDraft = { first: string; last: string; phoneText: string; showPhone: boolean };

export type MineError = 'firstRequired' | 'nameLong' | 'phoneInvalid';
export type Step = { kind: 'profile'; first: string; last: string } | { kind: 'phone'; phone: string | null } | { kind: 'showPhone'; show: boolean };
export type StepKind = Step['kind'] | 'tree';

const len = (s: string) => [...s].length;

export const errorsOf = (d: MineDraft): MineError[] => {
  const out: MineError[] = [];
  if (!d.first.trim()) out.push('firstRequired');
  else if (len(d.first.trim()) > NAME_MAX || len(d.last.trim()) > NAME_MAX) out.push('nameLong');
  if (d.phoneText.trim() && normalizePhone(d.phoneText) === null) out.push('phoneInvalid');
  return out;
};

/**
 * The server calls the draft needs, in order: name, phone, switch. Compared with what the account holds NOW, so after a partial
 * failure a retry plans only what is still missing. The switch is skipped when there is no number to show.
 */
export function planSteps(cur: Mine, d: MineDraft): Step[] {
  const steps: Step[] = [];
  const first = d.first.trim(); const last = d.last.trim();
  if (first !== cur.first.trim() || last !== cur.last.trim()) steps.push({ kind: 'profile', first, last });
  const phone = d.phoneText.trim() ? normalizePhone(d.phoneText) : null;
  if (phone !== cur.phone) steps.push({ kind: 'phone', phone });
  if (phone && d.showPhone !== cur.showPhone) steps.push({ kind: 'showPhone', show: d.showPhone });
  return steps;
}

export const isDirty = (cur: Mine, d: MineDraft): boolean => planSteps(cur, d).length > 0;

export type Executor = { profile(s: Extract<Step, { kind: 'profile' }>): Promise<void>; phone(s: Extract<Step, { kind: 'phone' }>): Promise<void>; showPhone(s: Extract<Step, { kind: 'showPhone' }>): Promise<void> };
export type TreeResult = { ok: true } | { ok: false; message: string };
export type SaveOutcome = { ok: true; done: StepKind[] } | { ok: false; failed: StepKind; done: StepKind[]; error?: unknown; message?: string };

/**
 * The one save: the account steps one after the other, then the tree PUT (when the tree changed). The first failure stops the run:
 * nothing after it is sent, the tree is not written, and `done` lists what already went through (those are not repeated on retry).
 */
export async function saveAll(steps: Step[], exec: Executor, tree: (() => Promise<TreeResult>) | null): Promise<SaveOutcome> {
  const done: StepKind[] = [];
  for (const s of steps) {
    try {
      if (s.kind === 'profile') await exec.profile(s); else if (s.kind === 'phone') await exec.phone(s); else await exec.showPhone(s);
    } catch (error) { return { ok: false, failed: s.kind, done, error }; }
    done.push(s.kind);
  }
  if (tree) {
    let r: TreeResult;
    try { r = await tree(); } catch (error) { return { ok: false, failed: 'tree', done, error }; }
    if (!r.ok) return { ok: false, failed: 'tree', done, message: r.message };
    done.push('tree');
  }
  return { ok: true, done };
}
