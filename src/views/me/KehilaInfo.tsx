import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useSession } from '../../client/SessionProvider.tsx';
import { config } from '../../config.ts';
import { textStart } from '../../i18n/direction.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Sheet, Tag, Txt, useTokens } from '../../kit/components.tsx';
import { TOUCH } from '../../kit/theme.ts';
import { ForwardIcon } from '../../kit/Icon.tsx';

/** A tappable row: the label at the start, an arrow at the end (‹ / › by direction, ↗ for the browser). */
export function LinkRow({ label, onPress, external = false }: { label: string; onPress: () => void; external?: boolean }) {
  const { dir } = useI18n();
  const k = useTokens();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPress}
      style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Txt style={{ flex: 1 }}>{label}</Txt>
      {external ? <Txt bold color={k.tekhelet}>↗</Txt> : <ForwardIcon color={k.tekhelet} />}
    </Pressable>
  );
}

/** Opens a public page of the web site in the browser. */
export const openWebPage = (path: 'privacy' | 'terms') => { void Linking.openURL(`${config.webUrl}/${path}/`).catch(() => {}); };

/** P13: the Kehila name as title; my role, the privacy contact, who is responsible, policy and terms. Every role. */
export function KehilaInfo({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { state } = useSession();
  const kehila = state.kehila;
  if (!kehila) return null;
  const contact = kehila.privacyContact.trim();
  return (
    <Sheet visible={visible} title={kehila.name} onClose={onClose}>
      <View style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt size="small" color={k.muted} style={{ flex: 1 }}>{t('kehilaInfo.role')}</Txt>
        <Tag label={t(`switcher.role.${kehila.role}`)} tone={kehila.role === 'listener' ? 'plain' : 'strong'} />
      </View>
      <View style={{ gap: 2 }}>
        <Txt size="small" color={k.muted}>{t('kehilaInfo.contact')}</Txt>
        {contact ? <Txt bold style={{ textAlign: textStart(lang) }}>{contact}</Txt> : <Txt color={k.muted}>{t('privacy.contactNone')}</Txt>}
      </View>
      <Txt size="small">{t('kehilaInfo.roles')}</Txt>
      <LinkRow external label={t('privacy.policy')} onPress={() => openWebPage('privacy')} />
      <LinkRow external label={t('kehilaInfo.terms')} onPress={() => openWebPage('terms')} />
    </Sheet>
  );
}
