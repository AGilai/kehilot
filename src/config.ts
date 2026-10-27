// Expo inlines only static `process.env.EXPO_PUBLIC_*` reads: do not index process.env dynamically.
const federation = (process.env.EXPO_PUBLIC_FEDERATION ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter((s: string): s is 'google' | 'apple' => s === 'google' || s === 'apple');

export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  region: process.env.EXPO_PUBLIC_REGION ?? '',
  poolId: process.env.EXPO_PUBLIC_COGNITO_POOL_ID ?? '',
  clientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID ?? '',
  cognitoDomain: process.env.EXPO_PUBLIC_COGNITO_DOMAIN ?? '',
  webUrl: process.env.EXPO_PUBLIC_WEB_URL ?? '',
  federation,
  fixtures: process.env.EXPO_PUBLIC_FIXTURES === '1',
  /** Owner's Android test build (GitHub Releases). Never set in the store build. */
  testBuild: process.env.EXPO_PUBLIC_TEST_BUILD === '1',
  buildNumber: Number(process.env.EXPO_PUBLIC_BUILD_NUMBER) || 0,
  releasesRepo: process.env.EXPO_PUBLIC_RELEASES_REPO ?? '',
  /** The floating "Alpha · Report a bug" button (UX-DESIGN §13). On in dev builds and the fixtures build. */
  bugReports: process.env.EXPO_PUBLIC_REPORTS === '1' || process.env.EXPO_PUBLIC_FIXTURES === '1',
};

export const CLOUD = !!config.clientId || config.fixtures;
