import type { FigureOptions } from './types.ts';

// The choices the figure picker (P35) can write. Keys are FigureOptions keys, so the compiler checks them.
export type EnumKey = 'headCovering' | 'kippah' | 'beard';
export const ENUM_CHOICES: { [K in EnumKey]: readonly NonNullable<FigureOptions[K]>[] } = {
  headCovering: ['tichel', 'hat', 'wig', 'none'],
  kippah: ['knitted', 'small', 'velvet', 'none'],
  beard: ['none', 'short', 'full'],
};
/** The saved choice with one more option applied. */
export const withOption = (own: FigureOptions | undefined, patch: Partial<FigureOptions>): FigureOptions => ({ ...(own ?? {}), ...patch });
/** `{ [key]: value }` for an enum row, typed against FigureOptions. */
export function enumPatch<K extends EnumKey>(key: K, value: NonNullable<FigureOptions[K]>): Partial<FigureOptions> { return { [key]: value } as Pick<FigureOptions, K>; }
