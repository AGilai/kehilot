import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Heebo_400Regular, Heebo_700Bold } from '@expo-google-fonts/heebo';
import { NotoSerifHebrew_700Bold } from '@expo-google-fonts/noto-serif-hebrew';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { contentDir, textStart } from '../i18n/direction.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import { TOUCH, fonts, tokens, type } from './theme.ts';
import type { Tokens } from './theme.ts';

/** Fonts load once, at the app root. */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({ Heebo_400Regular, Heebo_700Bold, NotoSerifHebrew_700Bold });
  return loaded || !!error;
}

export function useTokens(): Tokens {
  return tokens(useColorScheme() === 'dark' ? 'dark' : 'light');
}

/** `content`: user text (message, name); its direction and alignment follow its first strong letter, not the UI language. */
export function Txt({ children, size = 'body', bold, serif, color, content, style, ...rest }: { children?: React.ReactNode; size?: keyof typeof type; bold?: boolean; serif?: boolean; color?: string; content?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number; accessibilityRole?: 'header' | 'alert' | 'text'; accessibilityLiveRegion?: 'polite' | 'assertive' }) {
  const { lang, dir } = useI18n();
  const k = useTokens();
  const family = serif ? fonts.title : bold ? fonts.uiBold : fonts.ui;
  const d = content && typeof children === 'string' ? contentDir(children, dir) : dir;
  return (
    <Text {...rest} style={[{ color: color ?? k.ink, fontSize: type[size], lineHeight: Math.round(type[size] * 1.5), fontFamily: family, writingDirection: d, textAlign: d === dir ? textStart(lang) : d === 'rtl' ? 'right' : 'left' }, style]}>
      {children}
    </Text>
  );
}

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const k = useTokens();
  const inner = { padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' } as const;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: k.stone }}>
      {scroll ? <ScrollView contentContainerStyle={inner}>{children}</ScrollView> : <View style={[{ flex: 1 }, inner]}>{children}</View>}
    </SafeAreaView>
  );
}

export function Card({ children, edgeColor, style }: { children: React.ReactNode; edgeColor?: string; style?: StyleProp<ViewStyle> }) {
  const k = useTokens();
  return (
    <View style={[{ backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, padding: 16, gap: 8 }, edgeColor ? { borderStartWidth: 6, borderStartColor: edgeColor } : null, style]}>
      {children}
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', busy, disabled, accessibilityLabel, icon }: { icon?: IconName; title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean; accessibilityLabel?: string }) {
  const k = useTokens();
  const bg = kind === 'primary' ? k.tekhelet : kind === 'danger' ? k.danger : 'transparent';
  const fg = kind === 'secondary' ? k.tekhelet : k.onAction;
  const off = !!(busy || disabled);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
      style={({ pressed }) => [{ minHeight: TOUCH, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: kind === 'secondary' ? 1.5 : 0, borderColor: k.tekhelet, opacity: off || pressed ? 0.6 : 1 }]}>
      {busy ? <ActivityIndicator color={fg} /> : icon ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name={icon} size={18} color={fg} /><Txt bold color={fg} style={{ textAlign: 'center' }}>{title}</Txt></View>
      ) : <Txt bold color={fg} style={{ textAlign: 'center' }}>{title}</Txt>}
    </Pressable>
  );
}

/** Text field with a code-point counter (`[...s].length`, matching the server). */
export function Field({ label, value, onChangeText, maxCodePoints, error, ltr, ...rest }: TextInputProps & { label: string; value: string; onChangeText: (v: string) => void; maxCodePoints?: number; error?: string | null; /** Typed left to right (numbers, even in Hebrew); still aligned to the logical start. */ ltr?: boolean }) {
  const { lang, dir, t } = useI18n();
  const k = useTokens();
  const n = [...value].length;
  const over = maxCodePoints !== undefined && n > maxCodePoints;
  return (
    <View style={{ gap: 6 }}>
      <Txt size="small" bold>{label}</Txt>
      <TextInput {...rest} accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholderTextColor={k.muted}
        style={[{ minHeight: TOUCH, borderWidth: 1, borderRadius: 10, borderColor: over || error ? k.danger : k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: type.body, fontFamily: fonts.ui, writingDirection: ltr ? 'ltr' : dir, textAlign: textStart(lang) }, rest.multiline ? { paddingVertical: 10, minHeight: 120, textAlignVertical: 'top' } : null]} />
      {maxCodePoints !== undefined ? <Txt size="caption" color={over ? k.danger : k.muted}>{t('field.counter', { n, max: maxCodePoints })}</Txt> : null}
      {error ? <Txt size="small" color={k.danger} accessibilityRole="alert">{error}</Txt> : null}
    </View>
  );
}

