import React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import { familyRows, filterFamilies } from '../client/familyView.ts';
import { BODY_MAX, TITLE_MAX, canPublish, needsTarget, postBody, postableChannels } from '../client/messageView.ts';
import type { Draft } from '../client/messageView.ts';
import type { Message, MessageType, TargetFamily, TemplateFields } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Chip, Field, PickList, Screen, Segmented, Txt, useTokens } from '../kit/components.tsx';
import { Composer } from '../kit/Composer.tsx';
import { AttachButton, AttachPreview } from '../kit/ImageAttach.tsx';
import { TOUCH } from '../kit/theme.ts';
import type { Picked } from '../media/device.ts';
import { sendMessage } from '../media/send.ts';
import type { Stage } from '../media/send.ts';
import { singleFlight } from '../client/singleFlight.ts';
import { Stripe } from './MessageRow.tsx';
import { useErrorText } from './auth/Frame.tsx';
import { ApiCodeError } from '../client/errors.ts';
import { BackIcon } from '../kit/Icon.tsx';
import { channelLabel } from '../client/channelsView.ts';
import { composeTypes, messageMeta, refusalBanner } from '../client/typesView.ts';
import { isManagement } from '../client/roles.ts';
import { buildMessage, buildSheetLine, defaultBlessing, missingFields, templateOf, TEMPLATES } from '../client/templates.ts';
import { copyToFree, gap, stripGaps, previewOf, sheetCaption } from '../client/composeState.ts';
import { WIDE } from './admin/shared.tsx';
import { TemplateForm, fieldLabel } from './compose/TemplateForm.tsx';
import type { FocusRefs } from './compose/TemplateForm.tsx';
import { TemplatePreview } from './compose/TemplatePreview.tsx';
import { UpdateMode } from './compose/UpdateMode.tsx';

export type ComposeInitial = { type?: MessageType; /** A family from the picker. */ targetFamilyId?: string; query?: string; image?: Picked; /** A draft to start from (the gabbai's mazal tov from P36). */ title?: string; body?: string; /** Shown above the form (a suggested bar mitzvah date: check it with the family). */ note?: string; /** Fixture screens only: template values to start from, and what to do once the families have loaded. */ tpl?: { fields?: TemplateFields; then?: 'publish' | 'free' } };

/**
 * M4 (members) and GM3 (gabbaim): one screen. Type cards, channel, title, text, an optional image, and for a
 * celebration or condolence the family it is about. The audience line names the channel only: the API has no
 * recipient count.
 */
export type ComposeProps = { onBack: () => void; onPublished: (messageId: string) => void; initial?: ComposeInitial; /** Update mode (§19.2a): change a posted condolence or event in place. */ update?: { message: Message; onSaved: (r: { quiet: boolean }) => void } };
export function Compose(props: ComposeProps) {
  return props.update ? <UpdateMode message={props.update.message} onBack={props.onBack} onSaved={props.update.onSaved} /> : <ComposeNew {...props} />;
}

