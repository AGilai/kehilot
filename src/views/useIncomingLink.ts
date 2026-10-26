import React from 'react';
import { Linking, Platform } from 'react-native';
import { config } from '../config.ts';
import { fixtureParams } from '../client/fixtures.ts';
import { parseLink } from '../client/links.ts';

/** Fixture invite codes (screenshots): ?screen=join is valid, ?screen=join-expired has run out. */
export const FIXTURE_CODES = { join: '7K3M9Q2XPA', expired: '4D8F2H6NRT' } as const;

/**
 * The invite code of an incoming link: the first URL (native: Linking.getInitialURL, web: window.location)
 * and later `url` events. `clear` forgets it; on web it also replaces the history entry.
 */
export function useIncomingLink(): { code: string | null; open: (code: string) => void; clear: () => void } {
  const [code, setCode] = React.useState<string | null>(() => {
    if (config.fixtures) {
      const s = fixtureParams().screen;
      return s === 'join' ? FIXTURE_CODES.join : s === 'join-expired' ? FIXTURE_CODES.expired : null;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
      const l = parseLink(window.location.href);
      return l?.kind === 'join' ? l.code : null;
    }
    return null;
  });
  React.useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location && !config.fixtures) {
      // A handled link must not run again on reload: replace the entry with the app root.
      const l = parseLink(window.location.href);
      if (l?.kind === 'join') window.history.replaceState(null, '', '/');
    }
    if (Platform.OS === 'web') return;
    const take = (url: string | null) => { const l = url ? parseLink(url) : null; if (l?.kind === 'join') setCode(l.code); };
    void Linking.getInitialURL().then(take, () => {});
    const sub = Linking.addEventListener('url', e => take(e.url));
    return () => sub.remove();
  }, []);
  return React.useMemo(() => ({ code, open: setCode, clear: () => setCode(null) }), [code]);
}
