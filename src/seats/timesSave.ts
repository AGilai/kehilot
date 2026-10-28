// Saving the form times: the write, the revert on refusal and the mapping of a refusal to its message. Pure, so tests/seatTimesSave.test.ts
// covers it with a fake `put`. The 409 `try_again` retry lives in src/client/http.ts; a `try_again` that gets here has already been retried.
import { neighbours, slotLabel } from './times.ts';
import type { SeatTimes, Which } from './times.ts';

export type TimesBody = { deadline?: string; reminders?: Partial<Record<'1' | '2', { on?: boolean; day?: 'thu' | 'fri'; time?: string }>> };
export type Failure = { code: string; field?: string };

/** One write. A refusal gives back `before` (the caller shows `failure`). */
export async function applyTimes(put: (body: TimesBody) => Promise<SeatTimes>, before: SeatTimes, body: TimesBody): Promise<{ times: SeatTimes; failure: Failure | null }> {
  try {
    return { times: await put(body), failure: null };
  } catch (e) {
    const x = (e ?? {}) as { code?: unknown; field?: unknown };
    return { times: before, failure: { code: typeof x.code === 'string' ? x.code : 'network', ...(typeof x.field === 'string' ? { field: x.field } : {}) } };
  }
}

/** The i18n key and params of a refusal about `which`, or null when the code has no special message. `reminder` is a key (the caller translates it). */
export function failMessage(times: SeatTimes, which: Which, f: Failure, lang: 'he' | 'en'): { key: string; params: Record<string, string> } | null {
  if (f.code === 'seat_reminder_after_deadline') {
    const n = (f.field?.match(/^reminders\.([12])$/)?.[1] as '1' | '2' | undefined) ?? (times.reminders['2'].on ? '2' : '1');
    return { key: 'admin.seats.errDeadline', params: { reminder: `admin.seats.r${n}`, when: slotLabel(times.reminders[n], lang) } };
  }
  if (f.code === 'seat_times_order') {
    const n = neighbours(times, which);
    return n.next
      ? { key: 'admin.seats.errOrder', params: { prev: slotLabel(n.prev, lang), next: slotLabel(n.next, lang) } }
      : { key: 'admin.seats.errAfter', params: { prev: slotLabel(n.prev, lang) } };
  }
  return null;
}
