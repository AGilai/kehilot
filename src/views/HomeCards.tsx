import React from 'react';
import { Linking, Pressable } from 'react-native';
import { useAuth } from '../auth/AuthProvider.tsx';
import { pickHomeCard } from '../client/homeCard.ts';
import { normalizePhone } from '../client/phone.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { config } from '../config.ts';
import { textStart } from '../i18n/direction.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Field, Txt, useTokens } from '../kit/components.tsx';
import { TOUCH } from '../kit/theme.ts';
import { useErrorText } from './auth/Frame.tsx';

/** P7: the one one-time card under the greeting. After each action the Kehila is reloaded and the next card shows. */
export function HomeCards({ onTerms, onToast }: { onTerms: () => void; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const errText = useErrorText();
  const { state, refreshKehila, setPhone, setShowPhone } = useSession();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [unlinking, setUnlinking] = React.useState(false);
  const [raw, setRaw] = React.useState('');
  const kehila = state.kehila;
  if (!kehila) return null;
  const card = pickHomeCard(kehila.cards, kehila.role);
  if (!card) return null;
  const kid = kehila.kehilaId;
  const phone = state.me?.profile?.phone ?? null;

  async function run(fn: () => Promise<unknown>, done?: string) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); setUnlinking(false); if (done) onToast(done); await refreshKehila(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  const errorBanner = error ? <Banner tone="error" text={error} /> : null;
  const title = (text: string) => <Txt bold size="heading" accessibilityRole="header">{text}</Txt>;

  if (card === 'gabbaiLink' && kehila.cards.gabbaiLink) {
    const g = kehila.cards.gabbaiLink;
    if (unlinking) {
      return (
        <Card edgeColor={k.tekhelet}>
          <Txt>{t('family.unlinkConfirm', { name: g.partnerName })}</Txt>
          <Button kind="danger" title={t('family.unlinkYes')} busy={busy} onPress={() => void run(() => api.unlink(kid), t('family.unlinked'))} />
          <Button kind="secondary" title={t('family.keep')} disabled={busy} onPress={() => { setUnlinking(false); setError(null); }} />
          {errorBanner}
        </Card>
      );
    }
    return (
      <Card edgeColor={k.tekhelet}>
        {title(t('cards.gabbai.title'))}
        <Txt>{t('cards.gabbai.body', { gabbai: g.gabbaiName, name: g.partnerName, kehila: kehila.name })}</Txt>
        <Button title={t('cards.gabbai.ok')} busy={busy} onPress={() => void run(() => api.dismissCard(kid, 'gabbai_link'))} />
        <Button kind="secondary" title={t('family.unlink')} disabled={busy} onPress={() => { setUnlinking(true); setError(null); }} />
        {errorBanner}
      </Card>
    );
  }

  if (card === 'request' && kehila.cards.request) {
    const r = kehila.cards.request;
    return (
      <Card edgeColor={k.tekhelet}>
        {title(t('cards.request.title'))}
        <Txt>{t('cards.request.body', { name: r.fromName, kehila: kehila.name })}</Txt>
        <Button title={t('family.confirm')} busy={busy} onPress={() => void run(() => api.confirmPartner(kid, r.fromUserId), t('family.linked'))} />
        <Button kind="secondary" title={t('family.decline')} disabled={busy} onPress={() => void run(() => api.declinePartner(kid, r.fromUserId))} />
        <Txt size="small" color={k.muted}>{t('family.declineNote', { name: r.fromName })}</Txt>
        {errorBanner}
      </Card>
    );
  }

  if (card === 'imported') {
    return (
      <Card edgeColor={k.ash}>
        {title(t('cards.imported.title', { kehila: kehila.name }))}
        <Txt>{t('cards.imported.body')}</Txt>
        <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(`${config.webUrl}/privacy/`).catch(() => {}); }} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
          <Txt size="small" bold color={k.tekhelet} style={{ textDecorationLine: 'underline', textAlign: textStart(lang) }}>{t('common.policyLink')} ↗</Txt>
        </Pressable>
        <Button title={t('cards.imported.ok')} busy={busy} onPress={() => void run(() => api.dismissCard(kid, 'imported'))} />
        <Txt size="small" color={k.muted}>{t('cards.imported.leave')}</Txt>
        {errorBanner}
      </Card>
    );
  }

  if (card === 'seatLink' && kehila.cards.seatLink) {
    const n = kehila.cards.seatLink.seats;
    return (
      <Card edgeColor={k.olive}>
        {title(t('cards.seatLink.title'))}
        <Txt>{n === 1 ? t('cards.seatLink.bodyOne') : t('cards.seatLink.bodyOther', { n })}</Txt>
        <Button title={t('cards.seatLink.ok')} busy={busy} onPress={() => void run(() => api.dismissCard(kid, 'seat_link'))} />
        {errorBanner}
      </Card>
    );
  }

  if (card === 'terms') {
    return (
      <Card edgeColor={k.gold}>
        {title(t('cards.terms.title'))}
        <Txt>{t('cards.terms.body', { kehila: kehila.name })}</Txt>
        <Button title={t('cards.terms.open')} onPress={onTerms} />
      </Card>
    );
  }

  // phone
  const e164 = normalizePhone(raw);
  return (
    <Card edgeColor={k.tekhelet}>
      {title(t('cards.phone.title'))}
      <Txt>{t('cards.phone.body', { kehila: kehila.name })}</Txt>
      {phone ? (
        <Button title={t('cards.phone.yes')} busy={busy} onPress={() => void run(() => setShowPhone(true))} />
      ) : (
        <>
          <Field label={t('me.phone.label')} value={raw} onChangeText={v => { setRaw(v); setError(null); }} placeholder={t('me.phone.placeholder')}
            keyboardType="phone-pad" autoComplete="tel" ltr editable={!busy} />
          <Txt size="small" color={k.muted}>{t('me.phone.hint')}</Txt>
          <Button title={t('cards.phone.saveShow')} busy={busy} disabled={!e164} onPress={() => { if (e164) void run(async () => { await setPhone(e164); await setShowPhone(true); }); }} />
        </>
      )}
      <Button kind="secondary" title={t('cards.phone.notNow')} disabled={busy} onPress={() => void run(() => api.dismissCard(kid, 'phone'))} />
      {errorBanner}
    </Card>
  );
}
