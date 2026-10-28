import React from 'react';
import { ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import type { Classification, InviteRow } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Chip, Field, Txt, useTokens } from '../../kit/components.tsx';
import { PadScroll } from '../../kit/PadScroll.tsx';
import { BackLink, LinkShare } from '../Me.tsx';
import { InviteList } from './InviteList.tsx';
import { Choice, useAdminErrText } from './shared.tsx';

const int = (s: string, lo: number, hi: number): number | null => (/^\d+$/.test(s.trim()) && +s >= lo && +s <= hi ? +s : null);

/** GM6: an invite link for a guest worshipper (listener) or a member (with classification), then share. */
export function InviteWithRole({ onBack, onToast, initialRole = 'listener' }: { onBack: () => void; onToast: (text: string) => void; initialRole?: 'listener' | 'member' }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const [role, setRole] = React.useState<'listener' | 'member' | 'tech'>(initialRole);
  const [classification, setClassification] = React.useState<Classification>('');
  const [uses, setUses] = React.useState('10');
  const [days, setDays] = React.useState('7');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<string | null>(null);
  const [invites, setInvites] = React.useState<InviteRow[] | null>(null);
  const loadInvites = React.useCallback(async () => {
    if (!state.kehilaId) return;
    try { setInvites(await api.invites(state.kehilaId)); } catch (e) { setError(errText(e)); setInvites(prev => prev ?? []); }
  }, [api, state.kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { void loadInvites(); }, [loadInvites]);
  const u = int(uses, 1, 50);
  const d = int(days, 1, 30);

  async function create() {
    if (busy || u === null || d === null || !state.kehilaId) return;
    setBusy(true); setError(null);
    try {
      const r = await api.createInvite(state.kehilaId, { role, uses: u, days: d, ...(role === 'member' ? { classification } : {}) });
      setCode(r.code);
      void loadInvites();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  return (
    <PadScroll contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
      <BackLink onPress={onBack} />
      <Txt serif size="title" accessibilityRole="header">{t('admin.invite.title')}</Txt>
      <Card>
        <Txt bold>{t('admin.invite.role')}</Txt>
        <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
          <Choice label={t('admin.invite.listener')} note={t('admin.invite.listenerNote')} selected={role === 'listener'} onPress={() => { setRole('listener'); setCode(null); }} />
          <Choice label={t('admin.invite.member')} note={t('admin.invite.memberNote')} selected={role === 'member'} onPress={() => { setRole('member'); setCode(null); }} />
          <Choice label={t('admin.invite.tech')} note={t('admin.invite.techNote')} selected={role === 'tech'} onPress={() => { setRole('tech'); setCode(null); }} />
        </View>
        {role === 'member' ? (
          <>
            <Txt bold>{t('admin.invite.class')}</Txt>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Chip size="filter" label={t('admin.members.class.none')} selected={classification === ''} onPress={() => setClassification('')} />
              <Chip size="filter" label={t('admin.members.class.a')} selected={classification === 'א'} onPress={() => setClassification('א')} />
              <Chip size="filter" label={t('admin.members.class.kavua')} selected={classification === 'קבוע'} onPress={() => setClassification('קבוע')} />
            </View>
          </>
        ) : null}
        <Field label={t('admin.invite.uses')} value={uses} onChangeText={v => { setUses(v); setCode(null); }} keyboardType="number-pad" error={u === null ? t('admin.invite.invalid') : null} />
        <Field label={t('admin.invite.days')} value={days} onChangeText={v => { setDays(v); setCode(null); }} keyboardType="number-pad" error={d === null ? t('admin.invite.invalid') : null} />
        {error ? <Banner tone="error" text={error} /> : null}
        <Button title={t('admin.invite.create')} onPress={() => void create()} busy={busy} disabled={u === null || d === null} />
      </Card>
      {code ? (
        <Card>
          <Txt color={k.olive} bold>{t('admin.invite.ready')}</Txt>
          <LinkShare code={code} onToast={onToast} />
        </Card>
      ) : null}
      {invites ? <InviteList rows={invites} onChanged={loadInvites} onToast={onToast} /> : null}
    </PadScroll>
  );
}
