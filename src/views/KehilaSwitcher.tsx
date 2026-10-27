import React from 'react';
import { Pressable, View } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Sheet, Txt, useTokens } from '../kit/components.tsx';
import { TOUCH } from '../kit/theme.ts';
import { useErrorText } from './auth/Frame.tsx';
import { KehilaInfo } from './me/KehilaInfo.tsx';
import { KehilaLogo } from './TopBar.tsx';

/** M6: every Kehila of the user, with logo and role chip; the current one is marked. */
export function KehilaSwitcher({ visible, onClose, onManage }: { visible: boolean; onClose: () => void; /** Gabbai of the open Kehila: enters management mode. */ onManage?: () => void }) {
  const { state, select } = useSession();
  const { t } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState(false);
  async function pick(id: string) {
    if (busy) return;
    if (id === state.kehilaId) { setInfo(true); return; } // the current row opens "about this Kehila"
    setBusy(true); setError(null);
    try { await select(id); onClose(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <>
    <KehilaInfo visible={visible && info} onClose={() => { setInfo(false); onClose(); }} />
    <Sheet visible={visible && !info} title={t('switcher.title')} onClose={onClose}>
      {error ? <Banner tone="error" text={error} /> : null}
      {onManage && state.kehila?.role === 'gabbai' ? <Button title={t('admin.enter')} onPress={onManage} /> : null}
      {(state.me?.kehilot ?? []).map(x => {
        const current = x.kehilaId === state.kehilaId;
        return (
          <Pressable key={x.kehilaId} accessibilityRole="button" accessibilityState={{ selected: current, disabled: busy }}
            accessibilityHint={current ? t('switcher.current') : undefined} onPress={() => void pick(x.kehilaId)}
            style={{ minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: current ? 2 : 1, borderColor: current ? k.tekhelet : k.line, backgroundColor: k.surface }}>
            <KehilaLogo kehilaId={x.kehilaId} name={x.name} logoVersion={x.logoVersion} size={40} />
            <Txt bold style={{ flex: 1 }}>{x.name}</Txt>
            <View style={{ paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12, backgroundColor: k.stone, borderWidth: 1, borderColor: k.line }}>
              <Txt size="caption" bold color={k.muted}>{t(`switcher.role.${x.role}`)}</Txt>
            </View>
          </Pressable>
        );
      })}
    </Sheet>
    </>
  );
}
