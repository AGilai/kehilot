export default {
  expo: {
    name: 'הקהילה שלי',
    slug: 'shul-regular',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    scheme: 'shul',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.shulregular.member',
      appleTeamId: process.env.APPLE_DEVELOPMENT_TEAM || undefined,
      infoPlist: { CFBundleAllowMixedLocalizations: true, CFBundleDevelopmentRegion: 'he' },
    },
    android: {
      package: 'com.shulregular.member',
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
    },
    plugins: [
      ['expo-build-properties', { ios: { enableSceneSupport: true } }],
      ['expo-localization', { supportsRTL: true }],
      'expo-secure-store',
      'expo-sharing',
      ['expo-notifications', { defaultChannel: 'community', color: '#245E4F' }],
    ],
    extra: {
      eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined },
    },
  },
};
