import React from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Button, Txt } from '../kit/components.tsx';
import { AuthFrame } from './auth/Frame.tsx';

/** The user belongs to no Kehila. Joining with a code or link arrives in Task 11. */
export function NoKehila() {
  const { t } = useI18n();
  const { signOut } = useAuth();
  return (
    <AuthFrame title={t('noKehila.title')}>
      <Txt>{t('noKehila.body')}</Txt>
      <Button kind="secondary" title={t('auth.profile.signOut')} onPress={() => void signOut()} />
    </AuthFrame>
  );
}
