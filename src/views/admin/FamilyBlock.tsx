import React from 'react';
import { Pressable, View } from 'react-native';
import type { AdminFamily } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import { ForwardIcon } from '../../kit/Icon.tsx';

/** P11: the family of one person, read only: adults, children (first name and birth year), the note. No phone numbers. */
export function FamilyBlock({ family, onTree }: { family: AdminFamily | undefined; /** Opens the family's tree, read only ("עץ המשפחה ›"). */ onTree?: () => void }) {
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
      {onTree ? (
        <Pressable testID="family-tree-link" accessibilityRole="button" onPress={onTree} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Txt bold color={k.tekhelet}>{t('admin.members.tree')}</Txt><ForwardIcon size={16} color={k.tekhelet} />
        </Pressable>
      ) : null}
      <Txt size="small" color={k.muted}>{t('admin.members.readOnly')}</Txt>
    </View>
  );
}
