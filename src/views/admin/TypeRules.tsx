import React from 'react';
import { View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import { DEFAULT_RULE, typeRuleBody } from '../../client/typesView.ts';
import type { TypeRule, TypeRules } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Card, Toggle, Txt, useTokens } from '../../kit/components.tsx';
import { Choice, useAdminErrText } from './shared.tsx';

type Configurable = 'celebration' | 'condolence';
const FIXED: Array<{ type: 'general' | 'weekly' | 'event'; post: 'management' | 'broadcasters' }> = [
  { type: 'general', post: 'broadcasters' }, { type: 'weekly', post: 'management' }, { type: 'event', post: 'management' },
];

/** "סוגי הודעות" (UX §12.2): who may post mazal tov / condolence and whether guests see them. Each tap saves at once. */
export function TypeRulesSection({ mainClosed, onToast }: { mainClosed: boolean; onToast: (text: string) => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const { api } = useAuth();
  const { state, refreshKehila } = useSession();
  const errText = useAdminErrText();
  const kehilaId = state.kehilaId!;
  const stored = state.kehila?.typeRules;
  const [rules, setRules] = React.useState<Required<TypeRules>>({ celebration: stored?.celebration ?? DEFAULT_RULE, condolence: stored?.condolence ?? DEFAULT_RULE });
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (stored) setRules({ celebration: stored.celebration, condolence: stored.condolence }); }, [stored]);

  async function change(type: Configurable, patch: Partial<TypeRule>) {
    const before = rules;
    setError(null);
    setRules({ ...rules, [type]: { ...rules[type], ...patch } });
    try {
      await api.putSettings(kehilaId, typeRuleBody(rules, type, patch));
      onToast(t('admin.types.saved'));
      void refreshKehila().catch(() => {});
    } catch (e) { setRules(before); setError(errText(e)); }
  }

  const card = (type: Configurable, edgeColor: string) => (
    <Card key={type} edgeColor={edgeColor}>
      <Txt bold size="heading">{t(`compose.types.${type}`)}</Txt>
      <View role="radiogroup" accessibilityLabel={t('admin.types.groupLabel', { type: t(`compose.types.${type}`) })} style={{ gap: 8 }}>
        <Txt bold>{t('admin.types.postLabel')}</Txt>
        <Choice label={t('admin.channels.policyOpt.management')} note={t('admin.types.noteManagement')} selected={rules[type].post === 'management'} onPress={() => void change(type, { post: 'management' })} />
        <Choice label={t('admin.channels.policyOpt.broadcasters')} note={t('admin.types.noteDefault')} selected={rules[type].post === 'broadcasters'} onPress={() => void change(type, { post: 'broadcasters' })} />
      </View>
      <Toggle label={t(`admin.types.listeners.${type}`)} value={rules[type].listeners} onChange={v => void change(type, { listeners: v })} />
      <Txt size="small" color={k.muted}>{t('admin.types.listenersNote')}</Txt>
    </Card>
  );

  return (
    <View style={{ gap: 12 }}>
      <Txt serif size="heading" accessibilityRole="header">{t('admin.types.title')}</Txt>
      <Txt size="small" color={k.muted}>{t('admin.types.intro')}</Txt>
      {mainClosed ? <Banner tone="info" text={t('admin.types.channelClosed')} /> : null}
      {error ? <Banner tone="error" text={error} /> : null}
      {card('celebration', k.pomegranate)}
      {card('condolence', k.ash)}
      <Card>
        <Txt bold size="heading">{t('admin.types.fixedTitle')}</Txt>
        {FIXED.map(f => (
          <View key={f.type} style={{ gap: 2 }}>
            <Txt bold>{t(`compose.types.${f.type}`)}</Txt>
            <Txt size="small" color={k.muted}>{t('admin.types.rowPost', { who: t(`admin.channels.policyOpt.${f.post}`) })} · {t('admin.types.rowSeen', { who: t('admin.types.seenAll') })}</Txt>
          </View>
        ))}
      </Card>
      <Txt size="small" color={k.muted}>{t('admin.types.membersSeeAll')}</Txt>
    </View>
  );
}
