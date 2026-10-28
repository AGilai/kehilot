// Management › מקומות ישיבה › "זמני הטופס והתזכורות" (UX-DESIGN §21.6, frame P47 phone 3): the week strip, the three times in one
// block, who gets the reminders, and a sample push. Gabbai and tech alike. Every change goes through PUT admin/seats/times.
import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { ApiCodeError } from '../../client/errors.ts';
import { useSession } from '../../client/SessionProvider.tsx';
import { dualDate } from '../../dates.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Segmented, Sheet, Txt, useTokens } from '../../kit/components.tsx';
import { Icon } from '../../kit/Icon.tsx';
import type { IconName } from '../../kit/Icon.tsx';
import { NavRow } from '../../kit/NavRows.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { TOUCH } from '../../kit/theme.ts';
import { allowedRange, dayLabel, fits, neighbours, slotLabel, weekMinute } from '../../seats/times.ts';
import type { Day, SeatTimes as Times, Slot, Which } from '../../seats/times.ts';
import { applyTimes, failMessage } from '../../seats/timesSave.ts';
import type { Failure, TimesBody } from '../../seats/timesSave.ts';
import { useShabbat } from '../../seats/useShabbat.ts';
import { BackLink } from '../Me.tsx';
import { useAdminErrText } from './shared.tsx';
import { TimeField } from './scheduleEditor/controls.tsx';

const NBSP = '\u00a0';

/** LTR-isolated, tabular: "ה׳ 20:00" stays one piece inside Hebrew text. */
function Value({ children, color }: { children: string; color?: string }) {
  return <Txt bold color={color} style={{ fontVariant: ['tabular-nums'] }}>{`⁦${children}⁩`}</Txt>;
}

const MARK = 26;

