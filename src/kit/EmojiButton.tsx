import React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Txt, useTokens } from './components.tsx';
import { EMOJI } from './emoji.ts';
import { TOUCH } from './theme.ts';

/** Web only: a button that opens a grid of emoji. A pick goes to `onPick`; the Composer inserts it and refocuses. */
export function EmojiButton({ onPick }: { onPick: (emoji: string) => void }) {
  const { t, dir } = useI18n();
  const k = useTokens();
  const [open, setOpen] = React.useState(false);
  if (Platform.OS !== 'web') return null;
  return (
    <View style={{ zIndex: 20 }}>
      <Pressable testID="emoji-button" accessibilityRole="button" accessibilityLabel={t('composer.emoji')} accessibilityState={{ expanded: open }}
        onPress={() => setOpen(o => !o)}
        style={{ width: TOUCH, height: TOUCH, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: k.line, backgroundColor: k.surface }}>
        <Txt size="heading">🙂</Txt>
      </Pressable>
      {open ? (
        <View testID="emoji-popover" accessibilityLabel={t('composer.emojiTitle')}
          style={{ position: 'absolute', bottom: TOUCH + 8, ...(dir === 'rtl' ? { left: 0 } : { right: 0 }), // react-native-web does not mirror `end` without I18nManager
           width: 300, maxWidth: '100vw' as unknown as number, maxHeight: 260, borderRadius: 12, borderWidth: 1, borderColor: k.line, backgroundColor: k.surface, padding: 8, zIndex: 30, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 6 }}>
          <ScrollView contentContainerStyle={{ gap: 6 }}>
            {EMOJI.map(g => (
              <View key={g.category} style={{ gap: 2 }}>
                <Txt size="caption" bold color={k.muted}>{t(`composer.emojiGroup.${g.category}`)}</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {g.items.map(e => (
                    <Pressable key={e} accessibilityRole="button" accessibilityLabel={e}
                      onPress={() => { setOpen(false); onPick(e); }}
                      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                      <Txt size="title" style={{ textAlign: 'center' }}>{e}</Txt>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
