import React from 'react';
import { View } from 'react-native';
import type { AdminFamily } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';

/** P11: the family of one person, read only: adults, children (first name and birth year), the note. No phone numbers. */
export function FamilyBlock({ family }: { family: AdminFamily | undefined }) {
  const { t } = useI18n();
  const k = useTokens();
  const kids = family?.children ?? [];
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: k.line, paddingTop: 8, gap: 8 }}>
      <Txt bold>{t('admin.members.family')}</Txt>
      {(family?.adults ?? []).map(a => (
        <View key={a.userId} style={{ minHeight: 32, justifyContent: 'center' }}><Txt>{a.displayName}</Txt></View>
      ))}
      {kids.length ? <Txt size="small">{t('admin.members.children', { n: kids.length })}: {kids.map(c => (c.birthYear ? `${c.firstName} (${c.birthYear})` : c.firstName)).join(', ')}</Txt> : null}
      <Txt size="small" color={k.muted}>{t('admin.members.readOnly')}</Txt>
    </View>
  );
}
