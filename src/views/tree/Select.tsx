import React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Icon } from '../../kit/Icon.tsx';
import { Txt, useTokens } from '../../kit/components.tsx';
import { TOUCH, fonts, type } from '../../kit/theme.ts';

export type Option<V extends string | number> = { value: V; label: string };

/** A one-line choice from a list (day, month, year). The web build uses the browser's own `<select>`; on a phone the row
 *  opens an inline list. `value` undefined shows `placeholder`. Picking the empty row clears it. */
export function Select<V extends string | number>({ label, value, options, onChange, placeholder, disabled, testID }: {
  label: string; value: V | undefined; options: Option<V>[]; onChange: (v: V | undefined) => void; placeholder: string; disabled?: boolean; testID?: string;
}) {
  const k = useTokens();
  const [open, setOpen] = React.useState(false);
  const shown = options.find(o => o.value === value)?.label;
  const box = { minHeight: TOUCH, borderWidth: 1, borderRadius: 10, borderColor: k.line, backgroundColor: k.surface } as const;
  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, minWidth: 0 }}>
        {React.createElement('select', {
          'data-testid': testID, 'aria-label': label, disabled, value: value === undefined ? '' : String(value),
          onChange: (e: { target: { value: string } }) => { const raw = e.target.value; onChange(raw === '' ? undefined : (options.find(o => String(o.value) === raw)?.value as V)); },
          style: { ...box, width: '100%', paddingInline: 10, color: value === undefined ? k.muted : k.ink, fontSize: type.body, fontFamily: fonts.ui, boxSizing: 'border-box', opacity: disabled ? 0.5 : 1 },
        }, React.createElement('option', { value: '' }, placeholder), ...options.map(o => React.createElement('option', { key: String(o.value), value: String(o.value) }, o.label)))}
      </View>
    );
  }
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${shown ?? placeholder}`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(o => !o)}
        style={[box, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, opacity: disabled ? 0.5 : 1 }]}>
        <Txt color={shown ? k.ink : k.muted} numberOfLines={1} style={{ flexShrink: 1 }}>{shown ?? placeholder}</Txt>
        <Icon name="chev" size={18} color={k.muted} />
      </Pressable>
      {open ? (
        <ScrollView nestedScrollEnabled style={{ maxHeight: 220, borderWidth: 1, borderColor: k.line, borderRadius: 10, backgroundColor: k.surface, marginTop: 4 }}>
          {[{ value: undefined as V | undefined, label: placeholder }, ...options].map(o => (
            <Pressable key={String(o.value ?? '')} accessibilityRole="button" accessibilityState={{ selected: o.value === value }} onPress={() => { onChange(o.value); setOpen(false); }} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}>
              <Txt bold={o.value === value} color={o.value === undefined ? k.muted : k.ink}>{o.value === value ? `✓ ${o.label}` : o.label}</Txt>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
