import React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { useSession } from '../../client/SessionProvider.tsx';
import { fixtureParams } from '../../client/fixtures.ts';
import { singleFlight } from '../../client/singleFlight.ts';
import type { ImportRow } from '../../client/types.ts';
import { config } from '../../config.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { Banner, Button, Card, Txt, useTokens } from '../../kit/components.tsx';
import { checkGroups, decodeCsv, mapRows, parseCsv, readXlsx, runBatches, MAX_FILE_BYTES, type ImportSummary, type Table, type Problem } from '../../import/parse.ts';
import { BackLink } from '../Me.tsx';
import { Tag, useAdminErrText } from './shared.tsx';

const SHOWN = 50;

/** Fixture mode only (?screen=import): an invented table with one bad role. */
const FIXTURE_TABLE = [
  ['שם פרטי', 'שם משפחה', 'אימייל', 'תפקיד', 'סיווג', 'קבוצות'],
  ['דנה', 'בדויה', 'dana@example.com', 'חבר', 'א', 'נוער'],
  ['יוסי', 'בדיוני', 'yossi@example.com', 'אורח', '', ''],
  ['רות', 'לדוגמה', 'ruth@example.com', 'נשיא', '', ''],
  ['אבי', 'מומצא', 'avi@example.com', 'גבאי', 'קבוע', ''],
];

type Parsed = { rows: ImportRow[]; lines: number[]; problems: Problem[] };

async function readFile(file: File): Promise<Table> {
  if (file.size > MAX_FILE_BYTES) throw new Error('too_big');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return /\.xlsx$/i.test(file.name) ? readXlsx(bytes) : parseCsv(decodeCsv(bytes));
}

