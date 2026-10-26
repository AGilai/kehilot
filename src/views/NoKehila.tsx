import React from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { parseLink } from '../client/links.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Button, Card, Field, Txt } from '../kit/components.tsx';
import { AuthFrame } from './auth/Frame.tsx';

/** The user belongs to no Kehila: join with a typed code or a pasted link. */
export function NoKehila({ onCode }: { onCode: (code: string) => void }) {
  const { t } = useI18n();
  const { signOut } = useAuth();
  const [text, setText] = React.useState('');
  const [bad, setBad] = React.useState(false);
  function submit() {
    const l = parseLink(text);
    if (l?.kind === 'join') { setBad(false); onCode(l.code); } else setBad(true);
  }
  return (
    <AuthFrame title={t('noKehila.title')}>
      <Txt>{t('noKehila.body')}</Txt>
      <Card>
        <Field label={t('noKehila.codeLabel')} value={text} onChangeText={v => { setText(v); setBad(false); }} autoCapitalize="characters" autoCorrect={false}
          error={bad ? t('noKehila.codeInvalid') : null} onSubmitEditing={submit} />
        <Button title={t('noKehila.codeSubmit')} onPress={submit} disabled={!text.trim()} />
      </Card>
      <Button kind="secondary" title={t('auth.profile.signOut')} onPress={() => void signOut()} />
    </AuthFrame>
  );
}
