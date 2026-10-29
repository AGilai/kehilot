import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../../client/SessionProvider.tsx';
import type { Message } from '../../client/types.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button } from '../../kit/components.tsx';
import { Compose } from '../Compose.tsx';

/**
 * The update screen for a message id. A message that is not in the feed (trimmed, or opened from search or a push) is
 * fetched first; if that fails the screen says so with "נסו שוב" and a way back, and never drops to Home.
 */
export function UpdateLoader({ messageId, onBack, onSaved }: { messageId: string; onBack: () => void; onSaved: (r: { quiet: boolean }) => void }) {
  const { t } = useI18n();
  const { state, loadHit } = useSession();
  const inFeed = state.feed.messages[messageId];
  const [fetched, setFetched] = React.useState<Message | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (inFeed) return;
    let live = true;
    setFailed(false);
    loadHit(messageId).then(h => { if (!live) return; if (h.kind === 'full') setFetched(h.message); else setFailed(true); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [messageId, !!inFeed, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const message = inFeed ?? fetched;
  if (message) return <Compose onBack={onBack} onPublished={() => {}} update={{ message, onSaved }} />;
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {failed ? (
        <>
          <Banner tone="error" text={t('errors.try_again')} />
          <Button title={t('common.retry')} onPress={() => setAttempt(n => n + 1)} />
          <Button kind="secondary" title={t('common.back')} onPress={onBack} />
        </>
      ) : <ActivityIndicator />}
    </View>
  );
}
