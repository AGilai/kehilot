import React from 'react';
import { View } from 'react-native';
import { formatPhone } from '../../client/phone.ts';
import { initials, listState, myTreeName } from '../../client/meView.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import { textStart } from '../../i18n/direction.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Button, Card, Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import { meLayout } from '../../client/meMap.ts';
import { TagChips } from '../TagChips.tsx';
import { useFamilyLine } from '../useFamilyLine.ts';

/**
 * §18.5 DetailsCard (P41): the profile header, a read-only label/value list, the family line and ONE button to the tree.
 * It has no edit controls. A listener sees name and role only.
 */
export function DetailsCard({ onTree }: { onTree?: () => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { state } = useSession();
  const kehila = state.kehila;
  const profile = state.me?.profile;
  const layout = meLayout(kehila?.role);
  const { doc, line } = useFamilyLine(kehila?.kehilaId, layout.card.tree);
  if (!profile || !kehila) return null;
  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const tree = doc ? myTreeName(doc.people) : null;
  const inList = listState(profile.phone, kehila.showPhone);
  const lineColor = line?.tone === 'request' ? k.pomegranate : line?.tone === 'missing' ? k.gold : k.muted;
  const missingText = tree?.missing.map(m => t(m === 'father' ? 'tree.name.missFather' : m === 'mother' ? 'tree.name.missMother' : 'tree.name.missFirst')).join(' · ');
  const row = (label: string, value: React.ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 16 }}>
      <Txt size="small" color={k.muted} style={{ flexShrink: 0 }}>{label}</Txt>
      <View style={{ flex: 1 }}>{value}</View>
    </View>
  );
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View accessibilityElementsHidden style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: k.tekhelet, alignItems: 'center', justifyContent: 'center' }}>
          <Txt serif size="title" color={k.onAction} style={{ textAlign: 'center' }}>{initials(profile.firstName, profile.lastName ?? '')}</Txt>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt serif size="title" accessibilityRole="header" content>{name}</Txt>
          <Txt size="small" color={k.muted}>{t(`me.details.role.${kehila.role}`)}</Txt>
        </View>
      </View>
      {kehila.tags.length > 0 ? <TagChips tags={kehila.tags} /> : null}
      {layout.card.phone ? (
        <View style={{ gap: 4, borderTopWidth: 1, borderTopColor: k.line, paddingTop: 10 }}>
          {row(t('me.details.phone'), profile.phone
            ? <Txt size="small" bold style={{ writingDirection: 'ltr', textAlign: textStart(lang), fontVariant: ['tabular-nums'] }}>{formatPhone(profile.phone)}</Txt>
            : <Txt size="small" color={k.muted}>{t('me.details.none')}</Txt>)}
          {row(t('me.details.inList'), <Txt size="small" bold>{inList ? t(`me.details.${inList}`) : '—'}</Txt>)}
          {tree ? row(t(tree.label === 'aliyah' ? 'me.details.aliyah' : 'me.details.mi'), (
            <View>
              {tree.text ? <Txt serif content style={{ fontSize: 15 }}>{tree.text}</Txt> : null}
              {missingText ? <Txt size="small" bold color={k.gold}>{missingText}</Txt> : null}
            </View>
          )) : null}
        </View>
      ) : null}
      {layout.card.tree ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: k.line, paddingTop: 10 }} testID="me-family-line">
            <Icon name="tree" size={24} color={k.tekhelet} />
            <View style={{ flex: 1 }}>
              <Txt size="small" bold>{t('me.details.family')}</Txt>
              {line ? <Txt size="small" bold={line.tone !== 'muted'} color={lineColor}>{line.text}</Txt> : null}
            </View>
            {line && line.tone !== 'muted' ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: lineColor }} /> : null}
          </View>
          {onTree ? <Button kind="secondary" icon="tree" title={t('me.details.toTree')} onPress={onTree} /> : null}
        </>
      ) : null}
    </Card>
  );
}
