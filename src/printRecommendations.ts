import { recommendationsHtml } from './recommendations';
import { printHtml } from './printHtml';
import type { AliyahRecommendations } from './types';

export async function printRecommendations(report: AliyahRecommendations): Promise<void> {
  await printHtml(nativeMargins => recommendationsHtml(report, nativeMargins));
}
