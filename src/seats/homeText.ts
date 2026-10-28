import { dayTime } from './window.ts';
import type { RowState, Summary } from './wire.ts';

type T = (key: string, params?: Record<string, string | number>) => string;
type Parts = { day: string; time: string };

/** The answer in the fewest words (UX §21.2): everyone's coming, not coming, n free for others, or all seats kept. */
export function summaryText(s: Summary, t: T): string {
  return s.kind === 'all' ? t('seats.row.sumAll') : s.kind === 'none' ? t('seats.row.sumNone') : s.kind === 'free' ? t('seats.row.sumFree', { n: s.n }) : t('seats.row.sumKept');
}

/** `{day}` and `{time}` of the row copy: the short weekday and the time ("יום ו׳" / "14:00"). */
export function rowWhen(at: Date, lang: 'he' | 'en'): Parts {
  const [day, time] = dayTime(at, lang).split(' ') as [string, string];
  return { day: day.replace(/ /g, '\u00a0'), time };
}

/** The row's status line (UX §21.2 / §21.7). */
export function rowStatus(m: { state: RowState; summary: Summary; deadline: Date }, t: T, lang: 'he' | 'en'): string {
  const when = rowWhen(m.deadline, lang);
  switch (m.state) {
    case 'open': return t('seats.row.open', when);
    case 'answered': return t('seats.row.answered', { summary: summaryText(m.summary, t), ...when });
    case 'byGabbai': return t('seats.row.byGabbai', when);
    case 'closed': return t('seats.row.closed', { summary: summaryText(m.summary, t) });
    case 'none': return t('seats.row.none');
  }
}

/** The closed card's last line: what the family sent, or that nothing was sent (P38 wording). */
export function closedCardText(summary: Summary, t: T): string {
  return summary.kind === 'kept' ? t('seats.card.closedNone') : t('seats.card.closedSent', { summary: summaryText(summary, t) });
}
