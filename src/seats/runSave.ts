/**
 * The save sequence of the editor: create holders, PUT the layout, PUT the assignments, in that order (pure of UI; the
 * API is injected). A failure returns where it stopped and what is already done (`carry`), so a retry never creates a
 * holder twice or rewrites a layout that is already saved. 409 is reported as a conflict, never retried silently.
 */
import type { LayoutBody, NewHolder } from './savePlan.ts';

export type SaveApi = {
  createHolder(body: { name: string; phone?: string }): Promise<{ holderId: string }>;
  putLayout(from: string, body: LayoutBody & { ifUpdatedAt: number | null }): Promise<{ seats: { id: string; row: number; col: number }[]; updatedAt: number }>;
  /** The assignments' current `updatedAt` (null when none yet): read right before the PUT, since the layout save may bump it. */
  assignmentsGuard(from: string): Promise<number | null>;
  putAssignments(from: string, body: { assignments: Record<string, string | null>; ifUpdatedAt: number | null }): Promise<{ updatedAt: number }>;
};
export type SavePlan = {
  from: string;
  layoutGuard: number | null;
  holders: NewHolder[];
  layout: LayoutBody;
  assign: (seats: { id: string; row: number; col: number }[], created: Record<string, string>) => Record<string, string | null>;
};
export type SaveCarry = { created?: Record<string, string>; layout?: { seats: { id: string; row: number; col: number }[]; updatedAt: number } };
export type SaveStage = 'holders' | 'layout' | 'assignments';
export type SaveProgress = { step: SaveStage | 'done'; done: number; total: number };
/** A holder created (or reused) in this editing session. */
export type MadeHolder = { id: string; name: string; phone?: string };
export type SaveResult =
  | { ok: true; carry: SaveCarry; made: MadeHolder[] }
  | { ok: false; stage: SaveStage; code: string; field?: string; conflict: boolean; carry: SaveCarry; made: MadeHolder[] };

/** `known`: holders created earlier in this session; one with the same name and phone is reused, never created twice. */
export async function runSave(plan: SavePlan, api: SaveApi, carry: SaveCarry, onProgress: (p: SaveProgress) => void, known: MadeHolder[] = []): Promise<SaveResult> {
  const made: MadeHolder[] = [];
  const created: Record<string, string> = { ...(carry.created ?? {}) };
  let layout = carry.layout;
  const fail = (stage: SaveStage, e: unknown): SaveResult => {
    const x = e as { code?: unknown; status?: unknown; field?: unknown } | null;
    const code = typeof x?.code === 'string' ? x.code : 'generic';
    return { ok: false, stage, code, ...(typeof x?.field === 'string' ? { field: x.field } : {}), conflict: x?.status === 409, carry: { created, ...(layout ? { layout } : {}) }, made };
  };

  const todo = plan.holders.filter((h) => !created[h.key]);
  const total = plan.holders.length;
  onProgress({ step: 'holders', done: total - todo.length, total });
  for (const h of todo) {
    try {
      const same = [...known, ...made].find((x) => x.name === h.name && (x.phone ?? '') === (h.phone ?? ''));
      if (same) created[h.key] = same.id;
      else {
        const r = await api.createHolder({ name: h.name, ...(h.phone ? { phone: h.phone } : {}) });
        created[h.key] = r.holderId;
        made.push({ id: r.holderId, name: h.name, ...(h.phone ? { phone: h.phone } : {}) });
      }
    } catch (e) { return fail('holders', e); }
    onProgress({ step: 'holders', done: Object.keys(created).filter((k) => plan.holders.some((x) => x.key === k)).length, total });
  }

  if (!layout) {
    onProgress({ step: 'layout', done: 0, total: 1 });
    try { layout = await api.putLayout(plan.from, { ...plan.layout, ifUpdatedAt: plan.layoutGuard }); } catch (e) { return fail('layout', e); }
    onProgress({ step: 'layout', done: 1, total: 1 });
  }

  onProgress({ step: 'assignments', done: 0, total: 1 });
  try {
    const guard = await api.assignmentsGuard(plan.from);
    await api.putAssignments(plan.from, { assignments: plan.assign(layout.seats, created), ifUpdatedAt: guard });
  } catch (e) { return fail('assignments', e); }
  onProgress({ step: 'done', done: 1, total: 1 });
  return { ok: true, carry: { created, layout }, made };
}
