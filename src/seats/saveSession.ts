/**
 * The editor's save state (pure reducer): partial progress of one save plan, kept in SeatEditor so it survives the step screens.
 * Bound to a plan key (date + layout + holders + refs): another plan starts clean. While a save has failed the gabbai cannot leave or
 * change the date unless he explicitly discards the partial state. Holders made this session are remembered (to reuse or remove).
 */
import type { MadeHolder, SaveCarry, SaveResult } from './runSave.ts';

export type SaveSession = { key: string | null; carry: SaveCarry; failed: boolean; holders: MadeHolder[] };
export type SaveSessionAction =
  | { type: 'sync'; key: string }
  | { type: 'result'; result: SaveResult }
  | { type: 'discard' }
  | { type: 'removeHolder'; id: string };

export const initialSaveSession = (): SaveSession => ({ key: null, carry: {}, failed: false, holders: [] });
/** False while a failed save is pending: the date and Back stay locked. */
export const canLeaveSave = (s: SaveSession): boolean => !s.failed;

export function saveSessionReducer(s: SaveSession, a: SaveSessionAction): SaveSession {
  switch (a.type) {
    case 'sync': return s.key === a.key ? s : { ...s, key: a.key, carry: {}, failed: false };
    case 'result': {
      const holders = [...s.holders, ...a.result.made.filter((m) => !s.holders.some((h) => h.id === m.id))];
      return { ...s, carry: a.result.carry, failed: !a.result.ok, holders };
    }
    case 'discard': return { ...s, carry: {}, failed: false };
    case 'removeHolder': {
      const created = Object.fromEntries(Object.entries(s.carry.created ?? {}).filter(([, id]) => id !== a.id));
      return { ...s, holders: s.holders.filter((h) => h.id !== a.id), carry: { ...s.carry, created } };
    }
  }
}
