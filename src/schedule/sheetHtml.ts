// The sheet as a standalone HTML document for the phone's PDF (expo-print). Same model, fit and layout numbers as Sheet.tsx, so the
// two look alike. Every piece of text goes through `esc`; images only as data: or https: URLs.
import { PAPER, SHEET_TEXT, rangeParts, fitSheet, innerBox, placement, sheetLayout, shownItems, squareBandParts } from './sheetModel.ts';
import type { SheetLineItem, SheetColumn, SheetFit, SheetModel, SheetRow } from './sheetModel.ts';

export function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SAFE_IMAGE = /^(data:image\/(png|jpeg|webp|svg\+xml)[;,][^\s"'<>]*|https:\/\/[^\s"'<>]+)$/i;
/** The URL itself when it is a data: or https: image, else ''. For React Native images. */
export function allowedImage(uri: string | null | undefined): string {
  return uri && SAFE_IMAGE.test(uri) ? uri : '';
}
/** An attribute-safe image URL for HTML, or '' when the value is not a data: or https: image. */
export function safeImage(uri: string | null | undefined): string {
  return esc(allowedImage(uri));
}

const FONT_SERIF = "'Noto Serif Hebrew','Noto Serif',serif";
const FONT_UI = "'Heebo','Arial Hebrew',Arial,sans-serif";

function rowHtml(row: SheetRow): string {
  const gap = row.gap ? ' gap' : '';
  if (row.kind === 'text') return `<div class="tx${gap}${row.override ? ' ovr' : ''}">${esc(row.label)}${row.override ? ' *' : ''}</div>`;
  return `<div class="r${gap}${row.override ? ' ovr' : ''}"><span>${esc(row.label)}${row.override ? ' *' : ''}</span><i></i><b dir="ltr">${esc(row.time)}</b></div>`;
}

function columnHtml(column: SheetColumn | null): string {
  if (!column) return '<div></div>';
  const b = column.band;
  const band = !b ? '' : b.kind === 'candles'
    ? `<div class="cand">${esc(b.label)} · ${b.cities.map(c => `${c.name ? `${esc(c.name)} ` : ''}<b dir="ltr">${esc(c.time)}</b>`).join(' · ')}</div>`
    : `<div class="cand">${esc(b.days)} · <b>${(r => `${esc(r.heb)} <bdi dir="ltr" style="white-space:nowrap">${esc(r.greg)}</bdi>`)(rangeParts(b.range))}</b></div>`;
  return `<div><h2>${esc(column.title)}</h2>${band}${column.rows.map(rowHtml).join('')}</div>`;
}

const partsHtml = (parts: Array<{ text: string; bold: boolean }>) => parts.map(p => (p.bold ? `<b>${esc(p.text)}</b>` : esc(p.text))).join('');
const mazalTitle = (item: SheetLineItem) => partsHtml(item.main);
const ICON = {
  heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
  star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5l-5.3 2.9 1.2-6-4.5-4.1 6-.7z"/>',
} as const;
/** A mazal tov or condolence line: main (surname bold), sub and blessing on their own lines, the icon under them (none for a condolence). */
const mazalLine = (i: SheetLineItem, blessings: boolean) =>
  `<div class="mt mz">${mazalTitle(i)}${i.sub ? `<br>${esc(i.sub)}` : ''}${blessings && i.blessing ? `<br><span class="bl">${esc(i.blessing)}</span>` : ''}${i.icon ? `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON[i.icon]}</svg>` : ''}</div>`;
/** An event line: tekhelet-bold name; a cancelled one is struck and followed by the word "בוטל". */
const eventLine = (i: SheetLineItem) => `<div class="mt ev">${i.cancelled ? `<span class="cx">${mazalTitle(i)}</span> <span class="cxw">${esc(SHEET_TEXT.cancelled)}</span>` : mazalTitle(i)}</div>`;
const ornament = '<div class="orn"><i></i><i></i><i></i></div>';

function logoHtml(model: SheetModel): string {
  const src = safeImage(model.logoUri);
  return src ? `<div class="logo" style="background:#fff;padding:2px;border:1px solid ${PAPER.line}"><img src="${src}" alt=""></div>` : `<div class="logo ph">${esc(model.initial)}</div>`;
}

/** The sheet's own markup and style. `fit` defaults to the fitting rules applied to `model`. */
export function sheetBodyHtml(model: SheetModel, fit: SheetFit = fitSheet(model)): string {
  const L = sheetLayout(model.variant, fit);
  const inner = innerBox(model.variant, fit);
  const a = model.variant === 'a4';
  const footTop = a ? '8px' : shownItems(model, fit).mazal.length > 0 ? '6px' : 'auto';
  const css = `
.sht{--tek:${PAPER.tek};--ink:${PAPER.ink};--soft:${PAPER.soft};--line:${PAPER.line};--pom:${PAPER.pom};--mute:${PAPER.mute};--paper:${PAPER.paper};
 width:${L.w}px;height:${L.h}px;background:var(--paper);color:var(--ink);font-family:${FONT_UI};position:relative;
 padding:${L.padTop}px ${L.padSide}px ${L.padBottom}px;direction:rtl;overflow:hidden;box-sizing:border-box}
.in{display:flex;flex-direction:column;width:${inner.w}px;height:${inner.h}px;${fit.scale < 1 ? `transform:scale(${fit.scale});transform-origin:top right;` : ''}}
.sht *{box-sizing:border-box}
.sht::before{content:"";position:absolute;inset:${L.frameInset}px;border:1px solid var(--line);border-radius:6px}
.shd{display:flex;align-items:center;gap:${a ? 16 : 10}px;padding-bottom:${a ? 10 : 4}px}
.logo{width:${L.logo}px;height:${L.logo}px;flex:none;border-radius:10px;display:grid;place-items:center;overflow:hidden;background:#fff}
.logo img{width:100%;height:100%;object-fit:contain}
.logo.ph{border:1.5px solid var(--tek);color:var(--tek);font-family:${FONT_SERIF};font-weight:800;font-size:${a ? 30 : 20}px;position:relative}
.logo.ph::before,.logo.ph::after{content:"";position:absolute;left:${a ? 10 : 7}px;right:${a ? 10 : 7}px;height:2px;background:var(--tek);opacity:.5}
.logo.ph::before{top:${a ? 9 : 6}px}.logo.ph::after{bottom:${a ? 9 : 6}px}
.tt{flex:1;text-align:center}
h1{margin:0;font-family:${FONT_SERIF};font-weight:500;font-size:${L.titleSize}px;line-height:1.1;color:var(--tek)}
h1 b{font-weight:800}
.hdate{font-size:${L.hdateSize}px;color:var(--mute);margin-top:${a ? 4 : 2}px}
.kn{width:${L.logo}px;flex:none;font-size:${a ? 10 : 9}px;color:var(--mute);text-align:center;line-height:1.3}
.rule{height:7px;border-top:2px solid var(--tek);border-bottom:2px solid var(--tek);position:relative;margin:2px 0 ${a ? 14 : 8}px;flex:none}
.rule::after{content:"";position:absolute;left:0;right:0;top:1.5px;height:1px;background:var(--tek);opacity:.45}
.cols,.bottom{display:grid;grid-template-columns:1fr ${L.spine}px 1fr;column-gap:${L.colGap}px;flex:none}
.spine{position:relative;display:flex;justify-content:center}
.spine::before{content:"";position:absolute;top:6px;bottom:6px;width:6px;border-left:2px solid var(--tek);border-right:2px solid var(--tek)}
.spine i{position:absolute;width:10px;height:10px;background:var(--paper);border:2px solid var(--tek);transform:rotate(45deg)}
.spine i:nth-child(1){top:0}.spine i:nth-child(2){top:calc(50% - 5px)}.spine i:nth-child(3){bottom:0}
h2{margin:0 0 4px;font-family:${FONT_SERIF};font-size:${L.h2Size}px;font-weight:800;color:var(--tek);text-align:center}
.cand{text-align:center;font-size:${L.bandSize}px;margin-bottom:${a ? 8 : 4}px;padding:${a ? 5 : 3}px 0;border-radius:6px;background:var(--soft)}
.cand b{font-size:${L.bandTimeSize}px;font-variant-numeric:tabular-nums}
.r{display:flex;align-items:baseline;gap:6px;font-size:${L.rowFont}px;line-height:${1.35};padding:${L.rowPad}px 0}
.r i{order:2;flex:1;min-width:14px;border-bottom:1.5px dotted var(--line);margin-bottom:${a ? 4 : 3}px}
.r b{order:3;font-variant-numeric:tabular-nums;font-size:${L.timeFont}px;font-weight:700;white-space:nowrap}
.gap{margin-top:${L.gap}px}
.ovr b,.tx.ovr{color:var(--tek)}.ovr span{color:var(--ink)}
.tx{font-size:${L.textFont}px;text-align:center;color:var(--mute);padding:2px 8px 4px;line-height:1.35}
.orn{display:flex;align-items:center;gap:6px;margin:12px 0 8px;color:var(--tek)}
.orn::before,.orn::after{content:"";flex:1;height:0;border-top:1.5px solid var(--line)}
.orn i{width:6px;height:6px;transform:rotate(45deg);background:var(--tek)}
.orn i:nth-child(2){width:8px;height:8px;background:var(--pom)}
.bottom{flex:1;min-height:0;margin-top:4px;align-content:start}
.span{grid-column:1 / 4}
.mt{font-size:${L.mazalFont}px;text-align:center;line-height:1.45;padding:2px 4px}
.mt b{font-weight:800}
.mz b{color:var(--pom)}.ev b{color:var(--tek)}
.mt .bl{color:var(--mute)}
.mt .ic{display:block;margin:2px auto 0;width:16px;height:16px;color:var(--pom);fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.mt+.mt{margin-top:8px;padding-top:8px;border-top:1px dotted var(--line)}
.note+.mt{margin-top:8px}
.mt.mo{font-size:9.5px;color:var(--mute);border-top:0;margin-top:4px;padding-top:0}
.cx{text-decoration:line-through}.cxw{font-weight:700;color:var(--pom)}
.note{border:1.5px solid var(--tek);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;align-self:start}
.note .img{aspect-ratio:4/3;background:var(--soft);display:grid;place-items:center;overflow:hidden}
.note .img img{width:100%;height:100%;object-fit:cover}
.note .cap{padding:6px 8px;text-align:center;font-size:11px;line-height:1.35}
.note .cap b{display:block;font-family:${FONT_SERIF};font-size:17px;color:var(--tek);font-weight:700}
.mtband{margin-top:auto;border-top:2px solid var(--tek);padding-top:6px;font-size:${L.mazalFont}px;text-align:center;line-height:1.45}
.mtband b{color:var(--pom);font-weight:800}
.ft{display:flex;justify-content:space-between;font-size:${L.footFont}px;color:var(--mute);padding-top:${a ? 6 : 4}px;border-top:1px solid var(--line);margin-top:${footTop};flex:none}
.ft .ovk{color:var(--tek)}`;

  const shown = shownItems(model, fit);
  const items = shown.mazal;
  const pinned = model.pinned;
  const image = pinned && !fit.dropImage ? safeImage(pinned.imageUri) : '';
  let bottom = '';
  if (a) {
    const place = placement(model, fit);
    const noteBox = place.note && pinned
      ? `<div class="note">${image ? `<div class="img" style="width:${fit.imageScale * 100}%;margin:0 auto"><img src="${image}" alt=""></div>` : ''}${pinned.title || pinned.line ? `<div class="cap">${pinned.title ? `<b>${esc(pinned.title)}</b>` : ''}${pinned.line ? esc(pinned.line) : ''}</div>` : ''}</div>`
      : '';
    const startBox = noteBox + shown.events.map(eventLine).join('');
    const more = fit.more > 0 ? `<div class="mt mo">${esc(SHEET_TEXT.more.replace('{n}', String(fit.more)))}</div>` : '';
    const mazalBox = items.map(i => mazalLine(i, !fit.dropBlessings)).join('') + more;
    if (!place.mazalSpansBoth) bottom = `<div class="bottom"><div>${ornament}${startBox}</div><div></div><div>${mazalBox ? ornament + mazalBox : ''}</div></div>`;
    else bottom = `<div class="bottom"><div class="span">${ornament}${mazalBox}</div></div>`;
  } else if (items.length) {
    bottom = `<div class="mtband">${partsHtml(squareBandParts(items))}</div>`;
  }

  const title = model.parasha ? `${esc(SHEET_TEXT.title)} <b>${esc(model.parasha)}</b>` : esc(SHEET_TEXT.titleNoParasha);
  const kn = model.kehilaName ? `<div class="kn">${esc(SHEET_TEXT.kehila)}<br><b>${esc(model.kehilaName.replace(/^קהילת\s+/, ''))}</b></div>` : '<div class="kn"></div>';
  return `<style>${css}</style><div class="sht" data-variant="${model.variant}"><div class="in">
<div class="shd">${logoHtml(model)}<div class="tt"><h1>${title}</h1><div class="hdate">${esc(model.hebrewDate)}</div></div>${kn}</div>
<div class="rule"></div>
<div class="cols">${columnHtml(model.shabbat)}<div class="spine"><i></i><i></i><i></i></div>${columnHtml(model.weekday)}</div>
${bottom}
<div class="ft"><span class="ovk">${model.footnote ? esc(SHEET_TEXT.footnote) : ''}</span><span>${esc(SHEET_TEXT.blessing)}</span></div>
</div></div>`;
}

/** A full document for `Print.printToFileAsync({ html, width, height })`. `fontCss` carries @font-face rules (embedded fonts) when available. */
export function sheetHtml(model: SheetModel, opts: { fontCss?: string; fit?: SheetFit } = {}): string {
  const L = sheetLayout(model.variant, opts.fit ?? fitSheet(model));
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=${L.w}">
<style>${opts.fontCss ?? ''}@page{size:${L.w}px ${L.h}px;margin:0}html,body{margin:0;padding:0;background:#fff}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head>
<body>${sheetBodyHtml(model, opts.fit)}</body></html>`;
}
