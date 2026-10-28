import React from 'react';
import { Pressable, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Button, Txt, useTokens } from '../../kit/components.tsx';
import { TOUCH } from '../../kit/theme.ts';
import { Figure } from '../../tree/Figure.tsx';
import { COVER_COLORS, HAIR, SKIN } from '../../tree/figures/parts.ts';
import { resolveFigure, stageOf } from '../../tree/figures/figure.ts';
import type { AgeStage } from '../../tree/figures/figure.ts';
import type { FigureOptions, Person } from '../../tree/types.ts';

type Rows = 'covering' | 'cover' | 'kippah' | 'beard' | 'skin' | 'hair' | 'glasses';
const isoToday = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
const YOUNG: AgeStage[] = ['baby', 'toddler', 'child', 'preteen', 'teen'];
const HAIR_KEYS = ['brown', 'black', 'auburn', 'blond', 'grey', 'white'] as const;
const COVER_KEYS = ['teal', 'coral', 'blue', 'rose', 'olive', 'purple'] as const;
const SKIN_KEYS = ['light', 'medium', 'tan'] as const;

/** At most five rows (§17.13 P35): women head covering (+ its colour), skin, hair, glasses; men kippah, beard, skin, hair, glasses;
 *  children skin, hair, glasses (the figure grows by itself). */
export function rowsFor(person: Pick<Person, 'gender' | 'relation' | 'birth'>, today = isoToday()): Rows[] {
  const stage = stageOf(person.birth, person.relation, today, person.gender);
  if (YOUNG.includes(stage)) return ['skin', 'hair', 'glasses'];
  return person.gender === 'f' ? ['covering', 'cover', 'skin', 'hair', 'glasses'] : ['kippah', 'beard', 'skin', 'hair', 'glasses'];
}

function Radio({ label, selected, onPress, swatch, testID }: { label: string; selected: boolean; onPress: () => void; swatch?: string; testID?: string }) {
  const k = useTokens();
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label} onPress={onPress}
      style={{ minHeight: 44, minWidth: swatch ? 44 : 64, paddingHorizontal: swatch ? 0 : 14, borderRadius: swatch ? 22 : 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: selected ? 2 : 1, borderColor: selected ? k.tekhelet : k.line, backgroundColor: selected ? k.stone : k.surface }}>
      {swatch ? <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: swatch, alignItems: 'center', justifyContent: 'center' }}>{selected ? <Txt bold color="#FFFFFF" style={{ fontSize: 14, lineHeight: 18 }}>✓</Txt> : null}</View>
        : <Txt size="small" bold={selected} color={selected ? k.tekhelet : k.ink}>{selected ? `✓ ${label}` : label}</Txt>}
    </Pressable>
  );
}

/**
 * "הדמות שלי" (P35): a live preview (sheet header size and tree tile size) and the option rows. Only what the person changed is
 * stored; "חזרה לברירת המחדל" clears the choice. `onSave(undefined)` = the default.
 */
export function FigurePicker({ person, onSave }: { person: Person; onSave: (figure: FigureOptions | undefined) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const [own, setOwn] = React.useState<FigureOptions | undefined>(person.figure);
  const rows = rowsFor(person);
  const stage = stageOf(person.birth, person.relation, isoToday(), person.gender);
  const shown = resolveFigure(person.relation, person.gender, stage, own);
  const preview: Person = { ...person, figure: own };
  const set = (patch: Partial<FigureOptions>) => setOwn(o => ({ ...(o ?? {}), ...patch }));
  const row = (key: Rows, title: string, children: React.ReactNode) => (
    <View key={key} accessibilityRole="radiogroup" accessibilityLabel={title} style={{ gap: 6 }}>
      <Txt size="small" bold>{title}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
  const kind = (kindKey: 'covering' | 'kippah' | 'beard', values: readonly string[]) => values.map(v => (
    <Radio key={v} testID={`fig-${kindKey}-${v}`} label={t(`tree.fig.${kindKey}.${v}`)} selected={(shown as Record<string, unknown>)[kindKey] === v} onPress={() => set({ [kindKey]: v } as Partial<FigureOptions>)} />
  ));
  const body: Record<Rows, () => React.ReactNode> = {
    covering: () => row('covering', t('tree.fig.covering.title'), kind('covering', ['tichel', 'hat', 'wig', 'none'])),
    cover: () => (shown.headCovering === 'tichel' ? row('cover', t('tree.fig.cover'), COVER_COLORS.map((c, i) => (
      <Radio key={c} testID={`fig-cover-${i}`} label={t(`tree.fig.coverColor.${COVER_KEYS[i]}`)} swatch={c} selected={shown.coverColor === c} onPress={() => set({ coverColor: c })} />
    ))) : null),
    kippah: () => row('kippah', t('tree.fig.kippah.title'), kind('kippah', ['knitted', 'small', 'velvet', 'none'])),
    beard: () => row('beard', t('tree.fig.beard.title'), kind('beard', ['none', 'short', 'full'])),
    skin: () => row('skin', t('tree.fig.skin'), SKIN.map((s, i) => <Radio key={i} testID={`fig-skin-${i}`} label={t(`tree.fig.skinTone.${SKIN_KEYS[i]}`)} swatch={s.face} selected={(shown.skin ?? 1) === i} onPress={() => set({ skin: i as 0 | 1 | 2 })} />)),
    hair: () => row('hair', t('tree.fig.hair'), HAIR_KEYS.map(h => <Radio key={h} testID={`fig-hair-${h}`} label={t(`tree.fig.hairColor.${h}`)} swatch={HAIR[h]} selected={shown.hair?.toUpperCase() === HAIR[h].toUpperCase()} onPress={() => set({ hair: HAIR[h] })} />)),
    glasses: () => row('glasses', t('tree.fig.glasses.title'), [false, true].map(g => <Radio key={String(g)} testID={`fig-glasses-${g}`} label={t(g ? 'tree.fig.glasses.yes' : 'tree.fig.glasses.no')} selected={!!shown.glasses === g} onPress={() => set({ glasses: g })} />)),
  };
  return (
    <View style={{ gap: 14 }} testID="figure-picker">
      <View accessibilityLabel={t('tree.fig.preview')} style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 24, backgroundColor: k.surface, borderRadius: 14, borderWidth: 1, borderColor: k.line, paddingVertical: 14 }}>
        <Figure person={preview} size={150} style="A" />
        <Figure person={preview} size={64} style="B" />
      </View>
      {YOUNG.includes(stage) ? <Txt size="small" color={k.muted}>{t('tree.fig.grows')}</Txt> : null}
      {rows.map(r => body[r]())}
      <View style={{ gap: 8 }}>
        <Button title={t('tree.fig.apply')} onPress={() => onSave(own && Object.keys(own).length ? own : undefined)} />
        <Pressable accessibilityRole="button" onPress={() => setOwn(undefined)} style={{ minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' }}>
          <Txt bold color={k.tekhelet}>{t('tree.fig.reset')}</Txt>
        </Pressable>
      </View>
    </View>
  );
}
