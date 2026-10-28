import { formatCivilDate, israelDate } from './dates.ts';
import { escapeHtml, PRINT_MARGIN_MM } from './printLayout.ts';
import type { SeatMapCell, SeatMapLayout, SeatingMap } from './types.ts';

export const SEAT_MAP_SIDE_MARGIN_MM = 10;

export function uniformSeatLayout(layout: SeatMapLayout): SeatMapLayout {
  // Rounded source coordinates can describe the same edge a thousandth apart.
  const edges = [0, layout.width, ...layout.cells.flatMap(cell => [cell.x, cell.x + cell.width])]
    .sort((a, b) => a - b).filter((value, index, all) => index === 0 || value - all[index - 1]! > .01);
  const unit = layout.width / Math.max(1, edges.length - 1);
  const indexOf = (value: number) => edges.findIndex(edge => Math.abs(edge - value) <= .01);
  return { ...layout, cells: layout.cells.map(cell => ({ ...cell, x: indexOf(cell.x) * unit,
    width: (indexOf(cell.x + cell.width) - indexOf(cell.x)) * unit })) };
}

export function seatTextFit(label: string, width: number, font: number): { width: number; scaleX: number } {
  const available = Math.max(.1, width - .6);
  const textWidth = Math.max(available, label.length * font * .6);
  return { width: textWidth, scaleX: available / textWidth };
}
export function seatBackground(cell: SeatMapCell, available: boolean, freeColor = '#6AA84F'): string {
  return available ? freeColor : cell.kind === 'seat' ? '#FFFFFF' : cell.background;
}
export function seatBorders(cell: SeatMapCell): string {
  return ['top','right','bottom','left'].map((side, index) => `border-${side}:${cell.borders[index] ? '.4pt solid #222' : '0'}`).join(';');
}

export function seatingMapHtml(report: SeatingMap, nativeMargins = false): string {
  if (!report.layout || report.maps.length !== 2) throw new Error('מפת המקומות טרם נטענה.');
  const layout = uniformSeatLayout(report.layout);
  const width = 784, height = 180;
  const sx = width / layout.width, sy = height / layout.height;
  const maps = report.maps.map(map => {
    const states = new Map(map.cells.map(cell => [cell.cellId, cell]));
    const cells = layout.cells.map(cell => {
      const state = states.get(cell.id);
      if (!state) throw new Error('מפת המקומות אינה מלאה. יש לרענן.');
      const w = cell.width * sx, h = cell.height * sy;
      const font = cell.kind === 'label' ? 9 : 6;
      const fit = seatTextFit(state.label, w, font);
      return `<div class="cell" data-cell="${escapeHtml(cell.id)}" style="left:${cell.x*sx}pt;top:${cell.y*sy}pt;width:${w}pt;height:${h}pt;background:${seatBackground(cell, state.available, report.freeColor)};color:${cell.color};font-size:${font}pt;font-weight:${cell.bold ? 700 : 400};${seatBorders(cell)}"><span style="width:${fit.width}pt;transform:scaleX(${fit.scaleX})">${escapeHtml(state.label)}</span></div>`;
    }).join('');
    return `<section><h2>${escapeHtml(map.title)} · ${map.freeSeats} מקומות פנויים</h2><div class="map">${cells}</div></section>`;
  }).join('');
  const period = `${formatCivilDate(report.event.startsOn || report.event.date)}${report.event.endsOn && report.event.endsOn !== (report.event.startsOn || report.event.date) ? ' – '+formatCivilDate(report.event.endsOn) : ''}`;
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>מפת מקומות לשבת ולחג</title><style>
  @page{size:A4 landscape;margin:${nativeMargins ? 0 : PRINT_MARGIN_MM}mm ${nativeMargins ? 0 : SEAT_MAP_SIDE_MARGIN_MM}mm}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,"Noto Sans Hebrew",sans-serif;color:#182A23;width:784pt;font-size:8pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}header{height:30pt;display:flex;align-items:flex-start;justify-content:space-between;gap:8pt}h1{font-size:12pt;margin:0}header p{margin:0;font-size:8pt}section{height:201pt;break-inside:avoid;page-break-inside:avoid}h2{font-size:10pt;height:17pt;margin:0;line-height:14pt}.map{position:relative;direction:ltr;width:784pt;height:180pt}.cell{position:absolute;display:flex;align-items:center;justify-content:center;padding:0;text-align:center;direction:rtl;line-height:1.02;white-space:nowrap}.cell span{display:block;flex-shrink:0;transform-origin:center}footer{font-size:7pt;height:12pt;line-height:10pt;margin:0}
  </style></head><body><header><div><h1>מפת מקומות — ${escapeHtml(report.event.title)}</h1><p>${escapeHtml(period)}</p></div><p>ירוק — פנוי · ${escapeHtml(formatCivilDate(israelDate(new Date(report.generatedAt || Date.now()))))}</p></header>${maps}<footer>${report.warnings.length ? `${report.warnings.length} אזהרות שיוך — יש לבדוק באפליקציה לפני חלוקת המקומות.` : ''}</footer></body></html>`;
}
