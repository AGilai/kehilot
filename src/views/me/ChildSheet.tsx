import React from 'react';
import { Platform, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { NAME_MAX } from '../../auth/validate.ts';
import { ApiCodeError } from '../../client/errors.ts';
import { formatBirthDate, parseBirthDate } from '../../client/familyView.ts';
import type { Child } from '../../client/types.ts';
import { israelDate } from '../../dates.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Chip, Field, Sheet, Txt, useTokens } from '../../kit/components.tsx';
import { useErrorText } from '../auth/Frame.tsx';

/** A 409 `try_again` (a concurrent edit of the same list) is retried once, silently. */
async function once<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ApiCodeError && e.code === 'try_again') return fn();
    throw e;
  }
}

/** P3: one form for add and edit. Edit also removes (inline confirm). Both adults edit the one list. */
export function ChildSheet({ visible, kehilaId, child, initial, onClose, onDone, onToast }: {
  visible: boolean; kehilaId: string; /** null = add. */ child: Child | null; /** Fixture frames only: a prefilled add form. */ initial?: { firstName: string; gender: 'm' | 'f'; birth: string };
  onClose: () => void; onDone: () => void; onToast: (text: string) => void;
}) {
  const { t } = useI18n();
  const { api } = useAuth();
  const k = useTokens();
  const errText = useErrorText();
  const [name, setName] = React.useState('');
  const [gender, setGender] = React.useState<'m' | 'f' | null>(null);
  const [birth, setBirth] = React.useState('');
  const [tried, setTried] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!visible) return;
    setName(child?.firstName ?? initial?.firstName ?? ''); setGender(child?.gender ?? initial?.gender ?? null);
    setBirth(child?.birthDate ? formatBirthDate(child.birthDate) : initial?.birth ?? '');
    setTried(false); setAsking(false); setError(null);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseBirthDate(birth, israelDate());
  const birthError = tried && 'error' in parsed ? (parsed.error === 'future' ? t('children.form.birthFuture') : t('children.form.birthInvalid')) : null;
  const nameOk = !!name.trim() && [...name].length <= NAME_MAX;

  async function save() {
    setTried(true);
    if (busy || !nameOk || !gender || 'error' in parsed) return;
    setBusy(true); setError(null);
    const body = { firstName: name.trim(), gender, ...(parsed.ok ? { birthDate: parsed.ok } : {}) };
    try {
      await once(() => child ? api.editChild(kehilaId, child.id, body) : api.addChild(kehilaId, body));
      onToast(t('children.form.saved')); onDone();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (busy || !child) return;
    setBusy(true); setError(null);
    try { await once(() => api.removeChild(kehilaId, child.id)); onToast(t('children.form.removed')); onDone(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  const title = child ? t('children.form.editTitle', { name: child.firstName }) : t('children.form.addTitle');
  return (
    <Sheet visible={visible} title={asking ? '' : title} onClose={onClose}
      footer={asking ? (
        <>
          <Button kind="danger" title={t('children.form.removeYes')} onPress={() => void remove()} busy={busy} />
          <Button kind="secondary" title={t('family.keep')} onPress={() => setAsking(false)} disabled={busy} />
        </>
      ) : <Button title={t('children.form.save')} onPress={() => void save()} busy={busy} disabled={!nameOk} />}>
      {asking ? (
        <Txt>{t('children.form.removeConfirm', { name: child?.firstName ?? '' })}</Txt>
      ) : (
        <>
          <Field label={t('children.form.firstName')} value={name} onChangeText={setName} maxCodePoints={NAME_MAX} editable={!busy} />
          <View style={{ gap: 6 }}>
            <Txt size="small" bold>{t('children.form.gender')}</Txt>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Chip label={t('children.son')} selected={gender === 'm'} onPress={() => setGender('m')} />
              <Chip label={t('children.daughter')} selected={gender === 'f'} onPress={() => setGender('f')} />
            </View>
            {tried && !gender ? <Txt size="small" color={k.danger} accessibilityRole="alert">{t('children.form.pickGender')}</Txt> : null}
          </View>
          <View style={{ gap: 6 }}>
            <Field label={t('children.form.birth')} value={birth} onChangeText={setBirth} keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'} ltr editable={!busy} error={birthError} />
            {!birthError ? <Txt size="small" color={k.muted}>{t('children.form.birthHint')}</Txt> : null}
          </View>
          {error ? <Banner tone="error" text={error} /> : null}
          {child ? <Button kind="secondary" title={t('children.form.remove')} onPress={() => setAsking(true)} disabled={busy} /> : null}
        </>
      )}
      {asking && error ? <Banner tone="error" text={error} /> : null}
    </Sheet>
  );
}
