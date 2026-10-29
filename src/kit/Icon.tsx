import React from 'react';
import { useColorScheme } from 'react-native';
import { Image } from 'expo-image';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { tokens } from './theme.ts';
import { ICON_PATHS } from './iconPaths.ts';

export { ICON_PATHS };
const PATHS = ICON_PATHS;

export type IconName = keyof typeof PATHS;

/** An SVG line icon drawn through expo-image from a data URI. It is an image, so it is never bidi-mirrored. */
export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color?: string }) {
  const scheme = useColorScheme();
  const c = color ?? tokens(scheme === 'dark' ? 'dark' : 'light').ink;
  const uri = React.useMemo(() => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`), [name, c]);
  return <Image source={{ uri }} style={{ width: size, height: size }} contentFit="contain" accessible={false} importantForAccessibility="no" accessibilityElementsHidden />;
}

/** "Back" and "forward" arrows follow the reading direction: back points right in Hebrew, left in English. */
export function BackIcon({ size = 20, color }: { size?: number; color?: string }) {
  const { dir } = useI18n();
  return <Icon name={dir === 'rtl' ? 'back' : 'fwd'} size={size} color={color} />;
}
export function ForwardIcon({ size = 20, color }: { size?: number; color?: string }) {
  const { dir } = useI18n();
  return <Icon name={dir === 'rtl' ? 'fwd' : 'back'} size={size} color={color} />;
}