/**
 * `size="filter"`: the small pill for filter rows and pickers (selected = ink, tekhelet stays the action colour).
 * `multi` makes it one of several that can be on: a checkbox, with a dot in `dot` colour when off and a check when on.
 */
export function Chip({ label, selected, onPress, size = 'regular', icon, multi, dot }: { label: string; selected?: boolean; onPress?: () => void; size?: 'regular' | 'filter'; icon?: IconName; multi?: boolean; dot?: string }) {
  const k = useTokens();
  if (size === 'filter') {
    const fg = selected ? k.stone : k.ink;
    return (
      <Pressable accessibilityRole={multi ? 'checkbox' : 'button'} accessibilityState={multi ? { checked: !!selected } : { selected: !!selected }} onPress={onPress} hitSlop={{ top: 6, bottom: 6 }}
        style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: selected ? k.ink : k.line, backgroundColor: selected ? k.ink : k.surface }}>
        {multi ? (selected ? <Icon name="check" size={16} color={fg} /> : dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null) : icon ? <Icon name={icon} size={16} color={fg} /> : null}
        <Txt size="small" bold color={fg}>{label}</Txt>
      </Pressable>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={{ minHeight: TOUCH, paddingHorizontal: 16, borderRadius: 24, justifyContent: 'center', borderWidth: 1.5, borderColor: selected ? k.tekhelet : k.line, backgroundColor: selected ? k.tekhelet : k.surface }}>
      <Txt size="small" bold color={selected ? k.onAction : k.ink}>{label}</Txt>
    </Pressable>
  );
}

/** Two or three exclusive choices in one track ("mine / everything"). */
export function Segmented<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (key: K) => void }) {
  const k = useTokens();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', minHeight: TOUCH, padding: 4, gap: 4, borderRadius: 12, backgroundColor: k.stone, borderWidth: 1, borderColor: k.line }}>
      {options.map(o => {
        const selected = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(o.key)}
            style={{ flex: 1, minHeight: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? k.surface : 'transparent', borderWidth: 1, borderColor: selected ? k.tekhelet : 'transparent' }}>
            <Txt size="small" bold color={selected ? k.tekhelet : k.muted} style={{ textAlign: 'center' }}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Switch row. `offNote` explains what the off state means and shows while it is off. */
export function Toggle({ label, value, onChange, offNote }: { label: string; value: boolean; onChange: (v: boolean) => void; offNote?: string }) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <View style={{ gap: 4 }}>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label} onPress={() => onChange(!value)}
        style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Txt style={{ flex: 1 }}>{label}</Txt>
        <View style={{ minWidth: 56, minHeight: 32, paddingHorizontal: 10, borderRadius: 16, justifyContent: 'center', backgroundColor: value ? k.olive : k.line }}>
          <Txt size="caption" bold color={value ? k.onAction : k.ink} style={{ textAlign: 'center' }}>{value ? t('toggle.on') : t('toggle.off')}</Txt>
        </View>
      </Pressable>
      {!value && offNote ? <Txt size="small" color={k.muted}>{offNote}</Txt> : null}
    </View>
  );
}

export function Banner({ text, tone = 'info', action }: { text: string; tone?: 'info' | 'error' | 'success'; action?: { title: string; onPress: () => void } }) {
  const k = useTokens();
  const c = tone === 'error' ? k.danger : tone === 'success' ? k.olive : k.tekhelet;
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : undefined} style={{ borderRadius: 10, borderWidth: 1, borderColor: c, borderStartWidth: 6, backgroundColor: k.surface, padding: 12, gap: 8 }}>
      <Txt size="small">{text}</Txt>
      {action ? <Button kind="secondary" title={action.title} onPress={action.onPress} /> : null}
    </View>
  );
}

/** Small read-only label (role, classification, group). */
export function Tag({ label, tone = 'plain' }: { label: string; tone?: 'plain' | 'strong' }) {
  const k = useTokens();
  return (
    <View style={{ paddingHorizontal: 10, minHeight: 24, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: tone === 'strong' ? k.tekhelet : k.line, backgroundColor: k.stone }}>
      <Txt size="caption" bold color={tone === 'strong' ? k.tekhelet : k.muted}>{label}</Txt>
    </View>
  );
}

