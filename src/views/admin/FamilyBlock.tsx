import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import type { PhoneRow } from '../../client/membersView.ts';
import type { AdminFamily } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Button, Txt, useTokens } from '../../kit/components.tsx';
import { ForwardIcon } from '../../kit/Icon.tsx';

/**
 * P11: the family of one person, read only: adults (each with the phone, the phone-list state, and call / WhatsApp), children
 * (first name and birth year), the note. Gabbaim always see the phone; the list switch only says who else sees it (§18.3).
 * Numbers are never logged.
 */
export function FamilyBlock({ family, phones, onTree }: { family: AdminFamily | undefined; /** The adults' phones joined by userId (`adultPhones`). */ phones?: Array<{ userId: string; phone: PhoneRow | null }>; /** Opens the family's tree, read only ("עץ המשפחה ›"). */ onTree?: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const kids = family?.children ?? [];
  const open = (url: string) => { void Linking.openURL(url).catch(() => {}); };
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: k.line, paddingTop: 8, gap: 8 }}>
      <Txt bold>{t('admin.members.family')}</Txt>
      {(family?.adults ?? []).map(a => {
        const p = phones?.find(x => x.userId === a.userId)?.phone ?? null;
        return (
          <View key={a.userId} style={{ minHeight: 32, justifyContent: 'center', gap: 4 }}>
            <Txt bold>{a.displayName}</Txt>
            {phones ? (
              p ? (
                <>
                  <Txt bold style={{ writingDirection: 'ltr', textAlign: 'left', fontVariant: ['tabular-nums'] }}>{p.display}</Txt>
                  <Txt size="small" color={k.muted}>{t(p.list === 'all' ? 'admin.members.phone.listAll' : 'admin.members.phone.listGabbaim')}</Txt>
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    <View style={{ flex: 1, minWidth: 120 }}><Button kind="secondary" title={t('phoneList.call')} accessibilityLabel={t('phoneList.callA11y', { name: a.displayName })} onPress={() => open(p.tel)} /></View>
                    <View style={{ flex: 1, minWidth: 120 }}><Button kind="secondary" title={t('phoneList.whatsapp')} accessibilityLabel={t('phoneList.whatsappA11y', { name: a.displayName })} onPress={() => open(p.wa)} /></View>
                  </View>
                </>
              ) : <Txt size="small" color={k.muted}>{t('admin.members.phone.none')}</Txt>
            ) : null}
          </View>
        );
      })}
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
