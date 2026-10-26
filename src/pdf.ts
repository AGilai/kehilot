import { Platform } from 'react-native';
import { API_URL, ApiError } from './api';
import type { PdfAttachment } from './types';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
async function pickDocument(kind: 'pdf' | 'xlsx'): Promise<{ name: string; base64: string; size: number } | null> {
  const picker = await import('expo-document-picker');
  const maximum = kind === 'pdf' ? MAX_PDF_BYTES : 5 * 1024 * 1024;
  const sizeError = kind === 'pdf' ? 'גודל הקובץ המרבי הוא 10MB.' : 'גודל הקובץ המרבי הוא 5MB.';
  const result = await picker.getDocumentAsync({ type: kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', multiple: false, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0]!;
  if (!asset.name.toLowerCase().endsWith('.' + kind)) throw new Error(kind === 'pdf' ? 'יש לבחור קובץ PDF.' : 'יש לבחור קובץ ‎.xlsx.');
  if ((asset.size || 0) > maximum) throw new Error(sizeError);
  let encoded: string;
  if (Platform.OS === 'web') {
    const blob = asset.file || await (await fetch(asset.uri)).blob();
    encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]!);
      reader.onerror = () => reject(new Error('לא ניתן לקרוא את הקובץ.'));
      reader.readAsDataURL(blob);
    });
  } else {
    const fs = await import('expo-file-system/legacy');
    encoded = await fs.readAsStringAsync(asset.uri, { encoding: fs.EncodingType.Base64 });
  }
  if (encoded.length > Math.ceil(maximum / 3) * 4) throw new Error(sizeError);
  return { name: asset.name, base64: encoded, size: asset.size || Math.floor(encoded.length * 3 / 4) };
}

export const pickPdf = () => pickDocument('pdf');
export const pickSpreadsheet = () => pickDocument('xlsx');

export async function openPdf(attachment: PdfAttachment, token: string) {
  const url = `${API_URL}/api/documents/${encodeURIComponent(attachment.id)}`;
  if (Platform.OS === 'web') {
    const preview = window.open('', '_blank');
    if (!preview) throw new Error('יש לאפשר פתיחת חלון לצפייה בקובץ.');
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new ApiError('לא ניתן לטעון את הקובץ.', response.status);
      const objectUrl = URL.createObjectURL(await response.blob());
      preview.location.href = objectUrl;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) { preview.close(); throw error; }
    return;
  }
  const fs = await import('expo-file-system/legacy');
  const sharing = await import('expo-sharing');
  if (!await sharing.isAvailableAsync()) throw new Error('פתיחת קבצים אינה זמינה במכשיר זה.');
  const downloaded = await fs.downloadAsync(url, `${fs.cacheDirectory}${attachment.id}.pdf`, { headers: { Authorization: `Bearer ${token}` } });
  if (downloaded.status !== 200) {
    await fs.deleteAsync(downloaded.uri, { idempotent: true });
    throw new Error('לא ניתן לטעון את קובץ הלו״ז.');
  }
  await sharing.shareAsync(downloaded.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: attachment.name });
}
