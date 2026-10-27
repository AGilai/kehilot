import React from 'react';
import { Linking, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { ApiCodeError } from '../../client/errors.ts';
import { exportState, needsFreshLink, type ExportState } from '../../client/exportView.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import type { ExportLink } from '../../client/types.ts';
import { textStart } from '../../i18n/direction.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Txt, useTokens } from '../../kit/components.tsx';
import { LinkRow, openWebPage } from './KehilaInfo.tsx';

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** P5: the Kehila's privacy contact, About, the policy, and "download my data". Every role. */
export function PrivacyCard({ onAbout }: { onAbout: () => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const { state } = useSession();
  const kehila = state.kehila;
  // The link lives in this component's state only: it is never logged, stored or passed on.
  const [phase, setPhase] = React.useState<ExportState | 'loading' | 'preparing'>('loading');
  const [link, setLink] = React.useState<ExportLink | null>(null);
  const [busy, setBusy] = React.useState(false);

  const apply = React.useCallback((r: { link: ExportLink } | { code: string }) => {
    if ('link' in r) setLink(r.link); else setLink(null);
    setPhase(exportState(r));
  }, []);
  const settle = (e: unknown): { code: string } => ({ code: e instanceof ApiCodeError ? e.code : 'failed' });

  React.useEffect(() => {
    let live = true;
    api.exportStatus().then(l => { if (live) apply({ link: l }); }, e => { if (live) apply(settle(e)); });
    return () => { live = false; };
  }, [api, apply]);

  async function prepare() {
    if (busy) return;
    setBusy(true); setPhase('preparing');
    try { apply({ link: await api.startExport() }); } catch (e) { apply(settle(e)); } finally { setBusy(false); }
  }
  async function download() {
    if (!link || busy) return;
    let url = link.url;
    if (needsFreshLink(link, nowSeconds())) {
      setBusy(true);
      try { const fresh = await api.exportStatus(); setLink(fresh); url = fresh.url; }
      catch (e) { apply(settle(e)); setBusy(false); return; }
      setBusy(false);
    }
    void Linking.openURL(url).catch(() => {});
  }

  if (!kehila) return null;
  const contact = kehila.privacyContact.trim();
  return (
    <Card>
      <Txt serif size="heading" accessibilityRole="header">{t('privacy.title')}</Txt>
      <Txt size="small" color={k.muted}>{t('privacy.contact', { kehila: kehila.name })}</Txt>
      {contact ? <Txt bold style={{ textAlign: textStart(lang) }}>{contact}</Txt> : <Txt color={k.muted}>{t('privacy.contactNone')}</Txt>}
      <LinkRow label={t('privacy.about')} onPress={onAbout} />
      <LinkRow external label={t('privacy.policy')} onPress={() => openWebPage('privacy')} />
      <View style={{ borderTopWidth: 1, borderTopColor: k.line, paddingTop: 8, gap: 8 }}>
        <Txt bold style={{ textAlign: textStart(lang) }}>{t('export.title')}</Txt>
        <Txt size="small" color={k.muted}>{t('export.body')}</Txt>
        {phase === 'preparing' ? (
          <>
            <Button kind="secondary" title={t('export.start')} onPress={() => {}} busy />
            <Txt size="small" color={k.muted}>{t('export.preparing')}</Txt>
          </>
        ) : phase === 'ready' ? (
          <>
            <Banner tone="success" text={t('export.ready')} />
            <Button title={t('export.download')} onPress={() => void download()} busy={busy} />
            <Txt size="small" color={k.muted}>{t('export.readyNote')}</Txt>
          </>
        ) : phase === 'limit' ? (
          <>
            <Banner text={t('export.limit')} />
            <Button kind="secondary" title={t('export.start')} onPress={() => {}} disabled />
          </>
        ) : phase === 'failed' ? (
          <Banner tone="error" text={t('export.failed')} action={{ title: t('common.retry'), onPress: () => void prepare() }} />
        ) : (
          <Button kind="secondary" title={t('export.start')} onPress={() => void prepare()} busy={phase === 'loading'} />
        )}
      </View>
    </Card>
  );
}
