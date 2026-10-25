import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const C = { bg: '#F7F7F2', paper: '#FFFFFF', ink: '#213D35', muted: '#77857D', green: '#245E4F', pale: '#EAF1ED', gold: '#B08B48', line: '#E7EAE3', red: '#A44141' };
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, direction: 'ltr' },
  content: { padding: 22, paddingBottom: 30, gap: 20, width: '100%', maxWidth: 680, alignSelf: 'center' },
  text: { color: C.ink, fontSize: 16, lineHeight: 25, textAlign: 'right', writingDirection: 'rtl' },
  muted: { color: C.muted, fontSize: 13, lineHeight: 21, textAlign: 'right', writingDirection: 'rtl' },
  title: { color: C.ink, fontSize: 30, lineHeight: 40, fontWeight: '700', textAlign: 'right', writingDirection: 'rtl' },
  heading: { color: C.ink, fontSize: 19, fontWeight: '700', textAlign: 'right', writingDirection: 'rtl' },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  card: { backgroundColor: C.paper, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 20, gap: 14 },
  input: { borderWidth: 1, borderColor: '#DCE2D9', borderRadius: 12, backgroundColor: '#FCFCF9', paddingHorizontal: 14, paddingVertical: 13, color: C.ink, fontSize: 16, textAlign: 'right', minHeight: 50 },
  label: { fontSize: 14, color: C.ink, fontWeight: '600', textAlign: 'right', marginBottom: 7 },
  button: { backgroundColor: C.green, paddingHorizontal: 20, paddingVertical: 15, borderRadius: 13, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16, textAlign: 'center' },
  chip: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 24, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, minHeight: 42 },
  separator: { height: 1, backgroundColor: C.line },
  error: { color: C.red, fontSize: 14, textAlign: 'right', lineHeight: 23, writingDirection: 'rtl' },
});
export function Button({ title, onPress, busy, secondary, disabled }: { title: string; onPress: () => void; busy?: boolean; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!(busy || disabled), busy }} disabled={busy || disabled} onPress={onPress} style={({ pressed }) => [s.button, secondary && { backgroundColor: C.pale }, (pressed || disabled || busy) && { opacity: 0.6 }]}>{busy ? <ActivityIndicator color={secondary ? C.green : '#fff'} /> : <Text style={[s.buttonText, secondary && { color: C.green }]}>{title}</Text>}</Pressable>;
}
export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return <View><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#9BA69E" {...props} style={[s.input, props.style]} />{hint ? <Text style={[s.muted, { marginTop: 5 }]}>{hint}</Text> : null}</View>;
}
export function Choice<T extends string>({ label, labelContent, labelSize, value, options, onChange, disabled = false }: { label: string; labelContent?: React.ReactNode; labelSize?: number; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  return <View><Text style={[s.label, labelSize ? { fontSize: labelSize } : undefined]}>{labelContent ?? label}</Text><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={() => setOpen(true)} style={[s.input, s.between]}><Text style={s.text}>{options.find(o => o.value === value)?.label || 'בחירה…'}</Text><Text style={s.muted}>⌄</Text></Pressable><Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}><SafeAreaView style={s.page}><View style={{ padding: 22, gap: 16 }}><Text style={s.heading}>{labelContent ?? label}</Text><Button title="סגירה" secondary onPress={() => setOpen(false)} /></View><ScrollView contentContainerStyle={{ padding: 22, gap: 8 }}>{options.map(o => <Pressable key={o.value} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: o.value === value, disabled }} onPress={() => { onChange(o.value); setOpen(false); }} style={[s.input, o.value === value && { backgroundColor: C.pale, borderColor: C.green }]}><Text style={s.text}>{o.label}</Text></Pressable>)}</ScrollView></SafeAreaView></Modal></View>;
}
export function ErrorText({ error }: { error: string | null }) { return error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null; }
