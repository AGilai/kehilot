import type { Person } from '../tree/types.ts';
import { ApiCodeError } from './errors.ts';
import type { endpoints } from './endpoints.ts';

type Api = ReturnType<typeof endpoints>;
export type TreeDoc = { people: Person[]; version: number };

export const isVersionConflict = (e: unknown): boolean => e instanceof ApiCodeError && e.status === 409 && e.code === 'version_conflict';

export type SaveResult = { ok: true; doc: TreeDoc } | { ok: false; conflict: true; doc: TreeDoc };

/**
 * Saves the whole tree. When somebody else saved first (409 `version_conflict`) nothing was written: the current tree is
 * loaded and returned with `conflict: true`, so the caller shows the "somebody else updated the tree" message over it.
 * Any other error is thrown as it came.
 */
export async function saveTree(api: Pick<Api, 'putFamilyTree' | 'familyTree'>, kehilaId: string, people: Person[], ifVersion: number): Promise<SaveResult> {
  try {
    const { version } = await api.putFamilyTree(kehilaId, { people, ifVersion });
    return { ok: true, doc: { people, version } };
  } catch (e) {
    if (!isVersionConflict(e)) throw e;
    return { ok: false, conflict: true, doc: await api.familyTree(kehilaId) };
  }
}