/** Checkbox row; `note` explains the consequence under it. */
export function Check({ label, value, onChange, note, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; note?: string; disabled?: boolean }) {
  const k = useTokens();
  return (
    <View style={{ gap: 4, opacity: disabled ? 0.6 : 1 }}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value, disabled: !!disabled }} accessibilityLabel={label} disabled={disabled} onPress={() => onChange(!value)}
        style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 24, height: 24, marginTop: 12, borderRadius: 6, borderWidth: 2, borderColor: value ? k.tekhelet : k.muted, backgroundColor: value ? k.tekhelet : k.surface, alignItems: 'center', justifyContent: 'center' }}>
          {value ? <Text style={{ color: k.onAction, fontSize: 15, lineHeight: 20, fontFamily: fonts.uiBold }}>✓</Text> : null}
        </View>
        <Txt style={{ flex: 1, paddingTop: 12 }}>{label}</Txt>
      </Pressable>
      {note ? <Txt size="small" color={k.muted}>{note}</Txt> : null}
    </View>
  );
}

export type PickRow = { id: string; title: string; subtitle?: string };

/** Search box over a short list of rows; one can be selected. Shows at most `max` rows. */
export function PickList({ query, onQuery, placeholder, rows, selected, onSelect, empty, state, errorText, max = 8, disabled, hint }: {
  query: string; onQuery: (q: string) => void; placeholder: string; rows: PickRow[]; selected: string | null; onSelect: (id: string) => void;
  empty: string; state: 'loading' | 'error' | 'ready'; errorText?: string; max?: number; disabled?: boolean; /** Shown between the input and the rows. */ hint?: React.ReactNode;
}) {
  const { lang, dir } = useI18n();
  const k = useTokens();
  return (
    <View style={{ gap: 8 }}>
      <TextInput accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={k.muted} value={query} onChangeText={onQuery}
        style={{ minHeight: TOUCH, borderWidth: 1, borderRadius: 10, borderColor: k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: type.body, fontFamily: fonts.ui, writingDirection: dir, textAlign: textStart(lang) }} />
      {hint}
      {state === 'loading' ? <ActivityIndicator color={k.tekhelet} /> : null}
      {state === 'error' && errorText ? <Banner tone="error" text={errorText} /> : null}
      {state === 'ready' && rows.length === 0 ? <Txt size="small" color={k.muted}>{empty}</Txt> : null}
      <View style={{ gap: 6 }}>
        {state === 'ready' ? rows.slice(0, max).map(r => {
          const on = selected === r.id;
          return (
            <Pressable key={r.id} accessibilityRole="button" accessibilityState={{ selected: on }} disabled={disabled} onPress={() => onSelect(r.id)}
              style={{ minHeight: TOUCH, paddingHorizontal: 14, paddingVertical: 4, justifyContent: 'center', borderRadius: 10, borderWidth: on ? 2 : 1, borderColor: on ? k.tekhelet : k.line, backgroundColor: k.surface }}>
              <Txt bold={on}>{on ? '✓ ' : ''}{r.title}</Txt>
              {r.subtitle ? <Txt size="small" color={k.muted}>{r.subtitle}</Txt> : null}
            </Pressable>
          );
        }) : null}
      </View>
    </View>
  );
}

/** `footer`: actions pinned below the scroll area, above Close. */
export function Sheet({ visible, title, onClose, children, footer }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const { t, dir } = useI18n();
  const k = useTokens();
  // A native Modal does not inherit the root View's direction, so set it again here.
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel={t('common.close')} onPress={onClose} style={{ flex: 1, direction: dir, backgroundColor: 'rgba(21,26,51,0.5)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: k.stone, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 12, maxHeight: '85%' }}>
          <Txt serif size="title" accessibilityRole="header">{title}</Txt>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12 }}>{children}</ScrollView>
          {footer ? <View style={{ gap: 8 }}>{footer}</View> : null}
          <Button kind="secondary" title={t('common.close')} onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function Toast({ text, visible }: { text: string; visible: boolean }) {
  const k = useTokens();
  if (!visible) return null;
  return (
    <View pointerEvents="none" accessibilityRole="alert" accessibilityLiveRegion="polite"
      style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', alignItems: 'center', padding: 24 }]}>
      <View style={{ backgroundColor: k.band, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, maxWidth: 520 }}>
        <Txt size="small" color="#FFFFFF">{text}</Txt>
      </View>
    </View>
  );
}
