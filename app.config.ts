export default {
  expo: {
    name: 'הקהילה שלי',
    slug: 'shul-regular',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon/icon-1024.png',
    userInterfaceStyle: 'automatic',
    scheme: 'shul',
    locales: { he: './locales/he.json', en: './locales/en.json' },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.shulregular.member',
      appleTeamId: process.env.APPLE_DEVELOPMENT_TEAM || undefined,
      infoPlist: { CFBundleAllowMixedLocalizations: true, CFBundleDevelopmentRegion: 'he' },
    },
    android: {
      package: 'com.shulregular.member',
      adaptiveIcon: { foregroundImage: './assets/icon/adaptive-foreground.png', backgroundColor: '#2A3F94' },
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
    },
    web: { favicon: './assets/icon/favicon-48.png', bundler: 'metro', output: 'single', name: 'הקהילה שלי', lang: 'he' },
    plugins: [
      ['expo-build-properties', { ios: { enableSceneSupport: true } }],
      ['expo-localization', { supportsRTL: true }],
      'expo-secure-store',
      ['expo-image-picker', {
        // English defaults; the Hebrew and English texts per device language are in locales/.
        photosPermission: 'The app needs access to your photos to attach one to a message.',
        cameraPermission: 'The app needs the camera to take a photo for a message.',
        microphonePermission: false,
      }],
      ['expo-media-library', {
        // Add-only: the app saves a brochure image, it never reads the library. English default; he/en texts are in locales/.
        photosPermission: false,
        savePhotosPermission: 'The app needs permission to save an image from a message to your photos.',
        isAccessMediaLocationEnabled: false,
      }],
      ['expo-notifications', { defaultChannel: 'community', color: '#245E4F' }],
    ],
    extra: {
      eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined },
    },
  },
};
