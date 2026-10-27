import React from 'react';
import { AppState, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from '../config.ts';
import { checkLatest, shouldCheck, visibleUpdate } from './check.ts';

const DISMISSED_KEY = 'testBuild.dismissed';
export const TEST_UPDATES = config.testBuild && Platform.OS === 'android';

// Module-level so a remounted Home (tab change) keeps the card and does not ask again within the interval.
let lastCheckedAt: number | null = null;
let lastFound: { build: number; url: string } | null = null;

/** The newer test build to offer (null: none, dismissed, offline or not the test build) and what the card's buttons do. */
export function useTestUpdate() {
  const [found, setFound] = React.useState(lastFound);
  const [dismissed, setDismissed] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!TEST_UPDATES) return;
    let active = true;
    async function run() {
      if (!shouldCheck(lastCheckedAt, Date.now())) return;
      const { replied, update } = await checkLatest(fetch, config.releasesRepo, config.buildNumber);
      if (!replied) return; // offline or failed: try again on the next start or resume
      lastCheckedAt = Date.now();
      lastFound = update;
      if (active) setFound(update);
    }
    AsyncStorage.getItem(DISMISSED_KEY).then(v => v, () => null).then(v => { if (active) setDismissed(Number(v) || 0); });
    void run();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void run(); });
    return () => { active = false; sub.remove(); };
  }, []);

  const update = visibleUpdate(found, dismissed, config.buildNumber);
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
