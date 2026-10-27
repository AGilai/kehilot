import type { HomeCards, Role } from './types.ts';

export type HomeCardKind = 'gabbaiLink' | 'request' | 'imported' | 'terms' | 'phone';

/**
 * The one one-time card Home shows (UX §10.4 decision 1), in a fixed order: gabbai link, partner request,
 * import notice, Kehila terms (gabbai only), phone list (member and gabbai only). The server sends flags;
 * this only hides what the role never gets.
 */
export function pickHomeCard(cards: HomeCards, role: Role | undefined): HomeCardKind | null {
  if (cards.gabbaiLink) return 'gabbaiLink';
  if (cards.request) return 'request';
  if (cards.imported) return 'imported';
  if (cards.terms && role === 'gabbai') return 'terms';
  if (cards.phoneAsk && (role === 'member' || role === 'gabbai')) return 'phone';
  return null;
}
