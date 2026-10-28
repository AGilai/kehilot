import React from 'react';
import { NAME_MAX } from '../../auth/validate.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Field, Sheet } from '../../kit/components.tsx';
import { useErrorText } from '../auth/Frame.tsx';

/** §18.2 "השם שלי" (החשבון › פרטיות ונתונים): the one edit outside the tree, for listeners (they have no tree). Two name fields. */
export function NameSheet({ onClose, onToast }: { onClose: () => void; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const { state, editProfile } = useSession();
  const errText = useErrorText();
  const profile = state.me?.profile;
  const [first, setFirst] = React.useState(profile?.firstName ?? '');
  const [last, setLast] = React.useState(profile?.lastName ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!profile) return null;
  const valid = !!first.trim() && [...first].length <= NAME_MAX && [...last].length <= NAME_MAX;
  async function save() {
    if (!valid || busy || !profile) return;
    setBusy(true); setError(null);
    try { await editProfile({ firstName: first.trim(), lastName: last.trim(), lang: profile.lang }); onToast(t('me.profile.saved')); onClose(); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet visible title={t('me.account.name')} onClose={onClose}
      footer={<Button title={t('me.profile.save')} onPress={() => void save()} busy={busy} disabled={!valid} />}>
      <Field label={t('auth.firstNameLabel')} value={first} onChangeText={setFirst} maxCodePoints={NAME_MAX} autoComplete="given-name" editable={!busy} />
      <Field label={t('auth.lastNameLabel')} value={last} onChangeText={setLast} maxCodePoints={NAME_MAX} autoComplete="family-name" editable={!busy} />
      {error ? <Banner tone="error" text={error} /> : null}
    </Sheet>
  );
}
