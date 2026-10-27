import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import { TOUCH } from '../../kit/theme.ts';

/** Short local date in the current language. */
export function useShortDate(): (iso: string) => string {
  const { lang } = useI18n();
  return iso => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

/** Small read-only label (role, classification, group). */
export function Tag({ label, tone = 'plain' }: { label: string; tone?: 'plain' | 'strong' }) {
  const k = useTokens();
  return (
    <View style={{ paddingHorizontal: 10, minHeight: 24, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: tone === 'strong' ? k.tekhelet : k.line, backgroundColor: k.stone }}>
      <Txt size="caption" bold color={tone === 'strong' ? k.tekhelet : k.muted}>{label}</Txt>
    </View>
  );
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
