import { config } from '../config.ts';
import { fixtureMemberSeats, fixtureParams, seatVariantOf } from '../client/fixtures.ts';
import type { FixtureMemberSeats } from '../client/fixtures.ts';

/** The preview runs on fixture data everywhere it is on. The later server version returns the same shape from the API. */
export function previewMemberSeats(): FixtureMemberSeats {
  return fixtureMemberSeats(seatVariantOf(config.fixtures ? fixtureParams().screen : null));
}

/** Home card variants for the frames: ?card=seats-done and ?card=seats-gabbai (fixture builds only). */
export function previewCardState(): 'ask' | 'done' | 'byGabbai' {
  const c = config.fixtures ? fixtureParams().card : null;
  return c === 'seats-done' ? 'done' : c === 'seats-gabbai' ? 'byGabbai' : 'ask';
}
