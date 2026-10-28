import React from 'react';
import { Pressable, View } from 'react-native';
import { Figure } from '../../tree/Figure.tsx';
import type { Person } from '../../tree/types.ts';
import { Icon } from '../../kit/Icon.tsx';
import { Tag, Txt, useTokens } from '../../kit/components.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';

/** One figure of the tree as a single button: round figure, first name, and at most the gold dot (details missing),
 *  "ז״ל" after the name (the candle badge is drawn inside the figure), "אני". An empty place shows the dashed ghost and a "+" badge. */
export function FigureTile({ tag, person, partner, name, big, size, label, dot, deceased, ill, me, empty, readOnly, selected, ring, box, add, width, onPress, testID }: {
  /** A small Tag under the name ("ממתין לאישור" on the requested partner's place). */ tag?: string;
  person?: Person; partner?: Person; name: string; big?: boolean; size?: number; label: string; dot?: boolean; deceased?: boolean; /** Ill (living): rose "לרפואה" under the name; the heart badge is in the figure. */ ill?: boolean; me?: boolean;
  empty?: boolean; /** Gabbai view: nothing to tap and no "+" on an empty place. */ readOnly?: boolean; selected?: boolean; ring?: boolean; /** A bordered square tile (children grid). */ box?: boolean; /** The dashed "+ child" tile. */ add?: boolean; width?: number;
  onPress: () => void; testID?: string;
}) {
  const k = useTokens();
  const { t } = useI18n();
  const px = size ?? (big ? 64 : 48);
  const art = add ? (
    <View style={{ width: px, height: px, borderRadius: px / 2, backgroundColor: k.stone, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={24} color={k.tekhelet} /></View>
  ) : (
    <View style={ring ? { borderRadius: 999, borderWidth: 2, borderColor: k.tekhelet, padding: 2 } : null}>
      <Figure person={person} partner={partner} size={px} style="B" />
    </View>
  );
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={readOnly && empty}
      style={[{ minWidth: 64, minHeight: box ? 104 : 84, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4 },
        width ? { width } : null,
        box ? (add ? { borderWidth: 1.5, borderStyle: 'dashed', borderColor: k.muted } : { backgroundColor: k.surface, borderWidth: 1, borderColor: k.line }) : null,
        selected ? { borderWidth: 2, borderColor: k.tekhelet, backgroundColor: k.stone } : null]}>
      <View>
        {art}
        {dot ? <View accessible={false} style={{ position: 'absolute', top: 0, start: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: k.gold, borderWidth: 2, borderColor: k.surface }} /> : null}
        {empty && !readOnly ? <View accessible={false} style={{ position: 'absolute', bottom: -4, start: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: k.tekhelet, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={14} color={k.onAction} /></View> : null}
      </View>
      <Txt bold={!empty} size={big ? 'body' : 'small'} color={add ? k.tekhelet : empty ? k.muted : k.ink} content={!empty && !add} style={{ textAlign: 'center' }} numberOfLines={2}>
        {name}{deceased ? <Txt size="caption" color={k.muted}>{` ${t('tree.zl')}`}</Txt> : null}
      </Txt>
      {tag ? <Tag label={tag} /> : null}
      {ill && !deceased ? <Txt size="caption" bold color={k.heal} style={{ lineHeight: 14 }}>{t('tree.ill.badge')}</Txt> : null}
      {me ? <Txt size="caption" bold color={k.tekhelet} style={{ lineHeight: 14 }}>{t('tree.me')}</Txt> : null}
    </Pressable>
  );
}
