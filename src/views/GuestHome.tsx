import React from 'react';
import { View } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Txt, useTokens } from '../kit/components.tsx';
import { TOUCH } from '../kit/theme.ts';
import { useErrorText } from './auth/Frame.tsx';

const LOCKED = ['lockedBlessings', 'lockedChat', 'lockedDirectory', 'lockedPosting'] as const;

/** M10 (the parts M1 does not have): the membership card, open channels and the locked rows. */
export function GuestHome() {
  const { t } = useI18n();
  const { state, requestMembership } = useSession();
  const k = useTokens();
  const errText = useErrorText();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const sent = !!state.kehila?.pendingRequest;
  async function send() {
    if (busy || sent) return;
    setBusy(true); setError(null);
    try { await requestMembership(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <Card edgeColor={k.tekhelet}>
        <Txt bold size="heading">{t('guest.requestTitle')}</Txt>
        {sent ? (
          <Banner tone="success" text={t('guest.requestSent')} />
        ) : (
          <>
            <Txt>{t('guest.requestBody')}</Txt>
            {error ? <Banner tone="error" text={error} /> : null}
            <Button title={t('guest.requestSend')} onPress={() => void send()} busy={busy} />
          </>
        )}
      </Card>
      <Card>
        <Txt bold>{t('guest.channels')}</Txt>
        {state.channels.length === 0 ? <Txt size="small" color={k.muted}>{t('guest.noChannels')}</Txt> : null}
        {state.channels.map(c => (
          <View key={c.channelId} style={{ minHeight: TOUCH, justifyContent: 'center' }}><Txt>{c.name}</Txt></View>
        ))}
      </Card>
      <Card>
        <Txt bold>{t('guest.locked')}</Txt>
        {LOCKED.map(key => (
          <View key={key} accessibilityState={{ disabled: true }} style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, opacity: 0.75 }}>
            <Txt style={{ flex: 1 }}>{t(`guest.${key}`)}</Txt>
            <Txt size="caption" bold color={k.muted}>{t('guest.membersOnly')}</Txt>
          </View>
        ))}
      </Card>
    </>
  );
}
