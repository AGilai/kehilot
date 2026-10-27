import type { AliyahCall, AliyahSlot, AliyahTemplate, RosterPerson } from './types.ts';
import { isYomKippur } from './dates.ts';
import type { AliyahService } from './types.ts';

export const MINYAN_OPTIONS = [{ value: '1', label: 'מניין ראשון' }, { value: '2', label: 'מניין שני' }];
export function minyanLabel(value: number): string {
  return MINYAN_OPTIONS.find(option => option.value === String(value))?.label || `מניין ${value}`;
}
export function serviceForDate(day: string, service: AliyahService): AliyahService {
  return isYomKippur(day) ? service : 'shacharit';
}

export const FESTIVAL_READINGS = ['א׳ ראש השנה', 'ב׳ ראש השנה', 'יום כיפור - שחרית', 'יום כיפור - מנחה', 'סוכות', 'שמיני עצרת ושמחת תורה', 'פסח', 'שביעי של פסח', 'שבועות'];

export function aliyahLabel(position: string): string {
  const match = /^ישראל ([1-9]\d*)$/.exec(position);
  if (!match) return position;
  const number = Number(match[1]) + 2;
  const ordinals = ['', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי'];
  if (number <= 10) return ordinals[number]!;
  const units = ['', 'אחד', 'שניים', 'שלושה', 'ארבעה', 'חמישה', 'שישה', 'שבעה', 'שמונה', 'תשעה'];
  if (number < 20) return `${number === 12 ? 'שנים' : units[number - 10]} עשר`;
  if (number === 100) return 'מאה';
  const tens = ['', '', 'עשרים', 'שלושים', 'ארבעים', 'חמישים', 'שישים', 'שבעים', 'שמונים', 'תשעים'];
  return number < 100 ? `${tens[Math.floor(number / 10)]}${number % 10 ? ` ו${units[number % 10]}` : ''}` : String(number);
}

export function aliyahSlots(template: AliyahTemplate, extras: number): AliyahSlot[] {
  if (!Number.isInteger(extras) || extras < 0 || extras > 100 - template.slots.length || (extras > 0 && !template.allowExtra)) throw new Error('מספר העליות הנוספות אינו תקין.');
  return [...template.slots.slice(0, -1), ...Array.from({ length: extras }, (_, index) => ({ position: `ישראל ${template.regularCount - 1 + index}`, tribe: null })), ...template.slots.slice(-1)];
}
export function aliyahChoices(slot: AliyahSlot, people: RosterPerson[]) {
  return [{ value: '', label: 'בחירת עולה' }, { value: 'guest', label: 'אורח' }, ...people.filter(person => !slot.tribe || person.tribe === slot.tribe).map(person => ({ value: `person:${person.id}`, label: person.name }))];
}
export function aliyahCalls(slots: AliyahSlot[], selected: Record<string, string>): AliyahCall[] {
  return slots.map(slot => {
    const value = selected[slot.position];
    if (!value) throw new Error(`יש לבחור עולה לעליית ${aliyahLabel(slot.position)}.`);
    if (value === 'guest') return { position: slot.position, guest: true };
    if (!value.startsWith('person:') || value.length === 7) throw new Error('יש לבחור מתפלל מהרשימה.');
    return { position: slot.position, personId: value.slice(7) };
  });
}
