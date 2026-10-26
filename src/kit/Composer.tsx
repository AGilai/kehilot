import React from 'react';
import { Platform, TextInput, View } from 'react-native';
import type { NativeSyntheticEvent, TextInputContentSizeChangeEventData, TextInputSelectionChangeEventData } from 'react-native';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { textStart } from '../i18n/direction.ts';
import { Button, Txt, useTokens } from './components.tsx';
import { EmojiButton } from './EmojiButton.tsx';
import { codePoints, insertAt } from './emoji.ts';
import type { Selection } from './emoji.ts';
import { TOUCH, fonts, type } from './theme.ts';

const LINE = Math.round(type.body * 1.5);
const PAD = 20;
const MIN_H = 3 * LINE + PAD;
const MAX_H = 8 * LINE + PAD;

export type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  maxCodePoints: number;
  placeholder: string;
  /** A line that stays visible above the box while typing (the privacy promise of a private blessing). */
  lockLine?: string;
  /** Without it there is no send button (the compose screen has its own publish button). */
  onSend?: () => void;
  busy?: boolean;
  /** A message with an attached image may have no text. */
  allowEmpty?: boolean;
  /** Extra controls beside the emoji button (the attach button). */
  extras?: React.ReactNode;
  disabled?: boolean;
};

/**
 * Multi-line input with a code-point counter (from 80% of the limit), a send button and, on web, an emoji
 * popover. Enter adds a newline; only the button sends. There is no `maxLength`: the limit is in code points.
 */
export function Composer({ value, onChange, maxCodePoints, placeholder, lockLine, onSend, busy, allowEmpty, extras, disabled }: ComposerProps) {
  const { lang, dir, t } = useI18n();
  const k = useTokens();
  const input = React.useRef<TextInput>(null);
  const selection = React.useRef<Selection>({ start: value.length, end: value.length });
  const [height, setHeight] = React.useState(MIN_H);
  const n = codePoints(value);
  const over = n > maxCodePoints;
  const canSend = !busy && !disabled && !over && (allowEmpty || value.trim().length > 0);

  function pick(emoji: string) {
    const r = insertAt(value, selection.current, emoji);
    selection.current = { start: r.cursor, end: r.cursor };
    onChange(r.text);
    // The input needs the new text first; then focus returns with the caret after the emoji.
    setTimeout(() => {
      input.current?.focus();
      (input.current as unknown as { setSelection?: (s: number, e: number) => void } | null)?.setSelection?.(r.cursor, r.cursor);
    }, 0);
  }

  return (
    <View style={{ gap: 8 }}>
      {lockLine ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Txt size="small" color={k.muted}>🔒</Txt>
          <Txt size="small" color={k.muted} style={{ flex: 1 }}>{lockLine}</Txt>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <TextInput ref={input} value={value} multiline editable={!disabled} keyboardType="default" autoCorrect textAlignVertical="top"
          accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={k.muted}
          onChangeText={v => { if (Platform.OS === 'web') setHeight(MIN_H); onChange(v); }}
          onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => { selection.current = e.nativeEvent.selection; }}
          onContentSizeChange={(e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => setHeight(Math.min(MAX_H, Math.max(MIN_H, Math.ceil(e.nativeEvent.contentSize.height) + (Platform.OS === 'web' ? 0 : PAD))))}
          style={[{ flex: 1, height, borderWidth: 1, borderRadius: 10, borderColor: over ? k.danger : k.line, backgroundColor: k.surface, paddingHorizontal: 12, paddingVertical: PAD / 2, color: k.ink, fontSize: type.body, lineHeight: LINE, fontFamily: fonts.ui, writingDirection: dir, textAlign: textStart(lang) },
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]} />
        <EmojiButton onPick={pick} />
        {extras}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          {n >= maxCodePoints * 0.8 ? <Txt size="caption" color={over ? k.danger : k.muted}>{t('field.counter', { n, max: maxCodePoints })}</Txt> : null}
        </View>
        {onSend ? (
          <View style={{ minWidth: 120, minHeight: TOUCH }}>
            <Button title={t('composer.send')} onPress={onSend} busy={busy} disabled={!canSend} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
