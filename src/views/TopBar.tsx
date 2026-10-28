import React from 'react';
import { Image, Pressable, View } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../kit/components.tsx';
import { Icon } from '../kit/Icon.tsx';
import { TOUCH } from '../kit/theme.ts';
import { useWaiting } from './useWaiting.ts';

/** Logo, or the initial-letter tile when the Kehila has none (or it is still loading). */
export function KehilaLogo({ kehilaId, name, logoVersion, size = 32 }: { kehilaId: string; name: string; logoVersion: string | null; size?: number }) {
  const { logo } = useSession();
  const { t } = useI18n();
  const k = useTokens();
  const [uri, setUri] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    setUri(null);
    void logo(kehilaId, logoVersion).then(u => { if (live) setUri(u); });
    return () => { live = false; };
  }, [kehilaId, logoVersion, logo]);
  if (uri) return <Image accessibilityLabel={t('topbar.logo')} source={{ uri }} style={{ width: size, height: size, borderRadius: size / 4 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: k.tekhelet, alignItems: 'center', justifyContent: 'center' }}>
      <Txt bold color={k.onAction} style={{ textAlign: 'center', lineHeight: size }}>{[...name.trim()][0] ?? ''}</Txt>
    </View>
  );
}

/** The Kehila logo in the top bar: 160% of the former 32 px. */
export const TOPBAR_LOGO = 52;

/**
 * Top bar of every signed-in screen (RTL): the Kehila name with a chevron on the start side (the trigger of the Kehila menu, §18.2a),
 * the Kehila logo on the end side (also opens the menu). A pomegranate dot sits on the logo when something waits for a gabbai.
 * Notification settings are a row of the Kehila menu.
 */
export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { state } = useSession();
  const { t } = useI18n();
  const k = useTokens();
  const waiting = useWaiting();
  const kehila = state.kehila;
  if (!kehila) return <View style={{ minHeight: TOUCH }} />;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: TOPBAR_LOGO + 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${kehila.name}. ${t('topbar.menu')}${waiting.any ? `. ${t('topbar.waiting')}` : ''}`}
        onPress={onOpenMenu} style={{ flex: 1, minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt bold content numberOfLines={1} style={{ flexShrink: 1 }}>{kehila.name}</Txt>
        <Icon name="chev" size={16} color={k.muted} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('topbar.menu')} onPress={onOpenMenu} style={{ paddingVertical: 4 }}>
        <KehilaLogo kehilaId={kehila.kehilaId} name={kehila.name} logoVersion={kehila.logoVersion} size={TOPBAR_LOGO} />
        {waiting.any ? <View testID="kehila-dot" style={{ position: 'absolute', top: 1, end: -3, width: 12, height: 12, borderRadius: 6, backgroundColor: k.pomegranate, borderWidth: 2, borderColor: k.stone }} /> : null}
      </Pressable>
    </View>
  );
}
