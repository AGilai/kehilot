export function normalizeMobile(value: string): string | null {
  if (value.length > 40 || !/^[+0-9()\s-]+$/.test(value)) return null;
  let phone = value.replace(/[()\s-]/g, '');
  if (phone.startsWith('00972')) phone = '+' + phone.slice(2);
  if (/^05\d{8}$/.test(phone)) phone = '+972' + phone.slice(1);
  return /^\+9725\d{8}$/.test(phone) ? phone : null;
}
