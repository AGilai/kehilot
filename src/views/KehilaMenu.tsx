import React from 'react';
import { View } from 'react-native';
import { parseLink } from '../client/links.ts';
import { menuRows } from '../client/meMap.ts';
import type { MenuAction } from '../client/meMap.ts';
import { useSession } from '../client/SessionProvider.tsx';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Field, Sheet, Txt, useTokens } from '../kit/components.tsx';
import { Icon } from '../kit/Icon.tsx';
import { ListGroup, NavRow } from '../kit/NavRows.tsx';
import { useErrorText } from './auth/Frame.tsx';
import { KehilaInfo } from './me/KehilaInfo.tsx';
import { KehilaLogo } from './TopBar.tsx';
import { useFamilyLine } from './useFamilyLine.ts';
import { useWaiting } from './useWaiting.ts';

/**
 * §18.2a The Kehila menu (replaces the M6 switcher): one Sheet opened by the Kehila name in the top bar, on every screen.
 * One card for this Kehila (manage, family tree, phone list, invite a listener, about), then "הקהילות שלי" with the switch and "join another".
 * Rows follow `menuRows(role)`: a listener sees only "על הקהילה".
 */
export function KehilaMenu({ visible, onClose, onAction, onJoinCode }: { visible: boolean; onClose: () => void; /** A screen row: Main opens the screen once (management only for a gabbai). */ onAction: (a: MenuAction) => void; /** A typed code or pasted link: the join flow. */ onJoinCode: (code: string) => void }) {
  const { state, select } = useSession();
  const { t } = useI18n();
  const k = useTokens();
  const errText = useErrorText();
  const kehila = state.kehila;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState(false);
  const [joining, setJoining] = React.useState(false);
  const [text, setText] = React.useState('');
  const [bad, setBad] = React.useState(false);
  const waiting = useWaiting();
  const rows = menuRows(kehila?.role);
  const { line } = useFamilyLine(kehila?.kehilaId, visible && rows.includes('tree'));
  const close = () => { setJoining(false); setText(''); setBad(false); setError(null); onClose(); };
  async function pick(id: string) {
    if (busy || id === state.kehilaId) return;
    setBusy(true); setError(null);
    try { await select(id); close(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  function submit() {
    const l = parseLink(text);
    if (l?.kind === 'join') { setBad(false); setJoining(false); setText(''); onJoinCode(l.code); onClose(); } else setBad(true);
  }
  const go = (a: MenuAction) => () => { close(); onAction(a); };
  const manageStatus = waiting.requests > 0 ? t('kehila.menu.waiting', { n: waiting.requests }) : waiting.terms ? t('kehila.menu.terms') : t('kehila.menu.none');

  const row = (id: (typeof rows)[number]) => {
    switch (id) {
      case 'manage': return <NavRow key={id} band icon="gear" title={t('kehila.menu.manage')} status={manageStatus} badge={waiting.requests || undefined} onPress={go('manage')} />;
      case 'tree': return <NavRow key={id} icon="tree" title={t('kehila.menu.tree')} status={line?.text} tone={line?.tone === 'request' ? 'attention' : line?.tone === 'missing' ? 'warn' : undefined} onPress={go('tree')} />;
      case 'phoneList': return <NavRow key={id} icon="phone" title={t('kehila.menu.phoneList')} onPress={go('phoneList')} />;
      case 'invite': return <NavRow key={id} icon="link" title={t('kehila.menu.invite')} onPress={go('invite')} />;
      default: return <NavRow key={id} icon="book" title={t('kehila.menu.about')} status={t('kehila.menu.aboutSub')} onPress={() => setInfo(true)} />;
    }
  };
  return (
    <>
      <KehilaInfo visible={visible && info} onClose={() => { setInfo(false); close(); }} />
      <Sheet visible={visible && !info} title={kehila?.name ?? t('kehila.menu.mine')} onClose={close}>
        {error ? <Banner tone="error" text={error} /> : null}
        {joining ? (
          <>
            <Txt>{t('noKehila.body')}</Txt>
            <Field label={t('noKehila.codeLabel')} value={text} onChangeText={v => { setText(v); setBad(false); }} autoCapitalize="characters" autoCorrect={false}
              error={bad ? t('noKehila.codeInvalid') : null} onSubmitEditing={submit} />
            <Button title={t('noKehila.codeSubmit')} onPress={submit} disabled={!text.trim()} />
            <Button kind="secondary" title={t('me.profile.cancel')} onPress={() => { setJoining(false); setBad(false); }} />
          </>
        ) : (
          <>
            {kehila ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <KehilaLogo kehilaId={kehila.kehilaId} name={kehila.name} logoVersion={kehila.logoVersion} size={44} />
                  <Txt color={k.muted}>{t(`switcher.role.${kehila.role}`)}</Txt>
                </View>
                <ListGroup>{rows.map(row)}</ListGroup>
              </>
            ) : null}
            <ListGroup label={t('kehila.menu.mine')}>
              {[
                ...(state.me?.kehilot ?? []).map(x => {
                  const current = x.kehilaId === state.kehilaId;
                  return (
                    <NavRow key={x.kehilaId} title={x.name} status={current ? `${t(`switcher.role.${x.role}`)} · ${t('kehila.menu.open')}` : t(`switcher.role.${x.role}`)}
                      end={current ? <Icon name="check" size={20} color={k.tekhelet} /> : undefined} onPress={current ? undefined : () => void pick(x.kehilaId)} />
                  );
                }),
                <NavRow key="join" icon="plus" title={t('kehila.menu.join')} onPress={() => setJoining(true)} />,
              ]}
            </ListGroup>
          </>
        )}
      </Sheet>
    </>
  );
}
