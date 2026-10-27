// A centred dialog for the desktop editor (the kit's Sheet is a bottom sheet for phones). Escape closes it; `edge` draws the gold edge of alerts.
import React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useModalOpen } from '../../../client/reportUi.ts';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Txt, useTokens } from '../../../kit/components.tsx';

export function Dialog({ visible, title, onClose, children, footer, width = 560, alert }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number; alert?: boolean }) {
  const { t, dir } = useI18n();
  const k = useTokens();
  useModalOpen(visible);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel={t('common.close')} onPress={onClose} style={{ flex: 1, direction: dir, backgroundColor: 'rgba(21,26,51,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Pressable onPress={() => {}} accessibilityRole={alert ? 'alert' : undefined} {...({ role: alert ? 'alertdialog' : 'dialog', 'aria-modal': true, 'aria-label': title } as object)}
          style={{ width: '100%', maxWidth: width, maxHeight: '90%', backgroundColor: k.surface, borderRadius: 16, borderWidth: 1, borderColor: alert ? k.gold : k.line, borderStartWidth: alert ? 6 : 1, padding: 20, gap: 12 }}>
          <Txt serif size="title" accessibilityRole="header">{title}</Txt>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer ? <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{footer}</View> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
