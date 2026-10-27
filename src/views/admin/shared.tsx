import React from 'react';
import { fromEpochSeconds } from '../../client/time.ts';
import { Pressable, View } from 'react-native';
import { useErrorText } from '../auth/Frame.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import { TOUCH } from '../../kit/theme.ts';

/** Short local date in the current language. */
export function useShortDate(): (seconds: number) => string {
  const { lang } = useI18n();
  return seconds => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' }).format(fromEpochSeconds(seconds));
}

/** A radio-like option with its consequence written under it. */
export function Choice({ label, note, selected, onPress }: { label: string; note: string; selected: boolean; onPress: () => void }) {
  const k = useTokens();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label} onPress={onPress}
      style={{ minHeight: TOUCH, padding: 12, borderRadius: 12, borderWidth: selected ? 2 : 1, borderColor: selected ? k.tekhelet : k.line, backgroundColor: k.surface, gap: 2 }}>
      <Txt bold color={selected ? k.tekhelet : k.ink}>{label}</Txt>
      <Txt size="small" color={k.muted}>{note}</Txt>
    </Pressable>
  );
}

export const WIDE = 1024;

/** Provided by Main: called when an admin call is refused with 403 `forbidden` (the role was taken away). */
export const AdminContext = React.createContext<{ onForbidden: () => void }>({ onForbidden: () => {} });

/** Like `useErrorText`, and a `forbidden` answer also leaves management mode. */
export function useAdminErrText(): (e: unknown) => string {
  const text = useErrorText();
  const { onForbidden } = React.useContext(AdminContext);
  return e => {
    if ((e as { code?: unknown } | null)?.code === 'forbidden') onForbidden();
    return text(e);
  };
}
