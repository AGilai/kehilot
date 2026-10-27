// Small controls for the schedule editor that the kit does not have (UX-DESIGN §14.7): a select (listbox with groups, side values and
// type-to-filter), a stepper, a time field, a compact segmented control. Targets are 44 high on desktop (§14.6).
import React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { textStart } from '../../../i18n/direction.ts';
import { Txt, useTokens } from '../../../kit/components.tsx';
import { Icon } from '../../../kit/Icon.tsx';
import type { IconName } from '../../../kit/Icon.tsx';
import { fonts, type } from '../../../kit/theme.ts';
import { clockLabel } from '../../../schedule/memberView.ts';
import { nudgeClock, parseClockInput } from '../../../schedule/editor.ts';

export const H = 44;

/** What the keyboard handlers need from a web key event (RN-web passes either the DOM event or a `nativeEvent` wrapper). */
export type Key = { key: string; shift: boolean; alt: boolean; ctrl: boolean; meta: boolean; prevent: () => void };
export function keyOf(e: unknown): Key {
  const ev = e as { key?: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; preventDefault?: () => void; nativeEvent?: { key?: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } };
  const n = ev.nativeEvent ?? {};
  return { key: ev.key ?? n.key ?? '', shift: !!(ev.shiftKey ?? n.shiftKey), alt: !!(ev.altKey ?? n.altKey), ctrl: !!(ev.ctrlKey ?? n.ctrlKey), meta: !!(ev.metaKey ?? n.metaKey), prevent: () => ev.preventDefault?.() };
}
/** `onKeyDown` exists on web only and is missing from the RN types. */
export const onKeys = (handler: (k: Key) => void): object => ({ onKeyDown: (e: unknown) => handler(keyOf(e)) });

export function IconBtn({ icon, label, onPress, size = H, color, disabled, selected }: { icon: IconName; label: string; onPress: () => void; size?: number; color?: string; disabled?: boolean; selected?: boolean }) {
  const k = useTokens();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected }} disabled={disabled} onPress={onPress}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: size / 2, opacity: disabled ? 0.35 : 1 }}>
      <Icon name={icon} size={20} color={color ?? k.ink} />
    </Pressable>
  );
}

/** A label above a control (the sentence of the formula builder). */
export function Labeled({ label, children, style }: { label: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 4 }, style]}>
      <Txt size="caption" bold>{label}</Txt>
      {children}
    </View>
  );
}

