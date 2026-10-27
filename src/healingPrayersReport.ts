import { formatCivilDate, israelDate } from './dates.ts';
import { escapeHtml, PRINT_MARGIN_MM } from './printLayout.ts';
import type { HealingPrayer } from './types.ts';

export function healingPrayersHtml(entries: HealingPrayer[], nativeMargins = false, now = new Date()): string {
  const names = entries.map(entry => `<li>${escapeHtml(entry.name).replace(/\n/g, '<br>')}</li>`).join('');
  const count = entries.length === 1 ? 'שם אחד' : `${entries.length} שמות`;
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>מי שברך לחולים</title><style>
    @page{size:A4 portrait;margin:${nativeMargins ? 0 : PRINT_MARGIN_MM}mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,"Noto Sans Hebrew",sans-serif;direction:rtl;color:#213D35;font-size:12pt;line-height:1.35}h1{font-size:19pt;margin:0 0 6pt}.meta{font-size:9pt;color:#66746C;margin:0 0 14pt}ol{padding-right:24pt;padding-left:0;margin:0}li{padding:3pt 0;overflow-wrap:anywhere;break-inside:avoid;page-break-inside:avoid}@media screen{body{max-width:760px;margin:24px auto;padding:0 20px}}
    </style></head><body><h1>מי שברך לחולים</h1><p class="meta">${escapeHtml(formatCivilDate(israelDate(now)))} · ${count}</p>${entries.length ? `<ol>${names}</ol>` : '<p>אין כרגע שמות למי שברך לחולים.</p>'}</body></html>`;
}
