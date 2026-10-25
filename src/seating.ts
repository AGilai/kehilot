import { HDate } from '@hebcal/hdate';
import { civilDate, israelDate } from './dates.ts';
import type { PrayerSeats, SeatReport, SeatingStatus } from './types.ts';

export function seatOptions(allocation: number) {
  return Array.from({ length: allocation + 1 }, (_, value) => ({ value: String(value), label: String(value) }));
}
export function seatContextKey(status: SeatingStatus) {
  return `${status.event.id}:${status.event.revision}:${status.event.mode}:${status.allocatedSeats}:${status.allocationRevision}`;
}
export function initialSeatValue(status: SeatingStatus, prayer: keyof PrayerSeats): string {
  return status.reported && status.value !== null ? String(status.value[prayer]) : status.event.mode === 'unused' ? '0' : '';
}
export function seatReport(status: SeatingStatus, value: PrayerSeats): SeatReport {
  if (!status.eligible || status.allocatedSeats === null || status.allocationRevision === null) throw new Error('טרם הוגדרה מכסת מקומות למשפחה. יש לפנות לגבאי.');
  if (!status.event.reportingOpen) throw new Error('הדיווח לאירוע זה נסגר.');
  if (['arvit', 'shacharit'].some(prayer => { const count = value[prayer as keyof PrayerSeats]; return !Number.isInteger(count) || count < 0 || count > status.allocatedSeats!; })) throw new Error('יש לבחור מספר מקומות מתוך המכסה המשפחתית.');
  return { eventId: status.event.id, revision: status.event.revision, mode: status.event.mode, allocatedSeats: status.allocatedSeats, allocationRevision: status.allocationRevision, arvit: value.arvit, shacharit: value.shacharit };
}

// Fictional four-seat household for local demo only. Real allocations always
// come from the authenticated server and cannot be changed through the profile.
export function demoSeating(now = new Date(), previous?: SeatingStatus | null): SeatingStatus {
  const today = israelDate(now);
  const saturday = civilDate(today);
  if (previous?.event.date !== today) saturday.setUTCDate(saturday.getUTCDate() + ((6 - saturday.getUTCDay() + 7) % 7 || 7));
  const date = saturday.toISOString().slice(0, 10);
  const hebrew = new HDate(new Date(`${date}T12:00:00`));
  const purim = new HDate(14, HDate.isLeapYear(hebrew.getFullYear()) ? 13 : 12, hebrew.getFullYear());
  const highHolidays = hebrew.getMonth() === 7 && [1, 2, 10].includes(hebrew.getDate());
  const zachor = purim.abs() - hebrew.abs() > 0 && purim.abs() - hebrew.abs() < 7;
  const special = highHolidays || zachor;
  const mode = special ? 'needed' : 'unused';
  const reportingOpen = date > today;
  if (previous?.event.id === `weekly-${date}` && previous.event.mode === mode && previous.allocatedSeats === 4 && previous.allocationRevision === 1) {
    return previous.event.reportingOpen === reportingOpen ? previous : { ...previous, event: { ...previous.event, reportingOpen } };
  }
  return {
    event: { id: `weekly-${date}`, date, title: highHolidays ? hebrew.getDate() === 10 ? 'יום כיפור' : 'ראש השנה' : zachor ? 'שבת זכור' : 'שבת הקרובה', parasha: null, mode, occasion: highHolidays ? 'high_holidays' : zachor ? 'zachor' : 'shabbat', revision: 1, reportingOpen, configuredOpen: true, closesAt: null, isCurrent: true, automatic: true },
    eligible: true, allocatedSeats: 4, allocationRevision: 1, reported: false, value: null,
    neededSeats: { arvit: mode === 'unused' ? 4 : 0, shacharit: mode === 'unused' ? 4 : 0 }, releasedSeats: { arvit: mode === 'unused' ? 0 : 4, shacharit: mode === 'unused' ? 0 : 4 }, reportInvalidated: false, updatedAt: null,
  };
}

export function demoSeatReport(current: SeatingStatus, expected: SeatingStatus, value: PrayerSeats, now = new Date()): SeatingStatus {
  if (seatContextKey(current) !== seatContextKey(expected)) throw new Error('פרטי הדיווח השתנו. יש לרענן ולבחור שוב.');
  const payload = seatReport(current, value);
  const needed = { arvit: payload.mode === 'unused' ? payload.allocatedSeats - value.arvit : value.arvit, shacharit: payload.mode === 'unused' ? payload.allocatedSeats - value.shacharit : value.shacharit };
  return { ...current, reported: true, value, neededSeats: needed, releasedSeats: { arvit: payload.allocatedSeats - needed.arvit, shacharit: payload.allocatedSeats - needed.shacharit }, reportInvalidated: false, updatedAt: now.toISOString() };
}
