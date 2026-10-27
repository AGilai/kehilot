import React from 'react';
import { Image, Keyboard, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider.tsx';
import { config } from '../config.ts';
import { buildContext, errorKindOf, isTextTarget, osLabel, placeButton, validateReportText, TEXT_MAX } from '../client/reportContext.ts';
import type { ReportErrorKind } from '../client/reportContext.ts';
import { reportUi, useReportUi } from '../client/reportUi.ts';
import { sendReport } from '../client/sendReport.ts';
import { useI18n } from '../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Field, Sheet, Toast, Txt, useTokens } from '../kit/components.tsx';
import { Icon } from '../kit/Icon.tsx';
import { ReportButton } from '../kit/ReportButton.tsx';
import { blobOf, pickImage, prepareDeps } from '../media/device.ts';
import type { Picked } from '../media/device.ts';
import { prepareImage } from '../media/prepare.ts';
import { putToS3 } from '../media/upload.ts';

function useKeyboardOpen(): boolean {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return undefined;
      const sync = () => setOpen(isTextTarget(document.activeElement as HTMLElement | null));
      document.addEventListener('focusin', sync); document.addEventListener('focusout', sync);
      return () => { document.removeEventListener('focusin', sync); document.removeEventListener('focusout', sync); };
    }
    const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return open;
}

/** The context sent with a report, and the same values as the sheet shows them. */
function useReportContext() {
  const { lang } = useI18n();
  const ui = useReportUi();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent ?? '' : '';
  return buildContext({
    appVersion: Constants.expoConfig?.version ?? '0.0.0', build: config.buildNumber, platform: Platform.OS,
    os: osLabel(Platform.OS, Platform.Version as string | number | undefined, ua), screen: ui.screen, lang, kehilaId: ui.kehilaId,
  });
}

/** The report sheet (UX-DESIGN §13.2). */
export function ReportSheet({ visible, onClose, onSent }: { visible: boolean; onClose: () => void; onSent: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  const { status, api, fixtures } = useAuth();
  const signedIn = status === 'signedIn';
  const ui = useReportUi();
  const context = useReportContext();
  const [text, setText] = React.useState('');
  const [image, setImage] = React.useState<Picked | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ReportErrorKind | null>(null);
  const [discard, setDiscard] = React.useState(false);
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);
  const v = validateReportText(text);
  const dirty = text.trim().length > 0 || image !== null;

  function close() { setDiscard(false); onClose(); }
  function requestClose() { if (busy) return; if (dirty) setDiscard(true); else close(); }
  async function choose() {
    try {
      const r = await pickImage('gallery');
      if (r && r !== 'denied') { setImage(r); setError(null); }
    } catch { /* the picker failed to open: nothing was chosen */ }
  }
  async function send() {
    if (!v.ok || busy) return;
    setBusy(true); setError(null);
    try {
      await sendReport({
        signedIn, text, context, api,
        image: signedIn && image ? {
          prepare: async () => blobOf((await prepareImage(image.uri, prepareDeps)).uri),
          // The fixtures build has no bucket to PUT to.
          put: async (g, blob) => { if (!fixtures) await putToS3(g, blob); },
        } : null,
      });
      if (!alive.current) return;
      setText(''); setImage(null); setDiscard(false); setBusy(false);
      onSent();
    } catch (e) {
      if (!alive.current) return;
      const kind = errorKindOf(e, signedIn);
      if (kind === 'tooBig') setImage(null); // the picture goes, the text stays
      setError(kind); setBusy(false);
    }
  }

  const errText = error === 'limitUser' ? t('bug.limitUser') : error === 'limitAnon' ? t('bug.limitAnon') : error === 'limitUpload' ? t('bug.limitUpload') : error === 'tooBig' ? t('bug.tooBig') : error ? t('bug.error') : null;
  const platformText = `${context.platform} ${context.os}`;
  const screenName = t(`bug.screens.${context.screen}`);
  const details = t('bug.auto', { version: `${context.appVersion} (${context.build})`, platform: platformText, screen: screenName === `bug.screens.${context.screen}` ? context.screen : screenName, lang: context.lang });
  const footer = (
    <>
      {errText ? <Banner tone={error === 'limitUser' || error === 'limitAnon' || error === 'limitUpload' ? 'info' : 'error'} text={errText} /> : null}
      {discard ? (
        <>
          <Banner tone="info" text={t('bug.discard')} />
          <Button kind="danger" title={t('bug.discardYes')} onPress={() => { setText(''); setImage(null); setError(null); close(); }} />
          <Button kind="secondary" title={t('common.back')} onPress={() => setDiscard(false)} />
        </>
      ) : <Button title={t('bug.send')} onPress={() => void send()} busy={busy} disabled={!v.ok} />}
    </>
  );
  return (
    <Sheet visible={visible} title={t('bug.title')} onClose={requestClose} closeLabel={discard ? undefined : t('bug.cancel')} footer={footer}>
      <Txt size="small" color={k.muted}>{t('bug.intro')}</Txt>
      <Field label={t('bug.text')} value={text} onChangeText={setText} multiline maxCodePoints={TEXT_MAX} editable={!busy} />
      {signedIn ? (
        image ? (
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Image source={{ uri: image.uri }} resizeMode="cover" accessibilityLabel={t('composer.preview')} style={{ width: 56, height: 96, borderRadius: 8, backgroundColor: k.line }} />
            <Txt size="small" color={k.muted} style={{ flex: 1 }}>{t('bug.picNote')}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={t('bug.removePic')} onPress={() => setImage(null)} disabled={busy} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="trash" size={22} color={k.danger} />
            </Pressable>
          </View>
        ) : <Button kind="secondary" title={t('bug.pick')} onPress={() => void choose()} disabled={busy} />
      ) : <Txt size="small" color={k.muted}>{t('bug.signedOut')}</Txt>}
      <Card>
        <Txt size="small" bold>{t('bug.autoTitle')}</Txt>
        <Txt size="small" color={k.muted}>{details}</Txt>
        {ui.kehilaName ? <Txt size="small" color={k.muted}>{t('bug.autoKehila', { name: ui.kehilaName })}</Txt> : null}
        <Txt size="small" color={k.muted}>{t('bug.autoNot')}</Txt>
      </Card>
    </Sheet>
  );
}

/** Mounted once at the app root: the floating button, its sheet and the "sent" toast. */
export function ReportHost() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const ui = useReportUi();
  const keyboard = useKeyboardOpen();
  const [open, setOpen] = React.useState(false);
  const [toast, setToast] = React.useState(false);
  const { t } = useI18n();
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!config.bugReports) return null;
  const p = placeButton({ width, hasTabs: ui.hasTabs, keyboard, modalOpen: ui.modals > 0, viewerOpen: false, screen: ui.screen, enabled: true, insetBottom: insets.bottom });
  return (
    <>
      {p.show ? <ReportButton corner={p.corner} bottom={p.bottom} collapsed={ui.collapsed} onOpen={() => setOpen(true)} onHide={() => reportUi.setCollapsed(true)} onShow={() => reportUi.setCollapsed(false)} /> : null}
      <ReportSheet visible={open} onClose={() => setOpen(false)} onSent={() => {
        setOpen(false); setToast(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setToast(false), 2500);
      }} />
      <Toast text={t('bug.sent')} visible={toast} />
    </>
  );
}
