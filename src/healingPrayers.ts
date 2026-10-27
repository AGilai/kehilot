import { formatCivilDate, israelDate } from './dates.ts';
import type { HealingPrayer, HealingReminder } from './types.ts';

function addDays(value: string, count: number): string {
  const day = new Date(`${value}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + count);
  return day.toISOString().slice(0, 10);
}
function nextMonth(value: string): string {
  const day = new Date(`${value}T12:00:00Z`), originalDay = day.getUTCDate();
  day.setUTCDate(1); day.setUTCMonth(day.getUTCMonth() + 1);
  const last = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
  day.setUTCDate(Math.min(originalDay, last)); return day.toISOString().slice(0, 10);
}
export function demoHealingCycle(start: string, confirmed = false): HealingReminder {
  return { cycleId: `cycle-${Date.now()}-${Math.random().toString(36).slice(2)}`, startedOn: start,
    dueOn: addDays(start, 14), expiresOn: nextMonth(start), confirmedOn: confirmed ? start : null, pending: false };
}
export function refreshDemoHealing(entries: HealingPrayer[], now = new Date()): HealingPrayer[] {
  const today = israelDate(now);
  return entries.flatMap(entry => {
    const reminder = entry.reminder || demoHealingCycle(entry.addedOn);
    if (today >= reminder.expiresOn) return [];
    const pending = today >= reminder.dueOn;
    return [{ ...entry, reminder: { ...reminder, pending } }];
  });
}
export function keepDemoHealing(entry: HealingPrayer, cycleId: string, now = new Date()): HealingPrayer {
  const current = refreshDemoHealing([entry], now)[0];
  if (!current) throw new Error('השם כבר הוסר מהרשימה.');
  if (!current.reminder?.pending || current.reminder.cycleId !== cycleId) throw new Error('התזכורת כבר עודכנה. יש לרענן את הרשימה.');
  return { ...current, addedOn: israelDate(now), reminder: demoHealingCycle(israelDate(now), true) };
}

export function healingPrayerName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 200) throw new Error('יש להזין את שם החולה ושם האם, עד 200 תווים.');
  return name;
}

export function demoHealingPrayer(name: string, memberName: string, now = new Date()): HealingPrayer {
  return {
    id: `local-prayer-${now.getTime()}-${Math.random().toString(36).slice(2)}`,
    memberId: 'demo-member', memberName, name: healingPrayerName(name), addedOn: israelDate(now), reminder: demoHealingCycle(israelDate(now)),
  };
}

export function prayerAddedDate(date: string): string {
  return formatCivilDate(date);
}