function ComposeNew({ onBack, onPublished, initial }: ComposeProps) {
  const { t, dir, lang } = useI18n();
  const { width: winWidth } = useWindowDimensions();
  const wide = winWidth >= WIDE;
  const k = useTokens();
  const errText = useErrorText();
  const { state, postMessage, requestUpload, targetFamilies, refreshChannels } = useSession();
  const channels = React.useMemo(() => postableChannels(state.channels), [state.channels]);
  const [channelId, setChannelId] = React.useState<string | null>(channels[0]?.channelId ?? null);
  const types = composeTypes(channels.find(c => c.channelId === channelId));
  const [chosenType, setType] = React.useState<MessageType | null>(initial?.type ?? null);
  // The first postable type unless the person (or the opener) chose one that is still postable.
  const type: MessageType = chosenType && (types as MessageType[]).includes(chosenType) ? chosenType : (types[0] ?? 'general');
  const [refused, setRefused] = React.useState(false);
  const [title, setTitle] = React.useState(initial?.title ?? '');
  const [body, setBody] = React.useState(initial?.body ?? '');
  const [targetId, setTargetId] = React.useState<string | null>(initial?.targetFamilyId ?? null);
  const [image, setImage] = React.useState<Picked | null>(initial?.image ?? null);
  const [q, setQ] = React.useState(initial?.query ?? '');
  const [people, setPeople] = React.useState<TargetFamily[] | null | 'error'>(null);
  const [stage, setStage] = React.useState<Stage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Template mode (§19.2): the default for a type that has a template; a post that arrives with its own text starts free.
  const [mode, setMode] = React.useState<'tpl' | 'free'>(initial?.title || initial?.body ? 'free' : 'tpl');
  const [fieldsBy, setFieldsBy] = React.useState<Record<string, TemplateFields>>(() => ({
    event: { for: 'all' }, mazal: { occasion: 'birthSon', whose: 'parents', blessing: defaultBlessing('birthSon', lang) }, condolence: { variant: 'full' },
    ...(initial?.type && initial.tpl?.fields && templateOf(initial.type) ? { [templateOf(initial.type)!]: initial.tpl.fields } : {}),
  }));
  const thenDone = React.useRef(false);
  const [blessingTouched, setBlessingTouched] = React.useState(false);
  const [lastCopied, setLastCopied] = React.useState<{ title: string; body: string } | null>(null);
  const [copiedBanner, setCopiedBanner] = React.useState(false);
  const [tplErrors, setTplErrors] = React.useState<string[]>([]);
  const focusRefs: FocusRefs = React.useRef({});
  const alive = React.useRef(true);
  const latest = React.useRef<() => Promise<void>>(async () => {});
  const publishOnce = React.useRef(singleFlight(() => latest.current())).current;
  React.useEffect(() => () => { alive.current = false; }, []);

  // Only the targets that are valid for the chosen channel (a group channel's own members).
  const wantTargets = needsTarget(type) && !!channelId;
  React.useEffect(() => {
    if (!wantTargets) return;
    let live = true;
    setPeople(null);
    targetFamilies(channelId!).then(l => { if (live) setPeople(l); }, () => { if (live) setPeople('error'); });
    return () => { live = false; };
  }, [wantTargets, channelId]); // eslint-disable-line react-hooks/exhaustive-deps
  // A channel that is no longer postable after a refresh is dropped for the first one that is.
  React.useEffect(() => {
    if (!channels.some(c => c.channelId === channelId)) setChannelId(channels[0]?.channelId ?? null);
  }, [channels]); // eslint-disable-line react-hooks/exhaustive-deps
  // A family that is not in this channel's list is dropped.
  React.useEffect(() => {
    if (Array.isArray(people) && targetId && !people.some(p => p.familyId === targetId)) setTargetId(null);
  }, [people]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = Array.isArray(people) ? people.find(p => p.familyId === targetId) : undefined;
  const tplId = templateOf(type);
  const tplMode = !!tplId && mode === 'tpl';
  const rawFields: TemplateFields = tplId ? (fieldsBy[tplId] ?? {}) : {};
  // The family comes from the picker: its name and its adults' first names ("דנה ויוסי").
  const fullFields: TemplateFields = tplId && TEMPLATES[tplId].some(x => x.kind === 'family')
    ? { ...rawFields, surname: chosen?.name ?? '', ...(chosen ? { firstNames: chosen.firstNames.join(' ו') } : {}) }
    : rawFields;
  const built = tplId && tplMode ? previewOf(tplId, fullFields, lang, key => gap(fieldLabel(tplId, TEMPLATES[tplId].find(x => x.key === key)!, fullFields, t))) : null;
  const draft: Draft = tplMode && tplId && built
    ? { type, channelId, title: built!.title, body: built!.body, targetMemberId: chosen?.targetMemberId ?? null, targetFamilyId: chosen?.familyId ?? null }
    : { type, channelId, title, body, targetMemberId: chosen?.targetMemberId ?? null, targetFamilyId: chosen?.familyId ?? null };
  const busy = stage !== null;
  // Template mode keeps "פרסום" enabled: a missing field is answered with the error lines instead (§19.2 item 4).
  const ok = (tplMode ? !!channelId && types.length > 0 : canPublish(draft) && types.length > 0) && !busy;
  const found = channels.find(c => c.channelId === channelId);
  const channelName = found ? channelLabel(found, t) : '';
  const gabbai = isManagement(state.kehila?.role);
  const shown = Array.isArray(people) ? familyRows(filterFamilies(people, q), t) : [];

  latest.current = publish;
  async function publish() {
    if (!ok || !channelId) return;
    setError(null); setRefused(false);
    if (tplMode && tplId) {
      const missing = missingFields(tplId, fullFields);
      if (missing.length) {
        setTplErrors(missing);
        focusRefs.current[missing[0]!]?.focus();
        return;
      }
    }
    const tpl = tplMode && tplId ? { templateId: tplId, fields: sentFields(fullFields) } : undefined;
    try {
      const m = await sendMessage({ image, channelId, requestUpload, post: id => postMessage(postBody(draft, id, tpl)), onStage: s => { if (alive.current) setStage(s); } });
      if (alive.current) onPublished(m.messageId);
    } catch (e) {
      if (!alive.current) return;
      setStage(null);
      if (e instanceof ApiCodeError && e.status === 403 && e.code === 'forbidden') { setRefused(true); void refreshChannels().catch(() => {}); } else setError(errText(e));
    }
  }

  function setField(key: string, value: string) {
    if (!tplId) return;
    setFieldsBy(prev => {
      const cur = prev[tplId] ?? {};
      const next = { ...cur, [key]: value };
      if (tplId === 'mazal' && key === 'occasion' && !blessingTouched) next.blessing = defaultBlessing(value, lang);
      if (tplId === 'mazal' && key === 'blessing') setBlessingTouched(true);
      return { ...prev, [tplId]: next };
    });
    setTplErrors(e => e.filter(x => x !== key));
  }
  function switchMode(next: 'tpl' | 'free') {
    if (next === mode) return;
    if (next === 'free' && tplId) {
      const full = missingFields(tplId, fullFields).length === 0 ? buildMessage(tplId, fullFields, lang) : { title: stripGaps(built!.title), body: stripGaps(built!.body) };
      const r = copyToFree({ title, body, lastCopied }, full);
      setTitle(r.title); setBody(r.body); setLastCopied(r.lastCopied); setCopiedBanner(r.copied);
    } else setCopiedBanner(false);
    setMode(next);
  }

  // Fixture screens: once the families are in, press "פרסום" with fields missing, or switch to free text.
  React.useEffect(() => {
    const then = initial?.tpl?.then;
    if (!then || thenDone.current || (wantTargets && !Array.isArray(people))) return;
    thenDone.current = true;
    if (then === 'free') switchMode('free'); else void latest.current();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const familyBlock = needsTarget(type) ? (
    <View style={{ gap: 8 }}>
      <Txt size="small" bold>{t('compose.family')}</Txt>
      <PickList query={q} onQuery={setQ} placeholder={t('compose.familySearch')} rows={shown} selected={targetId} onSelect={id => { setTargetId(id); setTplErrors(e => e.filter(x => x !== 'surname')); }}
        empty={t('compose.familyNone')} state={people === null ? 'loading' : people === 'error' ? 'error' : 'ready'} errorText={t('compose.familyLoadError')} disabled={busy} />
      <Txt size="small" color={k.muted}>{t('compose.familyNote')}</Txt>
    </View>
  ) : null;

  const previewMessage: Message | null = tplMode && tplId && built ? {
    messageId: 'preview', channelId: channelId ?? '', type, title: built.title, body: built.body, authorId: '', authorName: '', authorKind: gabbai ? 'management' : 'member',
    joinCount: 0, read: true, templateId: tplId, fields: built.fields, targetName: chosen?.name,
  } : null;
  const caption = sheetCaption(state.kehila?.role, state.kehila?.sheetMembers, type);
  const line = previewMessage ? lineOf(previewMessage) : null;
  const preview = previewMessage && built && tplId ? (
    <TemplatePreview message={previewMessage} meta={messageMeta(previewMessage, channels, t('compose.tpl.now'), t)}
      sheetLine={caption && line ? { ...line, main: line.main.map(p => ({ ...p, text: built.scrub(p.text) })), sub: built.scrub(line.sub) } : null}
      caption={caption} missing={built.missing.map(key => fieldLabel(tplId, TEMPLATES[tplId].find(x => x.key === key)!, fullFields, t))} />
  ) : null;

  const fieldsBlock = (
    <View style={{ gap: 16 }}>
      {tplMode && tplId ? (
        <TemplateForm id={tplId} fields={fullFields} onChange={setField} errors={tplErrors} families={familyBlock} busy={busy} refs={focusRefs} />
      ) : (
        <>
          {copiedBanner ? <Banner text={t('compose.tpl.copied')} /> : null}
          {familyBlock}
          <Field label={t('compose.titleField')} value={title} onChangeText={setTitle} maxCodePoints={TITLE_MAX} editable={!busy} />
          <View style={{ gap: 6 }}>
            <Txt size="small" bold>{t('compose.bodyField')}</Txt>
            <Composer value={body} onChange={setBody} maxCodePoints={BODY_MAX} placeholder={t('compose.bodyField')} disabled={busy}
              extras={<AttachButton disabled={busy || !!image} onPicked={setImage} onDenied={() => setError(t('compose.permissionDenied'))} />} />
          </View>
        </>
      )}
    </View>
  );

  return (
    <Screen maxWidth={wide && tplMode ? 980 : 680}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('common.back')}</Txt></View>
      </Pressable>
      <Txt serif size="title" accessibilityRole="header">{t(gabbai ? 'compose.titleGabbai' : 'compose.titleMember')}</Txt>
      {initial?.note ? <Banner text={initial.note} /> : null}

      {types.length > 1 ? (
        <View style={{ gap: 8 }}>
          <Txt size="small" bold>{t('compose.type')}</Txt>
          <View role="radiogroup" accessibilityLabel={t('compose.type')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {types.map(x => (
              <Pressable key={x} accessibilityRole="radio" accessibilityState={{ selected: type === x }} disabled={busy} onPress={() => { setType(x); setRefused(false); setTargetId(null); setQ(''); }}
                style={{ flexBasis: '47%', flexGrow: 1 }}>
                <View style={{ flexDirection: 'row', minHeight: TOUCH + 8, borderRadius: 12, overflow: 'hidden', backgroundColor: k.surface, borderWidth: type === x ? 2 : 1, borderColor: type === x ? k.tekhelet : k.line }}>
                  <Stripe type={x} />
                  <View style={{ flex: 1, padding: 12, justifyContent: 'center' }}><Txt bold>{t(`compose.types.${x}`)}</Txt></View>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {channels.length > 1 ? (
        <View style={{ gap: 8 }}>
          <Txt size="small" bold>{t('compose.channel')}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {channels.map(c => <Chip key={c.channelId} size="filter" label={channelLabel(c, t)} selected={channelId === c.channelId} onPress={() => { if (!busy) { setChannelId(c.channelId); setTargetId(null); } }} />)}
          </View>
        </View>
      ) : null}

      {tplId ? (
        <View style={{ gap: 8 }}>
          <Txt size="small" bold>{t('compose.tpl.mode')}</Txt>
          <View role="radiogroup" accessibilityLabel={t('compose.tpl.mode')}>
            <Segmented options={[{ key: 'tpl', label: t('compose.tpl.template') }, { key: 'free', label: t('compose.tpl.free') }]} value={mode} onChange={switchMode} />
          </View>
        </View>
      ) : null}

      {wide && tplMode ? (
        <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
          <View style={{ width: 560 }}>{fieldsBlock}</View>
          <View style={{ flex: 1, ...({ position: 'sticky', top: 16 } as object) }}>{preview}</View>
        </View>
      ) : (
        <>
          {fieldsBlock}
          {preview}
        </>
      )}
      {image ? <AttachPreview image={image} onRemove={() => setImage(null)} disabled={busy} /> : null}

      {channelName ? <Txt size="small" color={k.muted}>{t('compose.audience', { channel: channelName })}</Txt> : null}
      {stage ? <Txt size="small" color={k.muted} accessibilityRole="alert">{t(`compose.progress.${stage}`)}</Txt> : null}
      {error ? <Banner tone="error" text={error} /> : null}
      {refused ? (() => {
        const r = refusalBanner(types, type);
        return <Banner tone="error" text={t(`compose.${r.text}`)} action={r.asGeneral ? { title: t('compose.asGeneral'), onPress: () => { setType('general'); setTargetId(null); setQ(''); setRefused(false); } } : undefined} />;
      })() : null}
      <Button title={t('compose.publish')} onPress={() => void publishOnce()} busy={busy} disabled={!ok} />
    </Screen>
  );
}

const lineOf = (m: Message) => buildSheetLine(m);
/** What the post stores: the filled fields without empty optional ones. */
function sentFields(f: TemplateFields): TemplateFields {
  const out: TemplateFields = {};
  for (const [key, v] of Object.entries(f)) if (v !== '' && v !== undefined) out[key] = v;
  return out;
}