/** Compact segmented control (radio group), 44 high. */
export function FSeg<K extends string>({ options, value, onChange, label, style }: { options: Array<{ key: K; label: string }>; value: K | null; onChange: (key: K) => void; label: string; style?: StyleProp<ViewStyle> }) {
  const k = useTokens();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[{ flexDirection: 'row', height: H, padding: 3, gap: 3, borderRadius: 11, backgroundColor: k.stone, borderWidth: 1, borderColor: k.line }, style]}>
      {options.map(o => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} accessibilityLabel={o.label} onPress={() => onChange(o.key)}
            style={{ flex: 1, minWidth: 56, paddingHorizontal: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? k.surface : 'transparent', borderWidth: 1.5, borderColor: on ? k.tekhelet : 'transparent' }}>
            <Txt size="small" bold color={on ? k.tekhelet : k.muted} style={{ textAlign: 'center' }}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export type Option<K> = { key: K; label: string; hint?: string; side?: string; group?: string };

/** A listbox that opens under its button. With `filterable`, typing narrows the list; arrows and Enter pick, Esc closes. */
export function Select<K extends string | number>({ label, value, options, onChange, filterable, width, error, footer, placeholder, display, icon }: {
  label: string; value: K | null; options: Array<Option<K>>; onChange: (key: K) => void; filterable?: boolean; width?: number; error?: boolean; footer?: React.ReactNode; placeholder?: string;
  /** The button's text when it should differ from the option's label. */ display?: string; icon?: IconName;
}) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [hi, setHi] = React.useState(0);
  const shown = React.useMemo(() => (query.trim() ? options.filter(o => `${o.label} ${o.hint ?? ''}`.includes(query.trim())) : options), [options, query]);
  const current = options.find(o => o.key === value);
  const show = () => { setQuery(''); setHi(Math.max(0, options.findIndex(o => o.key === value))); setOpen(true); };
  const pick = (o: Option<K> | undefined) => { if (!o) return; setOpen(false); onChange(o.key); };
  const handle = (key: Key) => {
    if (!open) { if (key.key === 'ArrowDown' || key.key === 'Enter' || key.key === ' ') { key.prevent(); show(); } return; }
    if (key.key === 'Escape') { key.prevent(); setOpen(false); }
    else if (key.key === 'ArrowDown') { key.prevent(); setHi(i => Math.min(shown.length - 1, i + 1)); }
    else if (key.key === 'ArrowUp') { key.prevent(); setHi(i => Math.max(0, i - 1)); }
    else if (key.key === 'Enter') { key.prevent(); pick(shown[hi]); }
  };
  let lastGroup: string | undefined;
  return (
    <View style={{ width, minWidth: width ? undefined : 150, zIndex: open ? 60 : 0 }}>
      {open ? <Pressable accessibilityLabel={t('common.close')} onPress={() => setOpen(false)} style={{ position: 'absolute', top: -3000, bottom: -3000, start: -3000, end: -3000, zIndex: 55 }} /> : null}
      <Pressable accessibilityRole="combobox" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={() => (open ? setOpen(false) : show())} {...onKeys(handle)}
        style={{ height: H, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: error ? k.danger : open ? k.tekhelet : k.line, backgroundColor: k.surface }}>
        {icon ? <Icon name={icon} size={18} color={k.muted} /> : null}
        <Txt style={{ flex: 1 }} color={current ? k.ink : k.muted} numberOfLines={1}>{display ?? current?.label ?? placeholder ?? ''}</Txt>
        <Icon name="chev" size={18} color={k.muted} />
      </Pressable>
      {open ? (
        <View accessibilityRole="list" style={{ position: 'absolute', top: H + 4, start: 0, minWidth: Math.max(width ?? 0, 240), zIndex: 60, backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, padding: 6, maxHeight: 360, ...({ boxShadow: '0 8px 24px rgba(21,26,51,0.18)' } as object) }}>
          {filterable ? (
            <TextInput autoFocus value={query} onChangeText={text => { setQuery(text); setHi(0); }} accessibilityLabel={t('editor.filter')} placeholder={t('editor.filter')} placeholderTextColor={k.muted} {...onKeys(handle)}
              style={{ height: 40, borderRadius: 8, borderWidth: 1, borderColor: k.line, paddingHorizontal: 10, marginBottom: 4, color: k.ink, fontSize: type.small, fontFamily: fonts.ui, textAlign: textStart(lang), writingDirection: dir }} />
          ) : null}
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            {shown.length === 0 ? <Txt size="small" color={k.muted} style={{ padding: 10 }}>{t('editor.noMatch')}</Txt> : null}
            {shown.map((o, i) => {
              const heading = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              const on = o.key === value;
              return (
                <View key={String(o.key)}>
                  {heading ? <Txt size="caption" bold color={k.muted} style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2 }}>{heading}</Txt> : null}
                  <Pressable accessibilityRole="menuitem" accessibilityLabel={o.label} accessibilityState={{ selected: on }} onPress={() => pick(o)}
                    style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: i === hi ? k.stone : 'transparent' }}>
                    <View style={{ width: 18 }}>{on ? <Icon name="check" size={16} color={k.tekhelet} /> : null}</View>
                    <Txt style={{ flex: 1 }} bold={on}>{o.label}</Txt>
                    {o.hint ? <Txt size="caption" color={k.muted}>{o.hint}</Txt> : null}
                    {o.side ? <Txt size="small" color={k.muted} style={{ fontVariant: ['tabular-nums'] }}>{`⁦${o.side}⁩`}</Txt> : null}
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

/** A number with − and +: arrows change it by 1, Shift+arrows by 5, digits can be typed. */
export function Stepper({ value, min = 0, max, onChange, label }: { value: number; min?: number; max: number; onChange: (n: number) => void; label: string }) {
  const k = useTokens();
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  const set = (n: number) => onChange(Math.min(max, Math.max(min, n)));
  return (
    <View accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min, max, now: value }} style={{ height: H, flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: k.line, backgroundColor: k.surface }}>
      <IconBtn icon="minus" label={`${label} −`} onPress={() => set(value - 1)} disabled={value <= min} />
      <TextInput value={text} accessibilityLabel={label} keyboardType="number-pad" inputMode="numeric"
        onChangeText={v => { const d = v.replace(/\D/g, '').slice(0, 3); setText(d); if (d) set(Number(d)); }} onBlur={() => setText(String(value))}
        {...onKeys(key => {
          if (key.key === 'ArrowUp' || key.key === 'ArrowDown') { key.prevent(); set(value + (key.key === 'ArrowUp' ? 1 : -1) * (key.shift ? 5 : 1)); }
        })}
        style={{ width: 52, height: H - 2, textAlign: 'center', color: k.ink, fontSize: type.body, fontFamily: fonts.uiBold, fontVariant: ['tabular-nums'], ...({ outlineStyle: 'none' } as object) }} />
      <IconBtn icon="plus" label={`${label} +`} onPress={() => set(value + 1)} disabled={value >= max} />
    </View>
  );
}

/** A clock: "830", "8:30" or "08:30" are read; arrows move it by 5 minutes; Enter or leaving the field applies it. */
export function TimeField({ value, onChange, label, error, placeholder = '--:--', width = 96, optional, disabled }: { value: string | undefined; onChange: (clock: string | null) => void; label: string; error?: boolean; placeholder?: string; width?: number; optional?: boolean; disabled?: boolean }) {
  const { t } = useI18n();
  const k = useTokens();
  const shownValue = value ? clockLabel(value) : '';
  const [text, setText] = React.useState(shownValue);
  const [bad, setBad] = React.useState(false);
  React.useEffect(() => { setText(shownValue); setBad(false); }, [shownValue]);
  const commit = (raw: string) => {
    if (!raw.trim() && optional) { setBad(false); onChange(null); return; }
    const parsed = parseClockInput(raw);
    if (parsed) { setBad(false); setText(clockLabel(parsed)); onChange(parsed); } else setBad(true);
  };
  return (
    <View style={{ width }}>
      <TextInput value={text} accessibilityLabel={label} placeholder={placeholder} placeholderTextColor={k.muted} inputMode="numeric" editable={!disabled}
        onChangeText={v => { setText(v); setBad(false); }} onBlur={() => commit(text)} onSubmitEditing={() => commit(text)}
        {...onKeys(key => {
          if (key.key === 'Enter') { commit(text); return; }
          if (key.key !== 'ArrowUp' && key.key !== 'ArrowDown') return;
          key.prevent();
          const base = parseClockInput(text) ?? value;
          if (base) { const next = nudgeClock(base, key.key === 'ArrowUp' ? 5 : -5); setText(clockLabel(next)); setBad(false); onChange(next); }
        })}
        style={{ height: H, borderRadius: 10, borderWidth: 1, borderColor: bad || error ? k.danger : k.line, backgroundColor: k.surface, paddingHorizontal: 10, textAlign: 'center', writingDirection: 'ltr', color: k.ink, fontSize: type.body, fontFamily: fonts.uiBold, fontVariant: ['tabular-nums'], opacity: disabled ? 0.45 : 1 }} />
      {bad ? <Txt size="caption" color={k.danger} accessibilityRole="alert">{t('editor.timeInvalid')}</Txt> : null}
    </View>
  );
}

export type MenuItem = { key: string; label: string; icon?: IconName; onPress: () => void; danger?: boolean; disabled?: boolean; hint?: string };

/** A button that opens a short list of actions (the row's "more", a section's "more", Share). */
export function ActionMenu({ label, items, trigger, width = 240 }: { label: string; items: MenuItem[]; trigger?: (open: () => void, isOpen: boolean) => React.ReactNode; width?: number }) {
  const { t } = useI18n();
  const k = useTokens();
  const [open, setOpen] = React.useState(false);
  return (
    <View style={{ zIndex: open ? 60 : 0 }}>
      {open ? <Pressable accessibilityLabel={t('common.close')} onPress={() => setOpen(false)} style={{ position: 'absolute', top: -3000, bottom: -3000, start: -3000, end: -3000, zIndex: 55 }} /> : null}
      {trigger ? trigger(() => setOpen(o => !o), open) : <IconBtn icon="more" label={label} onPress={() => setOpen(o => !o)} selected={open} />}
      {open ? (
        <View accessibilityRole="menu" style={{ position: 'absolute', top: H, end: 0, width, zIndex: 60, backgroundColor: k.surface, borderRadius: 12, borderWidth: 1, borderColor: k.line, padding: 6, ...({ boxShadow: '0 8px 24px rgba(21,26,51,0.18)' } as object) }}
          {...onKeys(key => { if (key.key === 'Escape') setOpen(false); })}>
          {items.map(item => (
            <Pressable key={item.key} accessibilityRole="menuitem" accessibilityLabel={item.label} accessibilityState={{ disabled: !!item.disabled }} disabled={item.disabled} onPress={() => { setOpen(false); item.onPress(); }}
              style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderRadius: 8, opacity: item.disabled ? 0.45 : 1 }}>
              {item.icon ? <Icon name={item.icon} size={18} color={item.danger ? k.danger : k.ink} /> : <View style={{ width: 18 }} />}
              <Txt style={{ flex: 1 }} color={item.danger ? k.danger : k.ink}>{item.label}</Txt>
              {item.hint ? <Txt size="caption" color={k.muted}>{item.hint}</Txt> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