/** The read-only strip: Thursday on the start side (the right in Hebrew), the four marks at their time, then the same four as words. */
function WeekStrip({ times }: { times: Times }) {
  const { t, lang, dir } = useI18n();
  const k = useTokens();
  const lo = weekMinute(times.opens);
  const hi = weekMinute({ day: 'fri', time: times.deadline });
  const at = (m: number) => `${Math.round(4 + ((m - lo) / Math.max(1, hi - lo)) * 92)}%` as `${number}%`;
  type Item = { key: string; icon: IconName | null; on: boolean; minute: number; text: string };
  const r1 = times.reminders['1'];
  const r2 = times.reminders['2'];
  const items: Item[] = [
    { key: 'opens', icon: null, on: true, minute: lo, text: t('admin.seats.stripOpens', { when: slotLabel(times.opens, lang) }) },
    { key: '1', icon: 'bell', on: r1.on, minute: weekMinute(r1), text: t('admin.seats.stripR1', { when: r1.on ? slotLabel(r1, lang) : t('admin.seats.stripOff') }) },
    { key: '2', icon: 'bell', on: r2.on, minute: weekMinute(r2), text: t('admin.seats.stripR2', { when: r2.on ? slotLabel(r2, lang) : t('admin.seats.stripOff') }) },
    { key: 'deadline', icon: 'lock', on: true, minute: hi, text: t('admin.seats.stripDeadline', { when: slotLabel({ day: 'fri', time: times.deadline }, lang) }) },
  ];
  const label = t('admin.seats.stripLabel', { opens: items[0]!.text, r1: items[1]!.text, r2: items[2]!.text, deadline: items[3]!.text });
  return (
    <View accessibilityRole="image" accessibilityLabel={label} style={{ gap: 12 }}>
      <View style={{ height: MARK + 4, justifyContent: 'center' }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: k.line }} />
        <View style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: k.tekhelet, opacity: 0.35 }} />
        {items.map(i => {
          const pos = at(i.minute);
          const off = !i.on;
          return (
            <View key={i.key} style={{ position: 'absolute', ...(dir === 'rtl' ? { right: pos, marginRight: -MARK / 2 } : { left: pos, marginLeft: -MARK / 2 }), width: MARK, height: MARK, borderRadius: MARK / 2, alignItems: 'center', justifyContent: 'center',
              backgroundColor: k.surface, borderWidth: 2, borderColor: off ? k.muted : k.tekhelet, borderStyle: off ? 'dashed' : 'solid', opacity: off ? 0.8 : 1 }}>
              {i.icon ? <Icon name={i.icon} size={16} color={off ? k.muted : k.tekhelet} /> : null}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 6 }}>
        {items.map(i => (
          <View key={i.key} style={{ flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {i.icon ? <Icon name={i.on ? i.icon : 'belloff'} size={16} color={i.on ? k.tekhelet : k.muted} /> : <Icon name="clock" size={16} color={k.tekhelet} />}
            <Txt size="small" color={i.on ? k.ink : k.muted} style={{ flexShrink: 1 }}>{i.text}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The on/off pill of a reminder (same look as the kit's Toggle, but inside a row): a `switch` of its own, 48 high. */
function Pill({ on, label, onPress, disabled }: { on: boolean; label: string; onPress: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: on, disabled: !!disabled }} accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={4}
      style={{ minHeight: TOUCH, justifyContent: 'center', opacity: disabled ? 0.6 : 1 }}>
      <View style={{ minWidth: 56, minHeight: 32, paddingHorizontal: 10, borderRadius: 16, justifyContent: 'center', backgroundColor: on ? k.olive : k.line }}>
        <Txt size="caption" bold color={on ? k.onAction : k.ink} style={{ textAlign: 'center' }}>{on ? t('toggle.on') : t('toggle.off')}</Txt>
      </View>
    </Pressable>
  );
}

function TimeRow({ icon, title, sub, value, valueLabel, off, onEdit, toggle }: {
  icon: IconName; title: string; sub: string; value: string; valueLabel: string; off?: boolean; onEdit: () => void; toggle?: React.ReactNode;
}) {
  const k = useTokens();
  return (
    <View style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 16 }}>
      <Icon name={icon} size={24} color={off ? k.muted : k.tekhelet} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt bold color={off ? k.muted : k.ink}>{title}</Txt>
        <Txt size="small" color={k.muted}>{sub}</Txt>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${valueLabel}: ${value}`} onPress={onEdit} hitSlop={4} style={{ minHeight: TOUCH, minWidth: 64, justifyContent: 'center', alignItems: 'center' }}>
        <Value color={off ? k.muted : k.ink}>{value}</Value>
      </Pressable>
      {toggle}
    </View>
  );
}

/** A push as the lock screen shows it. */
function LockCard({ title, body, now }: { title: string; body: string; now: string }) {
  const k = useTokens();
  return (
    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: k.line, backgroundColor: k.surface, padding: 12, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="bell" size={14} color={k.muted} />
        <Txt size="caption" color={k.muted} style={{ flex: 1 }}>Kehilot</Txt>
        <Txt size="caption" color={k.muted}>{now}</Txt>
      </View>
      <Txt bold>{title}</Txt>
      <Txt size="small">{body}</Txt>
    </View>
  );
}

export function SeatTimes({ onBack, onToast }: { onBack: () => void; onToast: (text: string) => void }) {
  const { t, lang } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const { state } = useSession();
  const errText = useAdminErrText();
  const kehilaId = state.kehilaId!;
  const [times, setTimes] = React.useState<Times | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [edit, setEdit] = React.useState<{ which: Which; day: Day; time: string; error: string | null } | null>(null);
  const [sample, setSample] = React.useState(false);
  const { saturday, parasha } = useShabbat(times?.week);

  React.useEffect(() => {
    let live = true;
    api.seatTimes(kehilaId).then(v => { if (live) setTimes(v); }, e => { if (live) setError(errText(e)); });
    return () => { live = false; };
  }, [api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!times) {
    return (
      <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        <BackLink onPress={onBack} label={t('admin.area.seats')} />
        {error ? <Banner tone="error" text={error} /> : <ActivityIndicator color={k.tekhelet} />}
      </PadScroll>
    );
  }

  const name = (w: Which) => t(w === 'deadline' ? 'admin.seats.deadline' : `admin.seats.r${w}`);
  const slotOf = (w: Which): Slot => (w === 'deadline' ? { day: 'fri', time: times.deadline } : times.reminders[w]);
  const shabbat = parasha ? t('seats.row.shabbat', { parasha }) : t('admin.seats.shabbatFallback');

  const put = (body: TimesBody) => api.putSeatTimes(kehilaId, body);
  /** The text of a refusal about `which`: its own message, or the generic one for the code. */
  const failText = (w: Which, f: Failure): string => {
    const m = failMessage(times, w, f, lang);
    return m ? t(m.key, m.key === 'admin.seats.errDeadline' ? { ...m.params, reminder: t(m.params.reminder!) } : m.params) : errText(new ApiCodeError(0, f.code));
  };
  const orderError = (w: Which): string => failText(w, { code: 'seat_times_order' });

  const open = (w: Which) => { const s = slotOf(w); setEdit({ which: w, day: s.day, time: s.time, error: null }); };
  const draft = edit ? { day: edit.which === 'deadline' ? ('fri' as const) : edit.day, time: edit.time } : null;
  const draftOk = edit && draft ? fits(times, edit.which, draft) : false;
  const range = edit ? allowedRange(times, edit.which) : null;
  const complete = !!edit && /^([01]\d|2[0-3]):[0-5]\d$/.test(edit.time);
  const orderMsg = edit && !draftOk ? (!complete ? t('editor.timeInvalid') : Number(edit.time.slice(3)) % 15 !== 0 ? t('admin.seats.errStep') : orderError(edit.which)) : null;

  const onSave = async () => {
    if (!edit || !draft || !draftOk) return;
    const body: TimesBody = edit.which === 'deadline' ? { deadline: draft.time } : { reminders: { [edit.which]: { day: draft.day, time: draft.time } } };
    setBusy(true);
    const r = await applyTimes(put, times, body);
    setBusy(false);
    if (r.failure) { setEdit(cur => cur ? { ...cur, error: failText(edit.which, r.failure!) } : cur); return; }
    setTimes(r.times); setEdit(null); onToast(t('admin.seats.saved'));
  };

  const flip = async (n: '1' | '2') => {
    if (busy) return;
    const on = !times.reminders[n].on;
    setTimes({ ...times, reminders: { ...times.reminders, [n]: { ...times.reminders[n], on } } });
    setError(null);
    setBusy(true);
    const r = await applyTimes(put, times, { reminders: { [n]: { on } } });
    setBusy(false);
    setTimes(r.times);
    if (r.failure) setError(r.failure.code === 'seat_times_order' ? `${name(n)}: ${t('errors.seat_times_order')}` : failText(n, r.failure));
    else onToast(t(on ? 'admin.seats.onToast' : 'admin.seats.offToast'));
  };
  const r1 = times.reminders['1'];
  const r2 = times.reminders['2'];
  const when = (s: Slot) => `${slotLabel(s, lang)}`;
  const deadlineAt = { day: 'fri' as const, time: times.deadline };
  const dayWord = lang === 'en' ? 'Fri' : 'יום ו׳';
  const pushWhen = { day: dayWord, time: times.deadline };
  const kehilaName = state.kehila?.name ?? t('admin.seats.sampleKehila');
  const rows = (
    <>
      <TimeRow icon="bell" title={t('admin.seats.r1')} sub={t('admin.seats.r1Sub')} value={when(r1)} valueLabel={t('admin.seats.changeTime')} off={!r1.on} onEdit={() => open('1')}
        toggle={<Pill on={r1.on} disabled={busy} label={t('admin.seats.switchLabel', { when: when(r1) })} onPress={() => void flip('1')} />} />
      <View style={{ borderTopWidth: 1, borderTopColor: k.line }}>
        <TimeRow icon="bell" title={t('admin.seats.r2')} sub={t('admin.seats.r2Sub')} value={when(r2)} valueLabel={t('admin.seats.changeTime')} off={!r2.on} onEdit={() => open('2')}
          toggle={<Pill on={r2.on} disabled={busy} label={t('admin.seats.switchLabel2', { when: when(r2) })} onPress={() => void flip('2')} />} />
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: k.line }}>
        <TimeRow icon="lock" title={t('admin.seats.deadline')} sub={t('admin.seats.deadlineSub')} value={when(deadlineAt)} valueLabel={t('admin.seats.changeDeadline')} onEdit={() => open('deadline')} />
      </View>
    </>
  );

  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <BackLink onPress={onBack} label={t('admin.area.seats')} />
      <View style={{ gap: 4 }}>
        <Txt serif size="title" accessibilityRole="header">{t('admin.seats.times')}</Txt>
        <Txt color={k.muted}>{t('admin.seats.applies', { shabbat, date: dualDate(saturday, lang) })}</Txt>
      </View>
      {error ? <Banner tone="error" text={error} /> : null}
      <Card><WeekStrip times={times} /></Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>{rows}</Card>
      <Card style={{ gap: 8 }}>
        <Txt size="small" color={k.muted}>{t('admin.seats.who')}</Txt>
        <Txt size="small" color={k.muted}>{t('admin.seats.lateNote')}</Txt>
        {times.pending !== null ? <Txt size="small" bold>{t('admin.seats.pending', { n: times.pending })}</Txt> : null}
      </Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <NavRow icon="bell" title={t('admin.seats.sample')} onPress={() => setSample(true)} />
      </Card>

      <Sheet visible={!!edit} title={edit ? name(edit.which) : ''} onClose={() => setEdit(null)}
        footer={<Button title={t('common.save')} onPress={() => void onSave()} busy={busy} disabled={!draftOk || busy} />}>
        {edit ? (
          <>
            {edit.which !== 'deadline' ? (
              <Segmented options={[{ key: 'thu' as Day, label: dayLabel('thu', lang) }, { key: 'fri' as Day, label: dayLabel('fri', lang) }]} value={edit.day} onChange={day => setEdit({ ...edit, day, error: null })} />
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Txt bold>{t('admin.seats.timeLabel')}</Txt>
              <TimeField value={edit.time} label={t('admin.seats.timeLabel')} error={!draftOk} onChange={c => setEdit({ ...edit, time: c ?? '', error: null })} />
            </View>
            {range ? <Txt size="small" color={k.muted}>{t('admin.seats.range', { from: slotLabel(range.from, lang), to: slotLabel(range.to, lang) })}</Txt> : null}
            {edit.error ?? orderMsg ? <Txt size="small" color={k.danger} accessibilityRole="alert">{edit.error ?? orderMsg}</Txt> : null}
          </>
        ) : null}
      </Sheet>

      <Sheet visible={sample} title={t('admin.seats.sampleTitle')} onClose={() => setSample(false)}>
        <LockCard now={t('admin.seats.sampleNow')} title={t('seats.push.r1.title', { kehila: kehilaName })} body={t('seats.push.r1.body', pushWhen).replace('\u2069 \u2068', `\u2069${NBSP}\u2068`)} />
        <LockCard now={t('admin.seats.sampleNow')} title={t('seats.push.r2.title', { kehila: kehilaName })}
          body={r2.day === 'fri' ? t('seats.push.r2.body', { time: pushWhen.time }) : t('seats.push.r2.bodyOtherDay', pushWhen)} />
      </Sheet>
    </PadScroll>
  );
}
