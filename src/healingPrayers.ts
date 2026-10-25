import { israelDate } from './dates.ts';
import type { HealingPrayer } from './types.ts';

export function healingPrayerName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 200) throw new Error('יש להזין את שם החולה ושם האם, עד 200 תווים.');
  return name;
}

export function demoHealingPrayer(name: string, memberName: string, now = new Date()): HealingPrayer {
  return {
    id: `local-prayer-${now.getTime()}-${Math.random().toString(36).slice(2)}`,
    memberId: 'demo-member', memberName, name: healingPrayerName(name), addedOn: israelDate(now),
  };
}

export function prayerAddedDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}
