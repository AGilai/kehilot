import React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useSession } from '../../client/SessionProvider.tsx';
import { eventWhat, initialUpdateFields, notifyDefault, previewOf, gap } from '../../client/composeState.ts';
import { missingFields, TEMPLATES } from '../../client/templates.ts';
import type { Message, TemplateFields, TemplateId } from '../../client/types.ts';
import { messageMeta } from '../../client/typesView.ts';
import { singleFlight } from '../../client/singleFlight.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Field, Screen, Toggle, Txt, useTokens } from '../../kit/components.tsx';
import { BackIcon } from '../../kit/Icon.tsx';
import { TOUCH } from '../../kit/theme.ts';
import { useErrorText } from '../auth/Frame.tsx';
import { WIDE } from '../admin/shared.tsx';
import { TemplateForm, fieldLabel } from './TemplateForm.tsx';
import type { FocusRefs } from './TemplateForm.tsx';
import { TemplatePreview } from './TemplatePreview.tsx';

/** The fields the update stores: empty optional ones are left out, `cancelled` only when on. */
function sentFields(f: TemplateFields): TemplateFields {
  const out: TemplateFields = {};
  for (const [key, v] of Object.entries(f)) if (v !== '' && v !== undefined && v !== false) out[key] = v;
  return out;
}

/**
 * Compose in update mode (§19.2a, P43 phones 5-7 and the event panel): a posted condolence or event is changed in place.
 * No type cards, no channel row, no family picker: surname, deceased and relation are plain text. `onSaved` gets whether
 * the quiet push went out (`notify` on and `notified` false means the 12-hour limit held it back).
 */
export function UpdateMode({ message, onBack, onSaved }: { message: Message; onBack: () => void; onSaved: (r: { quiet: boolean }) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const { state, updateMessage } = useSession();
  const tplId: TemplateId = message.type === 'condolence' ? 'condolence' : 'event';
  const before: TemplateFields = React.useMemo(() => message.fields ?? {}, [message.fields]);
  const [fields, setFields] = React.useState<TemplateFields>(() => initialUpdateFields(message));
  const [notifyChoice, setNotifyChoice] = React.useState<boolean | null>(null);
  const notify = notifyChoice ?? notifyDefault(before, fields, tplId);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const focusRefs: FocusRefs = React.useRef({});
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);
  const latest = React.useRef<() => Promise<void>>(async () => {});
  const saveOnce = React.useRef(singleFlight(() => latest.current())).current;

  const setField = (key: string, value: string) => { setFields(prev => ({ ...prev, [key]: value })); setErrors(e => e.filter(x => x !== key)); };
  const label = (key: string) => gap(fieldLabel(tplId, TEMPLATES[tplId].find(x => x.key === key)!, fields, t));
  const built = previewOf(tplId, fields, lang, label);
  const surname = String(fields.surname ?? message.targetName ?? '');

  latest.current = save;
  async function save() {
    if (busy) return;
    setError(null);
    const missing = missingFields(tplId, fields);
    if (missing.length) { setErrors(missing); focusRefs.current[missing[0]!]?.focus(); return; }
    setBusy(true);
    try {
      const sent = sentFields(fields);
      const { title, body } = previewOf(tplId, sent, lang, label);
      const r = await updateMessage(message.messageId, { title, body, fields: sent, notify });
      if (alive.current) onSaved({ quiet: notify && !r.notified });
    } catch (e) {
      if (alive.current) { setBusy(false); setError(errText(e)); }
    }
  }

  const surnameRow = (
    <View style={{ gap: 6 }}>
      <Field label={t('tpl.family')} value={String(fields.surname ?? '')} onChangeText={v => setField('surname', v)} editable={!busy}
        error={errors.includes('surname') ? t('compose.tpl.required', { field: t('tpl.family') }) : null} inputRef={((node: { focus?: () => void } | null) => { focusRefs.current.surname = node?.focus ? { focus: () => node.focus!() } : null; }) as never} maxCodePoints={120} />
    </View>
  );
  const form = <TemplateForm id={tplId} fields={fields} onChange={setField} errors={errors} families={surnameRow} busy={busy} refs={focusRefs} />;

  const shown: Message = { ...message, title: built.title, body: built.body, templateId: tplId, fields: built.fields, targetName: surname || message.targetName };
  const preview = (
    <TemplatePreview message={shown} meta={messageMeta(shown, state.channels, t('compose.tpl.now'), t)} sheetLine={null} caption={null}
      missing={built.missing.map(key => fieldLabel(tplId, TEMPLATES[tplId].find(x => x.key === key)!, fields, t))} />
  );

  const help = tplId === 'condolence'
    ? t('msg.update.notifyHelp', { surname: surname || '…' })
    : `"${t('push.eventChanged', { event: String(fields.name ?? message.title), what: eventWhat(before, fields, t('msg.cancelled'), lang) || '…' })}"`;
  const toggles = (
    <View style={{ gap: 4 }}>
      {tplId === 'event' ? (
        <Toggle label={t('msg.update.cancelEvent')} value={fields.cancelled === true} onChange={v => { setFields(prev => ({ ...prev, cancelled: v })); }} />
      ) : null}
      <Toggle label={t('msg.update.notify')} value={notify} onChange={setNotifyChoice} />
      <Txt size="small" color={k.muted}>{help}</Txt>
    </View>
  );

  return (
    <Screen maxWidth={wide ? 980 : 680}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('msg.update.back')} onPress={onBack} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('msg.update.back')}</Txt></View>
      </Pressable>
      <Txt serif size="title" accessibilityRole="header">{t(tplId === 'condolence' ? 'msg.update.shiva' : 'msg.update.event')}</Txt>
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
          <View style={{ width: 560, gap: 16 }}>{form}{toggles}</View>
          <View style={{ flex: 1, ...({ position: 'sticky', top: 16 } as object) }}>{preview}</View>
        </View>
      ) : (<>{form}{preview}{toggles}</>)}
      {error ? <Banner tone="error" text={error} /> : null}
      <Button title={t('msg.update.save')} onPress={() => void saveOnce()} busy={busy} disabled={busy} />
    </Screen>
  );
}
