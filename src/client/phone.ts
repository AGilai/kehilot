/** Phone numbers: the same rules and cases as server/cloud/phones.py (E.164 out). */

const MAX_RAW = 32;
const ISRAELI = /^(?:[57]\d{8}|[23489]\d{7})$/;
const OTHER = /^[1-9]\d{7,14}$/;
const DIGITS = /^[0-9]+$/;

/** E.164 string for an Israeli (local or +972) or international number, or null. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' || [...raw].length > MAX_RAW) return null;
  let text = raw.replace(/[ \-().]/g, '');
  if (text.startsWith('00')) text = '+' + text.slice(2);
  if (text.startsWith('+')) {
    const digits = text.slice(1);
    if (!DIGITS.test(digits)) return null;
    if (digits.startsWith('972')) {
      let national = digits.slice(3);
      if (national.startsWith('0')) national = national.slice(1);
      return ISRAELI.test(national) ? `+972${national}` : null;
    }
    return OTHER.test(digits) ? `+${digits}` : null;
  }
  if (text.startsWith('0') && DIGITS.test(text) && ISRAELI.test(text.slice(1))) return `+972${text.slice(1)}`;
  return null;
}

/** +9725XXXXXXXX -> 05X-XXXXXXX, +9727... -> 07X-XXXXXXX, +972 landline -> 0X-XXXXXXX; others unchanged. */
export function formatPhone(e164: string): string {
  if (e164.startsWith('+972')) {
    const national = e164.slice(4);
    if (/^[57]\d{8}$/.test(national)) return `0${national.slice(0, 2)}-${national.slice(2)}`;
    if (/^[23489]\d{7}$/.test(national)) return `0${national[0]}-${national.slice(1)}`;
  }
  return e164;
}

export const telUrl = (e164: string): string => `tel:${e164}`;
export const whatsappUrl = (e164: string): string => `https://wa.me/${e164.replace(/^\+/, '')}`;
