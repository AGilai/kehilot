import React from 'react';
import { View } from 'react-native';
import { optionLabelKey, TEMPLATES } from '../../client/templates.ts';
import type { FieldSpec } from '../../client/templates.ts';
import type { TemplateFields, TemplateId } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Chip, Field, Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import { TimeField } from '../admin/scheduleEditor/controls.tsx';
import { DayPicker } from './DayPicker.tsx';

export type FocusRefs = React.MutableRefObject<Record<string, { focus: () => void } | null>>;

/** The label of a field; the mazal tov name label follows the occasion ("שם התינוק"). */
export function fieldLabel(id: TemplateId, spec: FieldSpec, f: TemplateFields, t: (key: string, p?: Record<string, string | number>) => string): string {
  if (id === 'mazal' && spec.key === 'name') {
    const occasion = typeof f.occasion === 'string' ? f.occasion : '';
    return t(`tpl.mazal.nameLabel.${occasion || 'other'}`);
  }
  return t(spec.labelKey);
}

const str = (f: TemplateFields, key: string): string => (typeof f[key] === 'string' ? (f[key] as string) : '');

/**
 * The fields of one template (§19.2). `families` is Compose's own family picker block, drawn for the `family` row.
 * `errors` are the keys of fields to mark; `refs` collects a focus handle per field for "focus the first missing one".
 */
export function TemplateForm({ id, fields, onChange, errors, families, busy, refs }: {
  id: TemplateId; fields: TemplateFields; onChange: (key: string, value: string) => void; errors: string[]; families: React.ReactNode; busy: boolean; refs: FocusRefs;
}) {
  const { t } = useI18n();
  const k = useTokens();
  const rows = TEMPLATES[id].filter(s => !s.showWhen || s.showWhen(fields));
  return (
    <View style={{ gap: 16 }}>
      {rows.map(spec => {
        const base = fieldLabel(id, spec, fields, t);
        const label = spec.required || spec.requiredWhen?.(fields) ? base : `${base} ${t('compose.tpl.optional')}`;
        const bad = errors.includes(spec.key);
        const errorText = bad ? t('compose.tpl.required', { field: base }) : null;
        const value = str(fields, spec.key);
        const register = (node: { focus?: () => void; scrollIntoView?: () => void } | null) => {
          refs.current[spec.key] = node ? { focus: () => { if (node.focus) node.focus(); else node.scrollIntoView?.(); } } : null;
        };
        const errorLine = errorText ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="alert" size={16} color={k.danger} />
            <Txt size="small" color={k.danger} accessibilityRole="alert">{errorText}</Txt>
          </View>
        ) : null;
        switch (spec.kind) {
          case 'family':
            return <View key={spec.key} ref={register as never} style={{ gap: 8 }}>{families}{errorLine}</View>;
          case 'chips':
            return (
              <View key={spec.key} ref={register as never} style={{ gap: 8 }}>
                <Txt size="small" bold>{label}</Txt>
                <View role="radiogroup" accessibilityLabel={base} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {spec.options!.map(o => (
                    <Chip key={o} size="filter" label={t(optionLabelKey(id, spec.key, o))} selected={value === o} icon={value === o ? 'check' : undefined} onPress={() => { if (!busy) onChange(spec.key, o); }} />
                  ))}
                </View>
                {errorLine}
              </View>
            );
          case 'date':
            return (
              <View key={spec.key} ref={register as never} style={{ gap: 6 }}>
                <Txt size="small" bold>{label}</Txt>
                <DayPicker label={base} value={value} days={spec.days ?? 60} onChange={v => onChange(spec.key, v)} error={bad} />
                {errorLine}
              </View>
            );
          case 'time':
            return (
              <View key={spec.key} ref={register as never} style={{ gap: 6 }}>
                <Txt size="small" bold>{label}</Txt>
                <TimeField value={value || undefined} label={base} error={bad} width={140} disabled={busy} onChange={c => onChange(spec.key, c ?? '')} />
                {errorLine}
              </View>
            );
          default:
            return (
              <View key={spec.key} style={{ gap: 6 }}>
                <Field inputRef={register as never} label={label} value={value} onChangeText={v => onChange(spec.key, v)} error={errorText} editable={!busy}
                  maxCodePoints={spec.kind === 'long' ? 600 : 120} ltr={spec.key === 'hours'} multiline={spec.kind === 'long'} />
                {id === 'mazal' && spec.key === 'blessing' ? <Txt size="caption" color={k.muted}>{t('tpl.mazal.blessingHint')}</Txt> : null}
              </View>
            );
        }
      })}
    </View>
  );
}
