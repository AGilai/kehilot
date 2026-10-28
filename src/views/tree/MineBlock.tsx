import React from 'react';
import { Pressable, View } from 'react-native';
import { NAME_MAX } from '../../auth/validate.ts';
import { formatPhone } from '../../client/phone.ts';
import type { MineDraft, MineError } from '../../client/myDetails.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Card, Field, Toggle, Txt, useTokens } from '../../kit/components.tsx';

/** The draft the block starts from: what the account holds now. */
export const draftOfMine = (m: { first: string; last: string; phone: string | null; showPhone: boolean }): MineDraft =>
  ({ first: m.first, last: m.last, phoneText: m.phone ? formatPhone(m.phone) : '', showPhone: m.showPhone });

/**
 * "הפרטים שלי בקהילה" (P32, my own figure only): the name I have in the app, my number (one for all Kehilot) with "הסרה", and this
 * Kehila's phone-list switch with its helper line. Nothing is sent from here: the sheet's one "שמירה" does it (`saveAll`).
 */
export function MineBlock({ value, onChange, errors, kehilaName, disabled }: { value: MineDraft; onChange: (d: MineDraft) => void; errors: MineError[]; kehilaName: string; disabled?: boolean }) {
  const { t } = useI18n();
  const k = useTokens();
  const hasPhone = value.phoneText.trim() !== '';
  const set = (p: Partial<MineDraft>) => onChange({ ...value, ...p });
  return (
    <View testID="mine-block"><Card>
      <Txt serif size="heading" accessibilityRole="header">{t('tree.mine.title')}</Txt>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field testID="mine-first" label={t('auth.firstNameLabel')} value={value.first} onChangeText={first => set({ first })} maxCodePoints={NAME_MAX} autoComplete="given-name" editable={!disabled}
            error={errors.includes('firstRequired') ? t('tree.mine.firstRequired') : errors.includes('nameLong') ? t('tree.mine.nameLong') : null} />
        </View>
        <View style={{ flex: 1 }}>
          <Field testID="mine-last" label={t('auth.lastNameLabel')} value={value.last} onChangeText={last => set({ last })} maxCodePoints={NAME_MAX} autoComplete="family-name" editable={!disabled} />
        </View>
      </View>
      <Txt size="caption" color={k.muted}>{t('tree.mine.appName')}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field testID="mine-phone" label={t('tree.mine.phone')} value={value.phoneText} onChangeText={phoneText => set({ phoneText })} placeholder={t('tree.mine.phonePh')}
            keyboardType="phone-pad" autoComplete="tel" ltr editable={!disabled} error={errors.includes('phoneInvalid') ? t('me.phone.invalid') : null} />
        </View>
        {hasPhone ? (
          <Pressable testID="mine-phone-remove" accessibilityRole="button" accessibilityLabel={t('me.phone.remove')} disabled={disabled} onPress={() => set({ phoneText: '' })} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 }}>
            <Txt bold color={k.tekhelet}>{t('tree.mine.remove')}</Txt>
          </Pressable>
        ) : null}
      </View>
      {hasPhone ? (
        <View style={{ gap: 2 }}>
          <Toggle label={t('tree.mine.switch', { kehila: kehilaName })} value={value.showPhone} onChange={showPhone => set({ showPhone })} offNote={t('tree.mine.switchOff', { kehila: kehilaName })} />
          {value.showPhone ? <Txt size="small" color={k.muted}>{t('tree.mine.switchOn', { kehila: kehilaName })}</Txt> : null}
        </View>
      ) : null}
    </Card></View>
  );
}
