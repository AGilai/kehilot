import { Platform } from 'react-native';
import { PRINT_MARGIN_MM } from './printLayout';

// Open the browser window before an asynchronous refresh loses the click gesture.
export async function printHtml(createHtml: (nativeMargins: boolean) => string | Promise<string>, options: { orientation?: 'portrait' | 'landscape'; horizontalMarginMm?: number } = {}): Promise<void> {
  if (Platform.OS === 'web') {
    const preview = window.open('', '_blank');
    if (!preview) throw new Error('יש לאפשר פתיחת חלון להדפסת הדוח.');
    try {
      const html = await createHtml(false);
      if (preview.closed) return;
      preview.document.open(); preview.document.write(html); preview.document.close();
      preview.focus(); preview.setTimeout(() => preview.print(), 250);
    } catch (error) { preview.close(); throw error; }
    return;
  }
  const html = await createHtml(Platform.OS === 'ios');
  const Print = await import('expo-print');
  try {
    const margin = PRINT_MARGIN_MM * 72 / 25.4;
    const sideMargin = (options.horizontalMarginMm ?? PRINT_MARGIN_MM) * 72 / 25.4;
    const landscape = options.orientation === 'landscape';
    await Print.printAsync({ html, orientation: landscape ? Print.Orientation.landscape : Print.Orientation.portrait, width: landscape ? 842 : 595, height: landscape ? 595 : 842,
      margins: { top: margin, right: sideMargin, bottom: margin, left: sideMargin } });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ERR_PRINT_INCOMPLETE')) throw error;
  }
}
