import type { PrintState } from './printModel.ts';

/** UX-DESIGN §15.9: the gabbai print's colour style. Shapes and labels are the same in every style. */
export type PrintStyle = 'green' | 'greenRed' | 'bw';
export const PRINT_STYLES: PrintStyle[] = ['green', 'greenRed', 'bw'];
export const PRINT_STYLE_DEFAULT: PrintStyle = 'green';
/** Per-device storage key. */
export const PRINT_STYLE_KEY = 'kehilot.seatPrintStyle';

const FILLS: Record<PrintStyle, Record<PrintState, string>> = {
  green: { taken: '#EBEBEB', released: '#9ED8AA', free: '#57B46C' },
  greenRed: { taken: '#DB5B56', released: '#9ED8AA', free: '#57B46C' },
  bw: { taken: '#C8C8C8', released: '#FFFFFF', free: '#FFFFFF' },
};

export const seatFill = (style: PrintStyle, state: PrintState): string => FILLS[style][state];

/** A stored value that is missing or not one of the three styles means the default. */
export function parsePrintStyle(raw: string | null | undefined): PrintStyle {
  return PRINT_STYLES.find(s => s === raw) ?? PRINT_STYLE_DEFAULT;
}
