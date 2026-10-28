import React from 'react';
import { Linking, Pressable } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import { config } from '../../config.ts';
import { textStart } from '../../i18n/direction.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Field, Sheet, Txt, useTokens } from '../../kit/components.tsx';
import { TOUCH } from '../../kit/theme.ts';
import { useAdminErrText } from './shared.tsx';

const MAX = 100;

/** §18.3 settings rows show their value; tapping one opens a Sheet with the field and "שמירה". Nothing is edited in the overview. */

/** The listener cap (PUT settings, 0 to 5000). */
export function CapSheet({ visible, cap, listeners, onClose, onSaved }: { visible: boolean; cap: number | undefined; listeners: number | undefined; onClose: () => void; onSaved: (n: number) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (visible) { setText(String(cap ?? 0)); setError(null); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = /^\d+$/.test(text.trim()) && +text <= 5000 ? +text : null;
  async function save() {
    if (n === null || busy || !state.kehilaId) return;
    setBusy(true); setError(null);
    try { await api.putSettings(state.kehilaId, { maxListeners: n }); onSaved(n); onClose(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet visible={visible} title={t('admin.overview.cap.title')} onClose={onClose} closeLabel={t('common.cancel')}
      footer={<Button title={t('admin.overview.cap.save')} onPress={() => void save()} busy={busy} disabled={n === null} />}>
      <Txt size="small" color={k.muted}>{t('admin.overview.cap.body')}</Txt>
      {cap !== undefined ? <Txt bold>{t('admin.overview.cap.value', { n: listeners ?? 0, max: cap })}</Txt> : null}
      <Field label={t('admin.overview.cap.field')} value={text} onChangeText={setText} keyboardType="number-pad" error={n === null ? t('admin.overview.cap.invalid') : null} />
      {error ? <Banner tone="error" text={error} /> : null}
    </Sheet>
  );
}

/** P12: the Kehila's privacy contact, free text up to 100 code points (empty = not set). */
export function PrivacyContactSheet({ visible, contact, onClose, onSaved }: { visible: boolean; contact: string; onClose: () => void; onSaved: (contact: string) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (visible) { setText(contact); setError(null); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const over = [...text.trim()].length > MAX;
  async function save() {
    if (over || busy || !state.kehilaId) return;
    const value = text.trim();
    setBusy(true); setError(null);
    try { await api.putSettings(state.kehilaId, { privacyContact: value }); onSaved(value); onClose(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet visible={visible} title={t('admin.overview.privacy.title')} onClose={onClose} closeLabel={t('common.cancel')}
      footer={<Button title={t('common.save')} onPress={() => void save()} busy={busy} disabled={over} />}>
      <Txt size="small" color={k.muted}>{t('admin.overview.privacy.body')}</Txt>
      <Field label={t('admin.overview.privacy.field')} value={text} onChangeText={v => { setText(v); setError(null); }} maxCodePoints={MAX} editable={!busy} />
      {error ? <Banner tone="error" text={error} /> : null}
    </Sheet>
  );
}

export const termsDate = (lang: string, at: number): string => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(at * 1000));

/** P12: who accepted the Kehila terms and when, with the link to the text. */
export function TermsSheet({ visible, accepted, onClose }: { visible: boolean; accepted: { name: string; at: number } | null | undefined; onClose: () => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  return (
    <Sheet visible={visible} title={t('admin.overview.terms.title')} onClose={onClose}>
      {accepted ? <Txt size="small" color={k.muted}>{t('admin.overview.terms.accepted', { name: accepted.name, date: termsDate(lang, accepted.at) })}</Txt> : null}
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(`${config.webUrl}/terms/`).catch(() => {}); }} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
        <Txt size="small" bold color={k.tekhelet} style={{ textDecorationLine: 'underline', textAlign: textStart(lang) }}>{t('terms.read')} ↗</Txt>
      </Pressable>
    </Sheet>
  );
}
