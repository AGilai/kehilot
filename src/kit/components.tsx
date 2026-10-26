import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Heebo_400Regular, Heebo_700Bold } from '@expo-google-fonts/heebo';
import { NotoSerifHebrew_700Bold } from '@expo-google-fonts/noto-serif-hebrew';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { textStart } from '../i18n/direction.ts';
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

export function Txt({ children, size = 'body', bold, serif, color, style, ...rest }: { children?: React.ReactNode; size?: keyof typeof type; bold?: boolean; serif?: boolean; color?: string; style?: StyleProp<TextStyle>; numberOfLines?: number; accessibilityRole?: 'header' | 'alert' | 'text' }) {
  const { lang, dir } = useI18n();
  const k = useTokens();
  const family = serif ? fonts.title : bold ? fonts.uiBold : fonts.ui;
  return (
    <Text {...rest} style={[{ color: color ?? k.ink, fontSize: type[size], lineHeight: Math.round(type[size] * 1.5), fontFamily: family, writingDirection: dir, textAlign: textStart(lang) }, style]}>
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

export function Button({ title, onPress, kind = 'primary', busy, disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean }) {
  const k = useTokens();
  const bg = kind === 'primary' ? k.tekhelet : kind === 'danger' ? k.danger : 'transparent';
  const fg = kind === 'secondary' ? k.tekhelet : k.onAction;
  const off = !!(busy || disabled);
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: off, busy }} disabled={off} onPress={onPress}
      style={({ pressed }) => [{ minHeight: TOUCH, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, borderWidth: kind === 'secondary' ? 1.5 : 0, borderColor: k.tekhelet, opacity: off || pressed ? 0.6 : 1 }]}>
      {busy ? <ActivityIndicator color={fg} /> : <Txt bold color={fg} style={{ textAlign: 'center' }}>{title}</Txt>}
    </Pressable>
  );
}

/** Text field with a code-point counter (`[...s].length`, matching the server). */
export function Field({ label, value, onChangeText, maxCodePoints, error, ...rest }: TextInputProps & { label: string; value: string; onChangeText: (v: string) => void; maxCodePoints?: number; error?: string | null }) {
  const { lang, dir, t } = useI18n();
  const k = useTokens();
  const n = [...value].length;
  const over = maxCodePoints !== undefined && n > maxCodePoints;
  return (
    <View style={{ gap: 6 }}>
      <Txt size="small" bold>{label}</Txt>
      <TextInput {...rest} accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholderTextColor={k.muted}
        style={[{ minHeight: TOUCH, borderWidth: 1, borderRadius: 10, borderColor: over || error ? k.danger : k.line, backgroundColor: k.surface, paddingHorizontal: 12, color: k.ink, fontSize: type.body, fontFamily: fonts.ui, writingDirection: dir, textAlign: textStart(lang) }, rest.multiline ? { paddingVertical: 10, minHeight: 120, textAlignVertical: 'top' } : null]} />
      {maxCodePoints !== undefined ? <Txt size="caption" color={over ? k.danger : k.muted}>{t('field.counter', { n, max: maxCodePoints })}</Txt> : null}
      {error ? <Txt size="small" color={k.danger} accessibilityRole="alert">{error}</Txt> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const k = useTokens();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={{ minHeight: TOUCH, paddingHorizontal: 16, borderRadius: 24, justifyContent: 'center', borderWidth: 1.5, borderColor: selected ? k.tekhelet : k.line, backgroundColor: selected ? k.tekhelet : k.surface }}>
      <Txt size="small" bold color={selected ? k.onAction : k.ink}>{label}</Txt>
    </Pressable>
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

export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const { t, dir } = useI18n();
  const k = useTokens();
  // A native Modal does not inherit the root View's direction, so set it again here.
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel={t('common.close')} onPress={onClose} style={{ flex: 1, direction: dir, backgroundColor: 'rgba(21,26,51,0.5)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: k.stone, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 12, maxHeight: '85%' }}>
          <Txt serif size="title" accessibilityRole="header">{title}</Txt>
          <ScrollView contentContainerStyle={{ gap: 12 }}>{children}</ScrollView>
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
