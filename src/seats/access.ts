/** Which seat screen a fixture `?screen=` opens, and who may open the whole-hall print (gabbaim only; a member never reaches whole-hall data). */
import { isManagement } from '../client/roles.ts';
/** The real hall print and the on-behalf edit: gabbaim only (the server refuses everyone else too). */
export const seatPrintRole = (role: string | undefined): boolean => isManagement(role);
export const seatPrintAllowed = (role: string | undefined, flag: boolean): boolean => flag && isManagement(role);

export function seatScreenFor(screen: string | null, role: string | undefined, flag: boolean): 'seats' | 'seatPrint' | null {
  if (!flag || !screen) return null;
  if (screen === 'seat-print') return seatPrintAllowed(role, flag) ? 'seatPrint' : null;
  return ['seats', 'seats-split', 'seats-none', 'seats-closed', 'seats-gabbai', 'seats-big'].includes(screen) ? 'seats' : null;
}

/** The seating editor (paste, check, match, layout): gabbaim only. The server refuses everyone else too. */
export const seatEditorAllowed = (role: string | undefined): boolean => isManagement(role);
