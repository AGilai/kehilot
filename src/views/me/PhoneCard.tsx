import React from 'react';
import { View } from 'react-native';
import { ApiCodeError } from '../../client/errors.ts';
import { formatPhone, normalizePhone } from '../../client/phone.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Field, Toggle, Txt, useTokens } from '../../kit/components.tsx';
import { useErrorText } from '../auth/Frame.tsx';

/** P4: my number (one for all Kehilot), change/remove, and this Kehila's switch. Members and gabbaim only. */
export function PhoneCard({ onOpenList, onToast }: { onOpenList: () => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const { state, setPhone, setShowPhone } = useSession();
  const kehila = state.kehila;
  const phone = state.me?.profile?.phone ?? null;
  const [editing, setEditing] = React.useState(false);
  const [raw, setRaw] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!kehila) return null;

  const invalid = touched && raw.trim() !== '' && normalizePhone(raw) === null;
  const start = () => { setRaw(phone ? formatPhone(phone) : ''); setTouched(false); setError(null); setEditing(true); };

  async function save() {
    const e164 = normalizePhone(raw);
    setTouched(true);
    if (!raw.trim() || busy) return;
    if (!e164) { setError(t('me.phone.invalid')); return; }
    setBusy(true); setError(null);
    try { await setPhone(e164); setEditing(false); onToast(t('me.phone.saved')); }
    catch (e) { setError(e instanceof ApiCodeError && e.code === 'invalid_phone' ? t('me.phone.invalid') : errText(e)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (busy) return;
    setBusy(true); setError(null);
    try { await setPhone(null); onToast(t('me.phone.removed')); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  async function toggle(show: boolean) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await setShowPhone(show); onToast(show ? t('me.phone.shown') : t('me.phone.hidden')); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  return (
    <Card>
      <Txt serif size="heading" accessibilityRole="header">{t('me.phone.title')}</Txt>
      {editing ? (
        <>
          <Field label={t('me.phone.label')} value={raw} onChangeText={v => { setRaw(v); setError(null); }} placeholder={t('me.phone.placeholder')}
            keyboardType="phone-pad" autoComplete="tel" ltr editable={!busy} error={error ?? (invalid ? t('me.phone.invalid') : null)} />
          {!error && !invalid ? <Txt size="small" color={k.muted}>{t('me.phone.hint')}</Txt> : null}
          <Button title={t('me.profile.save')} onPress={() => void save()} busy={busy} disabled={!raw.trim()} />
          <Button kind="secondary" title={t('me.profile.cancel')} onPress={() => { setEditing(false); setError(null); }} disabled={busy} />
        </>
      ) : phone ? (
        <>
          <Txt size="small" bold>{t('me.phone.label')}</Txt>
          <Txt bold size="heading" style={{ writingDirection: 'ltr', textAlign: 'left', fontVariant: ['tabular-nums'] }}>{formatPhone(phone)}</Txt>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button kind="secondary" title={t('me.phone.edit')} onPress={start} disabled={busy} /></View>
            <View style={{ flex: 1 }}><Button kind="secondary" title={t('me.phone.remove')} onPress={() => void remove()} disabled={busy} /></View>
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: k.line }} />
          <Toggle label={t('me.phone.switch', { kehila: kehila.name })} value={kehila.showPhone} onChange={v => void toggle(v)} offNote={t('me.phone.switchOff', { kehila: kehila.name })} />
          {error ? <Banner tone="error" text={error} /> : null}
          <Txt size="small" color={k.muted}>{t('me.phone.who', { kehila: kehila.name })}</Txt>
          <Button title={t('me.phone.open')} onPress={onOpenList} />
        </>
      ) : (
        <>
          <Txt color={k.muted}>{t('me.phone.none')}</Txt>
          <Txt size="small" color={k.muted}>{t('me.phone.needNumber')}</Txt>
          <Button kind="secondary" title={t('me.phone.add')} onPress={start} />
        </>
      )}
    </Card>
  );
}
