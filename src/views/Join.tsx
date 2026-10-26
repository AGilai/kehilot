import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider.tsx';
import { ApiCodeError } from '../client/errors.ts';
import type { InvitePreview } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Txt, useTokens } from '../kit/components.tsx';
import { AuthFrame, useErrorText } from './auth/Frame.tsx';

type Load = { s: 'loading' } | { s: 'ok'; preview: InvitePreview } | { s: 'expired' } | { s: 'error'; error: string };

/**
 * M11: landing from an invite link. The preview is public and shows the Kehila name only.
 * Signed out: Register / "I already have an account". Signed in: Join.
 */
export function Join({ code, onRegister, onSignIn, onAccept, onClose }: {
  code: string;
  onRegister?: () => void;
  onSignIn?: () => void;
  /** Signed in: accepts the invite (the caller opens the Kehila). */
  onAccept?: () => Promise<void>;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const { api } = useAuth();
  const k = useTokens();
  const errText = useErrorText();
  const [load, setLoad] = React.useState<Load>({ s: 'loading' });
  const [attempt, setAttempt] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    setLoad({ s: 'loading' });
    api.previewInvite(code).then(
      preview => { if (live) setLoad({ s: 'ok', preview }); },
      e => {
        if (!live) return;
        if (e instanceof ApiCodeError && e.code === 'invite_expired') setLoad({ s: 'expired' });
        else setLoad({ s: 'error', error: e instanceof ApiCodeError && e.code === 'invite_not_found' ? errText(e) : t('join.loadError') });
      },
    );
    return () => { live = false; };
  }, [api, code, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  async function accept() {
    if (!onAccept || busy) return;
    setBusy(true); setError(null);
    try { await onAccept(); } catch (e) { setError(errText(e)); setBusy(false); }
  }
  const date = (iso: string) => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'long' }).format(new Date(iso));
  return (
    <AuthFrame title={t('join.title')} error={error}>
      {load.s === 'loading' ? (
        <View accessibilityLabel={t('join.loading')} style={{ paddingVertical: 24 }}><ActivityIndicator color={k.tekhelet} /></View>
      ) : null}
      {load.s === 'expired' ? (
        <>
          <Banner tone="error" text={t('join.expired')} />
          <Button kind="secondary" title={t('join.back')} onPress={onClose} />
        </>
      ) : null}
      {load.s === 'error' ? (
        <>
          <Banner tone="error" text={load.error} />
          <Button title={t('common.retry')} onPress={() => setAttempt(a => a + 1)} />
          <Button kind="secondary" title={t('join.back')} onPress={onClose} />
        </>
      ) : null}
      {load.s === 'ok' ? (
        <>
          <Card edgeColor={k.tekhelet}>
            <Txt size="small" color={k.muted}>{t('join.invited')}</Txt>
            <Txt serif size="title">{load.preview.kehilaName}</Txt>
            <Txt>{load.preview.role === 'member' ? t('join.asMember') : t('join.asListener')}</Txt>
            <Txt size="small" color={k.muted}>{t('join.expires', { date: date(load.preview.expiresAt) })}</Txt>
          </Card>
          {onAccept ? (
            <>
              <Button title={t('join.accept')} onPress={() => void accept()} busy={busy} />
              <Button kind="secondary" title={t('join.later')} onPress={onClose} disabled={busy} />
            </>
          ) : (
            <>
              <Button title={t('join.register')} onPress={() => onRegister?.()} />
              <Button kind="secondary" title={t('join.haveAccount')} onPress={() => onSignIn?.()} />
            </>
          )}
        </>
      ) : null}
    </AuthFrame>
  );
}