/** Gabbai, web only: pick a CSV/XLSX, preview with problems, send in batches of 10. Parsed rows live in this component's state only. */
export function Import({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const { api } = useAuth();
  const { state } = useSession();
  const k = useTokens();
  const errText = useAdminErrText();
  const kehilaId = state.kehilaId!;
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = React.useState<ImportSummary | null>(null);
  const [stopText, setStopText] = React.useState<string | null>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);

  const groupNames = React.useRef<string[] | null>(null);
  const accept = React.useCallback(async (table: Table) => {
    const m = mapRows(table);
    let problems = m.problems;
    if (m.rows.some(r => r.groups?.length)) {
      try {
        groupNames.current ??= (await api.groups(kehilaId)).map(g => g.name);
        const bad = checkGroups(m.rows, groupNames.current, m.lines);
        const badLines = new Set(bad.map(b => b.line));
        problems = [...problems, ...bad].sort((a, b) => a.line - b.line);
        const keep = m.rows.map((_, i) => !badLines.has(m.lines[i]!));
        m.rows = m.rows.filter((_, i) => keep[i]); m.lines = m.lines.filter((_, i) => keep[i]);
      } catch { /* the server checks the groups again */ }
    }
    if (mounted.current) setParsed({ rows: m.rows, lines: m.lines, problems });
  }, [api, kehilaId]);

  React.useEffect(() => {
    if (config.fixtures && fixtureParams().screen === 'import') {
      groupNames.current = ['נוער'];
      void accept(FIXTURE_TABLE);
    }
  }, [accept]);

  function pick() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.csv,.xlsx';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setFileError(null); setSummary(null); setStopText(null); setParsed(null);
      try { await accept(await readFile(file)); } catch (e) { if (mounted.current) setFileError(t((e as Error).message === 'too_big' ? 'admin.import.tooBig' : 'admin.import.readError')); }
    };
    input.click();
  }

  const run = React.useMemo(() => singleFlight(async () => {
    if (!parsed || parsed.rows.length === 0) return;
    const { rows, lines } = parsed;
    setSummary(null); setStopText(null); setProgress({ done: 0, total: rows.length });
    const sum = await runBatches(rows, lines, async b => (await api.importRows(kehilaId, b)).results, (done, total) => { if (mounted.current) setProgress({ done, total }); }, { shouldStop: () => !mounted.current });
    if (!mounted.current) return;
    setSummary(sum); setProgress(null); setParsed(null); // drop the rows once sent
    if (sum.stopped) setStopText(t('admin.import.stopped', { why: sum.stopped.code === 'skipped_too_long' ? t('admin.import.stoppedSkipped') : errText({ code: sum.stopped.code }), n: sum.stopped.remaining }));
  }), [parsed, api, kehilaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const why = (code: string) => t(`admin.import.why.${code}`);
  const busy = progress !== null;

  if (Platform.OS !== 'web') {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        <BackLink onPress={onBack} />
        <Txt serif size="title" accessibilityRole="header">{t('admin.import.title')}</Txt>
        <Banner text={t('admin.import.native')} />
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, width: '100%', maxWidth: 1000, alignSelf: 'center' }}>
      <BackLink onPress={onBack} />
      <Txt serif size="title" accessibilityRole="header">{t('admin.import.title')}</Txt>
      <Txt color={k.muted}>{t('admin.import.intro')}</Txt>
      <Txt size="small" color={k.muted}>{t('admin.import.note')}</Txt>
      {fileError ? <Banner tone="error" text={fileError} /> : null}
      <Button kind="secondary" title={parsed || summary ? t('admin.import.pickAgain') : t('admin.import.pick')} onPress={pick} disabled={busy} />

      {parsed ? (
        <>
          {parsed.problems.length ? (
            <Card>
              <Txt bold accessibilityRole="header">{t('admin.import.problems', { n: parsed.problems.length })}</Txt>
              {parsed.problems.slice(0, SHOWN).map(p => <Txt key={`${p.line}-${p.code}`} size="small" color={k.pomegranate}>{t('admin.import.problem', { line: p.line, why: why(p.code) })}</Txt>)}
              {parsed.problems.length > SHOWN ? <Txt size="small" color={k.muted}>{t('admin.import.previewMore', { n: parsed.problems.length - SHOWN })}</Txt> : null}
            </Card>
          ) : null}
          {parsed.rows.length === 0 ? <Banner text={t('admin.import.empty')} /> : (
            <Card>
              <Txt serif size="heading" accessibilityRole="header">{t('admin.import.preview', { n: parsed.rows.length })}</Txt>
              <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: k.line }}>
                {(['name', 'email', 'role', 'class', 'groups'] as const).map((c, i) => <View key={c} style={{ flex: i === 1 ? 2 : 1 }}><Txt size="small" bold color={k.muted}>{t(`admin.import.col.${c}`)}</Txt></View>)}
              </View>
              {parsed.rows.slice(0, SHOWN).map((r, i) => (
                <View key={parsed.lines[i]} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 32 }}>
                  <View style={{ flex: 1 }}><Txt>{r.firstName} {r.lastName}</Txt></View>
                  <View style={{ flex: 2 }}><Txt size="small" style={{ writingDirection: 'ltr', textAlign: 'left' }}>{r.email}</Txt></View>
                  <View style={{ flex: 1, alignItems: 'flex-start' }}><Tag label={t(`admin.import.role.${r.role}`)} /></View>
                  <View style={{ flex: 1 }}><Txt size="small">{r.classification}</Txt></View>
                  <View style={{ flex: 1 }}><Txt size="small">{(r.groups ?? []).join(', ')}</Txt></View>
                </View>
              ))}
              {parsed.rows.length > SHOWN ? <Txt size="small" color={k.muted}>{t('admin.import.previewMore', { n: parsed.rows.length - SHOWN })}</Txt> : null}
            </Card>
          )}
          {parsed.rows.length ? <Button title={t('admin.import.start')} onPress={() => void run()} busy={busy} disabled={busy} /> : null}
        </>
      ) : null}

      {progress ? (
        <Card>
          <Txt bold>{t('admin.import.running', progress)}</Txt>
          <View accessibilityRole="progressbar" accessibilityLabel={t('admin.import.progress')} accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}
            style={{ height: 10, borderRadius: 5, backgroundColor: k.line, overflow: 'hidden' }}>
            <View style={{ height: 10, width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, backgroundColor: k.tekhelet }} />
          </View>
        </Card>
      ) : null}
      {stopText ? <Banner tone="error" text={stopText} /> : null}
      {summary ? (
        <Card>
          <Txt serif size="heading" accessibilityRole="header">{t('admin.import.summary')}</Txt>
          {(['created', 'added', 'upgraded', 'exists', 'invalid'] as const).map(s => <Txt key={s}>{t(`admin.import.count.${s}`)}: {summary.counts[s]}</Txt>)}
          {summary.invalid.map(p => <Txt key={`${p.line}-${p.code}`} size="small" color={k.pomegranate}>{t('admin.import.problem', { line: p.line, why: why(p.code) })}</Txt>)}
        </Card>
      ) : null}
    </ScrollView>
  );
}
