// The fit card at the top of the weekly sheet screen (UX-DESIGN §19.3, P44): a polite live region saying whether the week's lines fit on one
// page (olive check) or not (gold alert, never colour alone), the link to the print preview, and the three meters with their numbers.
import { Pressable, View } from 'react-native';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import { Card, Txt, useTokens } from '../../../kit/components.tsx';
import { Icon } from '../../../kit/Icon.tsx';
import type { meters } from '../../../client/sheetItems.ts';

type Meters = ReturnType<typeof meters>;

function Meter({ label, value, n, max, extra }: { label: string; value: string; n?: number; max?: number; extra?: string }) {
  const k = useTokens();
  const pct = n !== undefined && max ? Math.min(100, Math.round((n / max) * 100)) : 0;
  return (
    <View accessible accessibilityLabel={`${label}: ${value}${extra ? ` ${extra}` : ''}`} style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Txt size="small" bold>{label}</Txt>
        <Txt size="small" bold color={extra ? k.gold : k.muted} style={{ fontVariant: ['tabular-nums'] }}>{extra ? `${value} · ${extra}` : value}</Txt>
      </View>
      {n !== undefined ? (
        <View style={{ height: 8, borderRadius: 4, backgroundColor: k.line, overflow: 'hidden', flexDirection: 'row' }}>
          <View style={{ width: `${pct}%`, backgroundColor: extra ? k.gold : k.tekhelet, borderRadius: 4 }} />
        </View>
      ) : null}
    </View>
  );
}

export function FitCard({ m, onPreview }: { m: Meters; onPreview: () => void }) {
  const { t } = useI18n();
  const k = useTokens();
  return (
    <Card edgeColor={m.fits ? k.olive : k.gold}>
      <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={m.fits ? 'check' : 'alert'} size={22} color={m.fits ? k.olive : k.gold} />
        <Txt bold color={m.fits ? k.olive : k.gold} style={{ flex: 1 }}>{m.fits ? t('sheetItems.fits') : t('sheetItems.over', { n: m.over })}</Txt>
        <Pressable accessibilityRole="link" accessibilityLabel={t('sheetItems.preview')} onPress={onPreview} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
          <Icon name="print" size={20} color={k.tekhelet} />
          <Txt bold color={k.tekhelet}>{t('sheetItems.preview')}</Txt>
        </Pressable>
      </View>
      <View style={{ gap: 10, marginTop: 4 }}>
        <Meter label={t('sheetItems.meter.mazal')} n={m.mazal.n} max={m.mazal.max} value={t('sheetItems.meter.of', { n: m.mazal.n, max: m.mazal.max })} />
        <Meter label={t('sheetItems.meter.events')} n={m.events.n} max={m.events.max} value={t('sheetItems.meter.of', { n: m.events.n, max: m.events.max })} />
        <Meter label={t('sheetItems.meter.image')} value={m.image ? t('sheetItems.meterHas') : t('sheetItems.meterNone')} />
      </View>
    </Card>
  );
}
