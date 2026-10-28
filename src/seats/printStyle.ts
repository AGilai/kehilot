import type { PrintState } from './wire.ts';

/** UX-DESIGN §15.9: the gabbai print's colour style. Shapes and labels are the same in every style. */
export type PrintStyle = 'green' | 'greenRed' | 'bw';
export const PRINT_STYLES: PrintStyle[] = ['green', 'greenRed', 'bw'];
export const PRINT_STYLE_DEFAULT: PrintStyle = 'green';
/** Per-device storage key. */
export const PRINT_STYLE_KEY = 'kehilot.seatPrintStyle';

const FILLS: Record<PrintStyle, Record<PrintState, string>> = {
  green: { taken: '#EBEBEB', released: '#9ED8AA', free: '#57B46C', pending: '#E9B44C' },
  greenRed: { taken: '#DB5B56', released: '#9ED8AA', free: '#57B46C', pending: '#E9B44C' },
  bw: { taken: '#C8C8C8', released: '#FFFFFF', free: '#FFFFFF', pending: '#FFFFFF' },
};

export const seatFill = (style: PrintStyle, state: PrintState): string => FILLS[style][state];

/** A stored value that is missing or not one of the three styles means the default. */
export function parsePrintStyle(raw: string | null | undefined): PrintStyle {
  return PRINT_STYLES.find(s => s === raw) ?? PRINT_STYLE_DEFAULT;
}

/** §16.12.4: the pending notch's legs: 35% of the cell height, kept between 5 and 9 px (8 on the hall's 32x24 cells, 6 in the 26x18 swatch). */
export const pendingNotch = (cellH: number): number => Math.min(9, Math.max(5, Math.round(cellH * 0.35)));

/** The print legend, in order, drawn in the style: taken, pending, released, free. */
export const LEGEND_STATES: PrintState[] = ['taken', 'pending', 'released', 'free'];
export const legendItems = (style: PrintStyle): { state: PrintState; fill: string; notch: boolean }[] =>
  LEGEND_STATES.map((state) => ({ state, fill: seatFill(style, state), notch: state === 'pending' }));
