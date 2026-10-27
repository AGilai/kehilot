import React from 'react';
import { useColorScheme } from 'react-native';
import { Image } from 'expo-image';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { tokens } from './theme.ts';

/** Line icons copied from the `<symbol>` sprite of the design frames (24 viewBox, stroke 1.8, no fill). */
const PATHS = {
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  msg: '<path d="M4 5h16v11H9l-5 4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5 6.5-5s6.5 1.5 6.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c3 0 4.5 1.5 4.5 4"/>',
  back: '<path d="M9 6l6 6-6 6"/>',
  fwd: '<path d="M15 6l-6 6 6 6"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  belloff: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4M4 4l16 16"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',
  flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z"/>',
  send: '<path d="M3 12L21 4l-6 16-3-7z"/>',
} as const;

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
