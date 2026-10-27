import React from 'react';
import { Pressable, View } from 'react-native';
import { useSession } from '../client/SessionProvider.tsx';
import { familyRows, filterFamilies } from '../client/familyView.ts';
import { BODY_MAX, TITLE_MAX, canPublish, needsTarget, postBody, postableChannels } from '../client/messageView.ts';
import type { Draft } from '../client/messageView.ts';
import type { MessageType, TargetFamily } from '../client/types.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Chip, Field, PickList, Screen, Txt, useTokens } from '../kit/components.tsx';
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
import { composeTypes, refusalBanner } from '../client/typesView.ts';

export type ComposeInitial = { type?: MessageType; /** A family from the picker. */ targetFamilyId?: string; query?: string; image?: Picked };

/**
 * M4 (members) and GM3 (gabbaim): one screen. Type cards, channel, title, text, an optional image, and for a
 * celebration or condolence the family it is about. The audience line names the channel only: the API has no
 * recipient count.
 */
export function Compose({ onBack, onPublished, initial }: { onBack: () => void; onPublished: (messageId: string) => void; initial?: ComposeInitial }) {
  const { t, dir } = useI18n();
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
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [targetId, setTargetId] = React.useState<string | null>(initial?.targetFamilyId ?? null);
  const [image, setImage] = React.useState<Picked | null>(initial?.image ?? null);
  const [q, setQ] = React.useState(initial?.query ?? '');
  const [people, setPeople] = React.useState<TargetFamily[] | null | 'error'>(null);
  const [stage, setStage] = React.useState<Stage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
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
  const draft: Draft = { type, channelId, title, body, targetMemberId: chosen?.targetMemberId ?? null, targetFamilyId: chosen?.familyId ?? null };
  const busy = stage !== null;
  const ok = canPublish(draft) && types.length > 0 && !busy;
  const found = channels.find(c => c.channelId === channelId);
  const channelName = found ? channelLabel(found, t) : '';
  const gabbai = state.kehila?.role === 'gabbai';
  const shown = Array.isArray(people) ? familyRows(filterFamilies(people, q), t) : [];

  latest.current = publish;
  async function publish() {
    if (!ok || !channelId) return;
    setError(null); setRefused(false);
    try {
      const m = await sendMessage({ image, channelId, requestUpload, post: id => postMessage(postBody(draft, id)), onStage: s => { if (alive.current) setStage(s); } });
      if (alive.current) onPublished(m.messageId);
    } catch (e) {
      if (!alive.current) return;
      setStage(null);
      if (e instanceof ApiCodeError && e.status === 403 && e.code === 'forbidden') { setRefused(true); void refreshChannels().catch(() => {}); } else setError(errText(e));
    }
  }

  return (
    <Screen>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} style={{ minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><BackIcon color={k.tekhelet} /><Txt bold color={k.tekhelet}>{t('common.back')}</Txt></View>
      </Pressable>
      <Txt serif size="title" accessibilityRole="header">{t(gabbai ? 'compose.titleGabbai' : 'compose.titleMember')}</Txt>

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

      {needsTarget(type) ? (
        <View style={{ gap: 8 }}>
          <Txt size="small" bold>{t('compose.family')}</Txt>
          <PickList query={q} onQuery={setQ} placeholder={t('compose.familySearch')} rows={shown} selected={targetId} onSelect={setTargetId}
            empty={t('compose.familyNone')} state={people === null ? 'loading' : people === 'error' ? 'error' : 'ready'} errorText={t('compose.familyLoadError')} disabled={busy} />
          <Txt size="small" color={k.muted}>{t('compose.familyNote')}</Txt>
        </View>
      ) : null}

      <Field label={t('compose.titleField')} value={title} onChangeText={setTitle} maxCodePoints={TITLE_MAX} editable={!busy} />
      <View style={{ gap: 6 }}>
        <Txt size="small" bold>{t('compose.bodyField')}</Txt>
        <Composer value={body} onChange={setBody} maxCodePoints={BODY_MAX} placeholder={t('compose.bodyField')} disabled={busy}
          extras={<AttachButton disabled={busy || !!image} onPicked={setImage} onDenied={() => setError(t('compose.permissionDenied'))} />} />
      </View>
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
