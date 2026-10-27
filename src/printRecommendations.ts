import { Platform } from 'react-native';
import { PRINT_MARGIN_MM, recommendationsHtml } from './recommendations';
import type { AliyahRecommendations } from './types';

export async function printRecommendations(report: AliyahRecommendations): Promise<void> {
  const html = recommendationsHtml(report, Platform.OS === 'ios');
  if (Platform.OS === 'web') {
    const preview = window.open('', '_blank');
    if (!preview) throw new Error('יש לאפשר פתיחת חלון להדפסת הדוח.');
    preview.document.open(); preview.document.write(html); preview.document.close();
    preview.focus();
    preview.setTimeout(() => preview.print(), 250);
    return;
  }
  const Print = await import('expo-print');
  try {
    const margin = PRINT_MARGIN_MM * 72 / 25.4;
    await Print.printAsync({ html, orientation: Print.Orientation.portrait, width: 595, height: 842,
      margins: { top: margin, right: margin, bottom: margin, left: margin } });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ERR_PRINT_INCOMPLETE')) throw error;
  }
}
