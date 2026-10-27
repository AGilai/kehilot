import React from 'react';
import { AppState, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../config.ts';
import { checkForUpdate, shouldCheck } from './check.ts';

const DISMISSED_KEY = 'testBuild.dismissed';
export const TEST_UPDATES = config.testBuild && Platform.OS === 'android';

// Module-level so a remounted Home does not ask again within the interval.
let lastCheckedAt: number | null = null;

/** The newer test build to offer (null: none, dismissed, offline or not the test build) and what the card's buttons do. */
export function useTestUpdate() {
  const [found, setFound] = React.useState<{ build: number; url: string } | null>(null);
  const [dismissed, setDismissed] = React.useState(0);

  React.useEffect(() => {
    if (!TEST_UPDATES) return;
    let active = true;
    async function run() {
      const now = Date.now();
      if (!shouldCheck(lastCheckedAt, now)) return;
      lastCheckedAt = now;
      const next = await checkForUpdate(fetch, config.releasesRepo, config.buildNumber);
      if (active) setFound(next);
    }
    AsyncStorage.getItem(DISMISSED_KEY).then(v => { if (active) setDismissed(Number(v) || 0); }, () => {});
    void run();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void run(); });
    return () => { active = false; sub.remove(); };
  }, []);

  const update = found && found.build > dismissed ? found : null;
  return {
    update,
    download: () => { if (update) void Linking.openURL(update.url).catch(() => {}); },
    dismiss: () => {
      if (!update) return;
      setDismissed(update.build);
      AsyncStorage.setItem(DISMISSED_KEY, String(update.build)).catch(() => {});
    },
  };
}
