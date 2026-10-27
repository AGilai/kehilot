import React from 'react';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Button, Card, Txt, useTokens } from '../kit/components.tsx';
import { useTestUpdate } from '../update/useTestUpdate.ts';

/** P15: "new test version" card, first under the greeting and outside P7's one-card queue. Silent unless a newer build exists. */
export function TestBuildCard() {
  const { t } = useI18n();
  const k = useTokens();
  const { update, download, dismiss } = useTestUpdate();
  if (!update) return null;
  const version = String(update.build);
  return (
    <Card edgeColor={k.tekhelet}>
      <Txt bold size="heading" accessibilityRole="header">{t('testBuild.title')}</Txt>
      <Txt>{t('testBuild.body', { version })}</Txt>
      <Button title={t('testBuild.download')} accessibilityLabel={t('testBuild.downloadA11y', { version })} onPress={download} />
      <Button kind="secondary" title={t('testBuild.later')} onPress={dismiss} />
    </Card>
  );
}
