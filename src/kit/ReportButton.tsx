import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Icon } from './Icon.tsx';
import { Txt, useTokens } from './components.tsx';

/**
 * The floating "Alpha · Report a bug" pill and its collapsed dot (UX-DESIGN §13.1). Ink, not tekhelet: it is not
 * an app action. Position comes from `placeButton`; the collapsed state is the caller's (session memory).
 */
export function ReportButton({ corner, bottom, collapsed, onOpen, onHide, onShow }: { corner: 'start' | 'end'; bottom: number; collapsed: boolean; onOpen: () => void; onHide: () => void; onShow: () => void }) {
  const { t, dir } = useI18n();
  const k = useTokens();
  // Physical sides from the UI direction: react-native-web maps start/end to left/right unless I18nManager is flipped.
  const right = (corner === 'start') === (dir === 'rtl');
  const place = { position: 'absolute', bottom, ...(right ? { right: 16 } : { left: 16 }) } as const;
  const shadow = { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.25)' } as object;
  if (collapsed) {
    return (
      <View pointerEvents="box-none" style={place}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('bug.show')} onPress={onShow} hitSlop={17}
          style={[{ width: 14, height: 14, borderRadius: 7, backgroundColor: k.ink, borderWidth: 3, borderColor: k.stone, boxSizing: 'content-box' } as object, shadow]} />
      </View>
    );
  }
  return (
    <View pointerEvents="box-none" style={place}>
      <View style={[{ height: 32, borderRadius: 16, backgroundColor: k.ink, flexDirection: 'row', alignItems: 'center', overflow: 'visible' }, shadow]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('bug.buttonA11y')} onPress={onOpen} hitSlop={8}
          style={{ height: 32, justifyContent: 'center', paddingStart: 14, paddingEnd: 10 }}>
          <Txt size="caption" bold color={k.stone}>{t('bug.button')}</Txt>
        </Pressable>
        <View style={{ width: 1, height: 16, backgroundColor: k.stone, opacity: 0.35 }} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('bug.hide')} onPress={onHide} hitSlop={8}
          style={{ width: 28, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={16} color={k.stone} />
        </Pressable>
      </View>
    </View>
  );
}
