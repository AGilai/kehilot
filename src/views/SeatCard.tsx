import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Button, Card, Tag, Txt, useTokens } from '../kit/components.tsx';
import { Icon } from '../kit/Icon.tsx';
import { TOUCH } from '../kit/theme.ts';

export type SeatCardState = 'ask' | 'done' | 'byGabbai';

/** P24: the Home reminder card (UX-DESIGN §15.2). `ask` is the question; `done`/`byGabbai` is the collapsed answer until the deadline. */
export function SeatCard({ count, state, deadline, preview = true, onYes, onUpdate }: { count: number; state: SeatCardState; deadline: { day: string; time: string }; preview?: boolean; onYes: () => void; onUpdate: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  if (state !== 'ask') {
    return (
      <Card edgeColor={k.olive} style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <Icon name="check" size={20} color={k.olive} />
            <Txt bold accessibilityRole="header" style={{ flexShrink: 1 }}>{t('seats.title')}</Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {preview ? <Tag tone="preview" label={t('seats.preview')} /> : null}
            <Pressable accessibilityRole="button" onPress={onUpdate} style={{ minHeight: TOUCH, minWidth: TOUCH, justifyContent: 'center', alignItems: 'center' }}>
              <Txt bold color={k.tekhelet}>{t('seats.card.change')}</Txt>
            </Pressable>
          </View>
        </View>
        <Txt size="small">{state === 'byGabbai' ? t('seats.card.byGabbai') : t('seats.card.doneAll', { n: count })}</Txt>
      </Card>
    );
  }
  const one = count === 1;
  return (
    <Card edgeColor={k.tekhelet}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Txt bold size="heading" accessibilityRole="header">{t('seats.title')}</Txt>
        {preview ? <Tag tone="preview" label={t('seats.preview')} /> : null}
      </View>
      <Txt>{one ? t('seats.card.questionOne') : t('seats.card.questionOther', { n: count })}</Txt>
      <Txt size="small" color={k.muted}>{t('seats.card.deadline', { day: deadline.day, time: deadline.time })}</Txt>
      <Button title={one ? t('seats.card.yesOne') : t('seats.card.yesOther')} onPress={onYes} />
      <Button kind="secondary" title={t('seats.card.update')} onPress={onUpdate} />
    </Card>
  );
}
