// Getting the sheet onto paper (docs/UX-DESIGN.md §14.4). Web: the print page (a new tab showing only the sheet) and the browser's print dialog.
// Phone: expo-print makes a PDF from `sheetHtml` and expo-sharing offers it (print, WhatsApp, save).
import { Platform } from 'react-native';
import { sheetHtml } from './sheetHtml.ts';
import type { SheetModel } from './sheetModel.ts';
import { parsePrintRequest, printPageUrl } from './sheetSource.ts';
import type { PrintRequest } from './sheetSource.ts';

export type { PrintRequest };
export const currentPrintRequest = (): PrintRequest | null => (Platform.OS === 'web' && typeof window !== 'undefined' && window.location ? parsePrintRequest(window.location.search) : null);

/** Web: open the print page in a new tab (called from a tap, so the browser allows it). */
export function openPrintPage(weekIndex: 0 | 1): boolean {
  if (typeof window === 'undefined') return false;
  const opened = window.open(printPageUrl(window.location.search, window.location.pathname, weekIndex), '_blank');
  return !!opened;
}

/** A4 in CSS px at 96 dpi; the sheet is drawn at 595x842 pt, so it is scaled up for the printer. */
export const A4_PX = { w: 793.7, h: 1122.5 };
export const PRINT_SCALE = A4_PX.w / 595;
export const PRINT_CSS = `@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}#sheet-print-root{display:none}@media print{body>*:not(#sheet-print-root){display:none!important}#sheet-print-root{display:block!important;direction:ltr;width:${A4_PX.w}px;height:${A4_PX.h}px;overflow:hidden;break-after:avoid}#sheet-print-root>div{transform:scale(${PRINT_SCALE});transform-origin:top left;width:595px;height:842px;-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

/** Web: copy the sheet into a print-only root, hide everything else, open the print dialog, clean up afterwards. */
export function printSheetPage(): boolean {
  if (typeof document === 'undefined') return false;
  const page = document.querySelector('[data-sheet-page]') as HTMLElement | null;
  if (!page) return false;
  const style = document.createElement('style');
  style.textContent = PRINT_CSS;
  const root = document.createElement('div');
  root.id = 'sheet-print-root';
  const wrap = document.createElement('div');
  wrap.appendChild(page.cloneNode(true));
  root.appendChild(wrap);
  document.head.appendChild(style);
  document.body.appendChild(root);
  const done = () => { root.remove(); style.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  return true;
}

const FONT_FILES = (): Array<[string, number, number]> => [
  ['Heebo', 400, require('@expo-google-fonts/heebo/400Regular/Heebo_400Regular.ttf')],
  ['Heebo', 700, require('@expo-google-fonts/heebo/700Bold/Heebo_700Bold.ttf')],
  ['Heebo', 800, require('@expo-google-fonts/heebo/800ExtraBold/Heebo_800ExtraBold.ttf')],
  ['Noto Serif Hebrew', 500, require('@expo-google-fonts/noto-serif-hebrew/500Medium/NotoSerifHebrew_500Medium.ttf')],
  ['Noto Serif Hebrew', 800, require('@expo-google-fonts/noto-serif-hebrew/800ExtraBold/NotoSerifHebrew_800ExtraBold.ttf')],
];

/** @font-face rules with the sheet's fonts embedded (base64). Empty when they cannot be read: the PDF then uses system fonts. */
async function embeddedFontCss(): Promise<string> {
  try {
    const { Asset } = require('expo-asset') as typeof import('expo-asset');
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const rules = await Promise.all(FONT_FILES().map(async ([family, weight, module]) => {
      const asset = Asset.fromModule(module);
      await asset.downloadAsync();
      const data = await new File(asset.localUri!).base64();
      return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/ttf;base64,${data}) format('truetype')}`;
    }));
    return rules.join('');
  } catch { return ''; }
}

/** Phone: make the PDF and open the system share sheet. Throws when it cannot (the screen shows the retry Banner). */
export async function sharePdf(model: SheetModel): Promise<void> {
  const Print = require('expo-print') as typeof import('expo-print');
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  const size = model.variant === 'a4' ? { width: 595, height: 842 } : { width: 540, height: 540 };
  const { uri } = await Print.printToFileAsync({ html: sheetHtml(model, { fontCss: await embeddedFontCss() }), ...size });
  if (!(await Sharing.isAvailableAsync())) { await Print.printAsync({ uri }); return; }
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
