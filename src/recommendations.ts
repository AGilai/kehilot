import { formatCivilDate } from './dates.ts';
import type { AliyahRecommendations, RecommendationPerson } from './types.ts';

export const PRINT_MARGIN_MM = 15;
export const REPORT_COLUMNS = ['מעמד', 'שם פרטי ומשפחה', 'שם לעלייה לתורה', 'שם האישה למי שברך', 'סטטוס', 'מספר עליות', 'אירוע'];
export function recommendationColumns(sectionId: string): string[] {
  return [...REPORT_COLUMNS.slice(0, -1), sectionId === 'events' ? 'אירוע' : 'עלייה אחרונה'];
}
export const TRIBE_BACKGROUNDS = { kohen: '#E9F2FA', levi: '#F4EEDC', yisrael: '#FFFFFF', '': '#FFFFFF' };
export function classificationLabel(value: string): string {
  return value === 'א' ? 'דור א׳' : value === 'דור ב' ? 'דור ב׳' : value === 'דור ב-נשוי' ? 'דור ב׳-נשוי' : value || 'לא הוגדר';
}
export function recommendationCells(person: RecommendationPerson, sectionId = 'events'): string[] {
  return [({ kohen: 'כהן', levi: 'לוי', yisrael: 'ישראל', '': 'לא הוגדר' })[person.tribe], person.name,
    person.torahName || '—', person.wifePrayerName || '—', classificationLabel(person.classification),
    person.aliyahCount === null ? '—' : String(person.aliyahCount), sectionId === 'events' ? person.events.map(event => event.description).join('\n') || '—' : person.lastAliyah || 'לא נמצא'];
}
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
// iOS reserves the page margins in its native renderer; avoid applying them twice.
export function recommendationsHtml(report: AliyahRecommendations, nativeMargins = false): string {
  const sections = report.sections.map(section => `<section><h2>${escapeHtml(section.title)}</h2><table dir="rtl"><colgroup><col style="width:5%"><col style="width:18%"><col style="width:20%"><col style="width:18%"><col style="width:9%"><col style="width:5%"><col style="width:25%"></colgroup><thead><tr>${recommendationColumns(section.id).map(label => `<th scope="col">${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody>${section.people.length ? section.people.map(person => `<tr style="background:${TRIBE_BACKGROUNDS[person.tribe]}">${recommendationCells(person, section.id).map(value => `<td>${escapeHtml(value).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="7">אין מתפללים מתאימים ברשימה זו.</td></tr>'}</tbody></table></section>`).join('');
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.service.title)}</title><style>
    @page{size:A4 portrait;margin:${nativeMargins ? 0 : PRINT_MARGIN_MM}mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,"Noto Sans Hebrew",sans-serif;color:#172D25;font-size:7.5pt;line-height:1.1;direction:rtl}h1{font-size:12pt;margin:0 0 3pt}h2{font-size:9pt;margin:5pt 0 2pt;break-after:avoid}p{margin:2pt 0}table{width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:0.5pt solid #B9C6BE;padding:0.75pt 1.5pt;text-align:right;vertical-align:top;overflow-wrap:anywhere}th{background:#245E4F;color:white;font-weight:bold}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}section{margin-bottom:5pt}.notes{font-size:6.5pt;color:#4B5D53;margin-top:6pt}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}@media screen{body{max-width:760px;margin:24px auto;padding:0 16px}}
    </style></head><body><h1>${escapeHtml(report.service.title)}</h1><p>${escapeHtml(report.service.hebrewDate)} · ${escapeHtml(formatCivilDate(report.service.date))}</p>${sections}<div class="notes">${report.notes.map(note => `<p>${escapeHtml(note)}</p>`).join('')}</div></body></html>`;
}
