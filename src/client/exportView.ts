import type { ExportLink } from './types.ts';

export type ExportState = 'ready' | 'idle' | 'limit' | 'failed';

/** What the export area shows for a server answer: a link, or an error code. */
export function exportState(r: { link: ExportLink } | { code: string }): ExportState {
  if ('link' in r) return 'ready';
  if (r.code === 'export_not_found') return 'idle';
  if (r.code === 'export_limit') return 'limit';
  return 'failed';
}

/** A link is replaced by a fresh one when it is within 30 seconds of `expiresAt` (Unix seconds). */
export function needsFreshLink(link: ExportLink, nowSeconds: number): boolean {
  return nowSeconds >= link.expiresAt - 30;
}
