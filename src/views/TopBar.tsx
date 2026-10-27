import React from 'react';
import { Image, Pressable, View } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../kit/components.tsx';
import { Icon } from '../kit/Icon.tsx';
import { TOUCH } from '../kit/theme.ts';

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

/** Top bar of every signed-in screen: [Kehila chip v] [bell]. The chevron shows only with more than one Kehila. */
export function TopBar({ onOpenSwitcher, onBell }: { onOpenSwitcher: () => void; onBell?: () => void }) {
  const { state } = useSession();
  const { t } = useI18n();
  const k = useTokens();
  const kehila = state.kehila;
  const many = (state.me?.kehilot.length ?? 0) > 1;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: TOUCH }}>
      {kehila ? (
        <Pressable accessibilityRole="button" accessibilityLabel={many ? `${kehila.name}. ${t('topbar.switch')}` : kehila.name}
          disabled={!many} onPress={onOpenSwitcher}
          style={{ flex: 1, minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <KehilaLogo kehilaId={kehila.kehilaId} name={kehila.name} logoVersion={kehila.logoVersion} />
          <Txt bold content numberOfLines={1} style={{ flexShrink: 1 }}>{kehila.name}</Txt>
          {many ? <Icon name="chev" size={16} color={k.muted} /> : null}
        </Pressable>
      ) : <View style={{ flex: 1 }} />}
      <Pressable accessibilityRole="button" accessibilityLabel={t('topbar.bell')} onPress={onBell}
        style={{ minWidth: TOUCH, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="bell" size={24} color={k.ink} />
      </Pressable>
    </View>
  );
}
