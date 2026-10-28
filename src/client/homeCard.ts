import { isAdult, isManagement } from './roles.ts';
import type { HomeCards, Role } from './types.ts';

export type HomeCardKind = 'gabbaiLink' | 'request' | 'imported' | 'seatLink' | 'terms' | 'phone';

/**
 * The one one-time card Home shows (UX §10.4 decision 1), in a fixed order: gabbai link, partner request,
 * import notice, the seat-link notice (members and gabbaim), Kehila terms (gabbai only), phone list (member and gabbai only). The server sends flags;
 * this only hides what the role never gets.
 */
export function pickHomeCard(cards: HomeCards, role: Role | undefined): HomeCardKind | null {
  if (cards.gabbaiLink) return 'gabbaiLink';
  if (cards.request) return 'request';
  if (cards.imported) return 'imported';
  if (cards.seatLink && cards.seatLink.seats > 0 && isAdult(role)) return 'seatLink';
  if (cards.terms && isManagement(role)) return 'terms';
  if (cards.phoneAsk && isAdult(role)) return 'phone';
  return null;
}
