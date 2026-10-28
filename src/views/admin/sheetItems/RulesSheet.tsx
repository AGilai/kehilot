// Sheet "כללים" (UX-DESIGN §19.3, P44 phone 2): what members post goes on the sheet after a gabbai's tap, or at once. Saves on every tap.
import { View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Sheet, Txt, useTokens } from '../../../kit/components.tsx';
import { Choice } from '../shared.tsx';

export function RulesSheet({ visible, value, onPick, onClose }: { visible: boolean; value: 'approve' | 'auto'; onPick: (v: 'approve' | 'auto') => void; onClose: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <Sheet visible={visible} title={t('sheetItems.rule.members')} onClose={onClose}>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        <Choice label={t('sheetItems.rule.approve')} note={t('sheetItems.rule.approveNote')} selected={value === 'approve'} onPress={() => onPick('approve')} />
        <Choice label={t('sheetItems.rule.auto')} note={t('sheetItems.rule.autoNote')} selected={value === 'auto'} onPress={() => onPick('auto')} />
      </View>
    </Sheet>
  );
}
