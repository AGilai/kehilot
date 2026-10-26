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
};

export const CLOUD = !!config.clientId || config.fixtures;
