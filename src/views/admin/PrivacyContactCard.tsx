import React from 'react';
import { Linking, Pressable } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import { config } from '../../config.ts';
import { textStart } from '../../i18n/direction.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Field, Txt, useTokens } from '../../kit/components.tsx';
import { TOUCH } from '../../kit/theme.ts';
import { useAdminErrText } from './shared.tsx';

const MAX = 100;

/** P12: the Kehila's privacy contact, free text up to 100 code points (empty = not set). View, then edit in the card. */
export function PrivacyContactCard({ contact, onSaved }: { contact: string; onSaved: (contact: string) => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const over = [...text.trim()].length > MAX;
  async function save() {
    if (over || busy || !state.kehilaId) return;
    const value = text.trim();
    setBusy(true); setError(null);
    try { await api.putSettings(state.kehilaId, { privacyContact: value }); onSaved(value); setEditing(false); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Card>
      <Txt serif size="heading" accessibilityRole="header">{t('admin.overview.privacy.title')}</Txt>
      <Txt size="small" color={k.muted}>{t('admin.overview.privacy.body')}</Txt>
      {editing ? (
        <>
          <Field label={t('admin.overview.privacy.field')} value={text} onChangeText={v => { setText(v); setError(null); }} maxCodePoints={MAX} editable={!busy} />
          {error ? <Banner tone="error" text={error} /> : null}
          <Button title={t('common.save')} onPress={() => void save()} busy={busy} disabled={over} />
          <Button kind="secondary" title={t('common.cancel')} onPress={() => { setEditing(false); setError(null); }} disabled={busy} />
        </>
      ) : (
        <>
          {contact ? <Txt bold>{contact}</Txt> : <Txt color={k.muted}>{t('admin.overview.privacy.none')}</Txt>}
          <Button kind="secondary" title={t('admin.overview.privacy.edit')} onPress={() => { setText(contact); setEditing(true); }} />
        </>
      )}
    </Card>
  );
}

/** P12: who accepted the Kehila terms and when, with the link to the text. */
export function TermsCard({ accepted }: { accepted: { name: string; at: number } | null | undefined }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  if (!accepted) return null;
  const date = new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(accepted.at * 1000));
  return (
    <Card>
      <Txt serif size="heading" accessibilityRole="header">{t('admin.overview.terms.title')}</Txt>
      <Txt size="small" color={k.muted}>{t('admin.overview.terms.accepted', { name: accepted.name, date })}</Txt>
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(`${config.webUrl}/terms/`).catch(() => {}); }} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
        <Txt size="small" bold color={k.tekhelet} style={{ textDecorationLine: 'underline', textAlign: textStart(lang) }}>{t('terms.read')} ↗</Txt>
      </Pressable>
    </Card>
  );
}
