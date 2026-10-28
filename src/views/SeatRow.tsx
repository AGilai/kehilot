import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Card, Txt, useTokens } from '../kit/components.tsx';
import { ForwardIcon, Icon } from '../kit/Icon.tsx';
import { rowStatus } from '../seats/homeText.ts';
import type { rowModel } from '../seats/wire.ts';

/** P47: the quiet bottom row of Home, all week (UX §21.2). It never asks the question; the whole row opens the seat page. */
export function SeatRow({ model, shabbat, onOpen }: { model: NonNullable<ReturnType<typeof rowModel>>; shabbat: string; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const title = t('seats.row.title', { shabbat });
  const status = rowStatus(model, t, lang);
  const icon = model.state === 'open' ? { name: 'chair', color: k.tekhelet } : model.state === 'closed' ? { name: 'lock', color: k.muted }
    : model.state === 'none' ? { name: 'chair', color: k.muted } : { name: 'check', color: k.olive };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${status}`} disabled={!model.pressable} onPress={onOpen}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10 }}>
        <Icon name={icon.name as 'chair'} size={24} color={icon.color} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt bold size="body" numberOfLines={1}>{title}</Txt>
          <Txt size="small" color={k.muted} numberOfLines={2}>{status}</Txt>
        </View>
        {model.state === 'none' ? null : <ForwardIcon color={k.muted} />}
      </Card>
    </Pressable>
  );
}
