/** Which seat screen a fixture `?screen=` opens, and who may open the whole-hall print (gabbaim only; a member never reaches whole-hall data). */
export const SEAT_PRINT_ROLE = 'gabbai';
export const seatPrintAllowed = (role: string | undefined, flag: boolean): boolean => flag && role === SEAT_PRINT_ROLE;

export function seatScreenFor(screen: string | null, role: string | undefined, flag: boolean): 'seats' | 'seatPrint' | null {
  if (!flag || !screen) return null;
  if (screen === 'seat-print') return seatPrintAllowed(role, flag) ? 'seatPrint' : null;
  return ['seats', 'seats-split', 'seats-none', 'seats-closed', 'seats-gabbai'].includes(screen) ? 'seats' : null;
}

/** The seating editor (paste, check, match, layout): gabbaim only. The server refuses everyone else too. */
export const seatEditorAllowed = (role: string | undefined): boolean => role === SEAT_PRINT_ROLE;
