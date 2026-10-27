// "שיוך ל…": pick a household for the selected seats, by search, or make a new seat holder without an account (created at save, not before).
import React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { normalizePhone } from '../../../client/phone.ts';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { textStart } from '../../../i18n/direction.ts';
import { Banner, Button, Chip, Txt, useTokens } from '../../../kit/components.tsx';
import { fonts, type } from '../../../kit/theme.ts';
import { filterHouseholds } from '../../../seats/households.ts';
import type { Household } from '../../../seats/households.ts';
import { countText } from './AssignPanel.tsx';
import { Dialog } from './Dialog.tsx';

export function FamilyPicker({ visible, count, rows, onPick, onNew, onClose, startNew }: {
  visible: boolean; count: number; rows: Household[]; onPick: (ref: string) => void; onNew: (name: string, phone?: string) => void; onClose: () => void; startNew?: boolean;
}) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const [query, setQuery] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  React.useEffect(() => { if (visible) { setQuery(''); setAdding(!!startNew); setName(''); setPhone(''); setProblem(null); } }, [visible, startNew]);
  const shown = filterHouseholds(rows, query, 'all').slice(0, 30);
  const input = { minHeight: 44, borderWidth: 1, borderRadius: 10, borderColor: k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: type.body, fontFamily: fonts.ui, writingDirection: dir, textAlign: textStart(lang) } as const;
  const add = () => {
    if (!name.trim()) { setProblem(t('seatMap.picker.nameNeeded')); return; }
    const p = phone.trim() ? normalizePhone(phone.trim()) : null;
    if (phone.trim() && !p) { setProblem(t('seatMap.picker.badPhone')); return; }
    onNew(name.trim(), p ?? undefined);
  };
  return (
    <Dialog visible={visible} title={count ? `${t('seatMap.picker.title')} · ${count}` : t('seatMap.picker.title')} onClose={onClose} width={520}>
      {adding ? (
        <View style={{ gap: 8 }}>
          <Txt bold>{t('seatMap.picker.newHolder')}</Txt>
          <TextInput accessibilityLabel={t('seatMap.picker.name')} placeholder={t('seatMap.picker.name')} placeholderTextColor={k.muted} value={name} onChangeText={setName} maxLength={60} style={input} autoFocus />
          <TextInput accessibilityLabel={t('seatMap.picker.phone')} placeholder={t('seatMap.picker.phone')} placeholderTextColor={k.muted} value={phone} onChangeText={setPhone} style={{ ...input, writingDirection: 'ltr' }} keyboardType="phone-pad" />
          {problem ? <Banner tone="error" text={problem} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={t('seatMap.picker.add')} onPress={add} />
            <Button kind="secondary" title={t('seatMap.save.cancel')} onPress={() => setAdding(false)} />
          </View>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <TextInput accessibilityLabel={t('seatMap.picker.search')} placeholder={t('seatMap.picker.search')} placeholderTextColor={k.muted} value={query} onChangeText={setQuery} style={input} autoFocus />
          <View style={{ alignSelf: 'flex-start' }}><Chip label={`+ ${t('seatMap.picker.newHolder')}`} suggest onPress={() => setAdding(true)} /></View>
          {shown.length === 0 ? <Txt size="small" color={k.muted}>{t('seatMap.picker.none')}</Txt> : null}
          {shown.map((r) => (
            <Pressable key={r.ref} accessibilityRole="button" accessibilityLabel={`${r.full}, ${countText(t, r.count)}`} onPress={() => onPick(r.ref)}
              style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: k.line, backgroundColor: k.surface }}>
              <Txt style={{ flex: 1 }} content>{r.full}</Txt>
              <Txt size="small" color={k.muted}>{countText(t, r.count)}</Txt>
            </Pressable>
          ))}
        </View>
      )}
    </Dialog>
  );
}
