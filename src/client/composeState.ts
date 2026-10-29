// Pure helpers for Compose's template mode (UX-DESIGN §19.2 item 5, §19.3).
import { isManagement } from './roles.ts';
import { dualDate } from '../dates.ts';
import { eventChangeParts } from './messageView.ts';
import { TEMPLATES, buildMessage, dayLabel, missingFields } from './templates.ts';
import type { Lang, Message, MessageType, Role, TemplateFields, TemplateId } from './types.ts';

type Free = { title: string; body: string };
export type CopyState = Free & { lastCopied: Free | null };

/** Switching to free text: the built text goes into the free fields only when both are empty or still what the last copy put there. */
export function copyToFree(state: CopyState, built: Free): CopyState & { copied: boolean } {
  const last = state.lastCopied;
  const empty = !state.title.trim() && !state.body.trim();
  const untouched = !!last && state.title === last.title && state.body === last.body;
  if (!empty && !untouched) return { ...state, copied: false };
  return { title: built.title, body: built.body, lastCopied: { title: built.title, body: built.body }, copied: true };
}

/** What happens to the sheet line of this post: in at once (management, or a Kehila that lets members in) or after approval. */
export function sheetCaption(role: Role | undefined, sheetMembers: 'approve' | 'auto' | undefined, type: MessageType): 'sheetAuto' | 'sheetPending' | null {
  if (type !== 'event' && type !== 'celebration' && type !== 'condolence') return null;
  return isManagement(role) || sheetMembers === 'auto' ? 'sheetAuto' : 'sheetPending';
}

// Live preview ---------------------------------------------------------------------------------------------------
const SENTINEL_DAY = '2000-01-03';
export const gap = (label: string): string => `‹${label}›`;

/**
 * What the preview shows while fields are still empty: the built text with each missing field's name in ‹ › (the
 * preview draws it as a gold dashed chip as well, so colour is never the only cue). `label(key)` is the field's name.
 */
export function previewOf(id: TemplateId, f: TemplateFields, lang: Lang, label: (key: string) => string): { fields: TemplateFields; title: string; body: string; missing: string[]; scrub: (s: string) => string } {
  const missing = missingFields(id, f);
  const p: TemplateFields = { ...f };
  const dateKeys: string[] = [];
  for (const spec of TEMPLATES[id]) {
    if (!missing.includes(spec.key)) continue;
    if (spec.kind === 'chips') { p[spec.key] = spec.options![0]!; continue; }
    if (spec.kind === 'date') { p[spec.key] = SENTINEL_DAY; dateKeys.push(spec.key); } else p[spec.key] = gap(label(spec.key));
  }
  const dateLabel = dateKeys.length ? gap(label(dateKeys[0]!)) : '';
  const pairs: Array<[string, string]> = dateKeys.length ? [
    [`${dayLabel(SENTINEL_DAY, lang, 'long')}, ${dualDate(SENTINEL_DAY, lang)}`, dateLabel],
    [dualDate(SENTINEL_DAY, lang, { weekday: true }), dateLabel],
    [dualDate(SENTINEL_DAY, lang), dateLabel],
    [`· ${dayLabel(SENTINEL_DAY, lang, 'short')} `, `· ${dateLabel} `],
    [`${lang === 'he' ? 'עד' : 'until'} ${dayLabel(SENTINEL_DAY, lang, 'short')}`, `${lang === 'he' ? 'עד' : 'until'} ${dateLabel}`],
  ] : [];
  const scrub = (s: string) => pairs.reduce((acc, [a, b]) => acc.split(a).join(b), s);
  const built = buildMessage(id, p, lang);
  return { fields: p, title: scrub(built.title), body: scrub(built.body), missing, scrub };
}

/** A day in the date select: Hebrew first, the Gregorian date in brackets ("ב׳, כ״ט בחשוון (9.11)"). */
export const dayOptionLabel = (iso: string, lang: Lang): string => `${dayLabel(iso, lang, 'short')}, ${dualDate(iso, lang)}`;

/** The preview's ‹missing› markers removed, for text that is copied into the free fields. */
export const stripGaps = (s: string): string => s.replace(/‹[^›]*›/g, '');

// Update mode (§19.2a) ---------------------------------------------------------------------------------------------
/** The form's starting values when a posted condolence or event is updated; a condolence's variant is preset to "with shiva details". */
export function initialUpdateFields(m: Message): TemplateFields {
  if (m.templateId && m.fields) return m.templateId === 'condolence' ? { ...m.fields, variant: 'full' } : { ...m.fields };
  if (m.type === 'condolence') return { variant: 'full', surname: m.targetName ?? '' };
  return { name: m.title };
}

/**
 * The "let members know" toggle's default (owner ruling): on when shiva details are added (the variant goes to "full"
 * from another one), and when an event's date, time or place changes or it is cancelled; off for later corrections.
 */
export function notifyDefault(before: TemplateFields, after: TemplateFields, id: TemplateId): boolean {
  if (id === 'condolence') return after.variant === 'full' && before.variant !== 'full';
  if (id === 'event') {
    if (after.cancelled === true && before.cancelled !== true) return true;
    return (['date', 'time', 'place'] as const).some(key => (before[key] ?? '') !== (after[key] ?? ''));
  }
  return false;
}

/** What changed in an event, for the push text shape "שינוי ב{event}: {what}" ("בשעה 21:00"); `cancelled` is the word for a cancelled event. */
export function eventWhat(before: TemplateFields, after: TemplateFields, cancelled: string, lang: Lang): string {
  if (after.cancelled === true && before.cancelled !== true) return cancelled;
  const changed: Record<string, string> = {};
  for (const key of ['date', 'time', 'place'] as const) if (String(before[key] ?? '') !== String(after[key] ?? '') && before[key] !== undefined) changed[key] = String(before[key]);
  const parts = eventChangeParts({ type: 'event', fields: after, changed }, lang);
  return parts ? parts.filter(p => !p.struck).map(p => p.text).join('').replace(/\s+/g, ' ').trim() : '';
}
