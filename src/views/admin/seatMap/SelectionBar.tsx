// The floating dark bar for the current selection (UX-DESIGN §16.4 "SelectionBar"). It sits above the canvas, centred, and speaks politely.
import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../../kit/components.tsx';

export type BarAction = { key: string; label: string; onPress: () => void; disabled?: boolean };
export function SelectionBar({ text, actions }: { text: string; actions: BarAction[] }) {
  const k = useTokens();
  const { dir } = useI18n();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 20, alignItems: 'center', direction: dir }}>
      <View accessibilityRole="toolbar" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', maxWidth: '94%', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: k.band, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
        <Txt bold color="#FFFFFF" style={{ paddingEnd: 10 }}>{text}</Txt>
        {actions.map((a) => (
          <Pressable key={a.key} accessibilityRole="button" disabled={a.disabled} onPress={a.onPress} style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 9, justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', opacity: a.disabled ? 0.4 : 1 }}>
            <Txt size="small" bold color="#FFFFFF">{a.label}</Txt>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
