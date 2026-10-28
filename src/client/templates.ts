// Message templates (UX-DESIGN §19.2, §19.2a, §19.3): the field schemas, the text a template builds, and the weekly
// sheet line. Pure functions. The keys and requirements are the contract with server/cloud/message_fields.py.
// Built text is filled with a raw `fill()`: it is stored in a message and printed, so it carries no bidi isolates.
import he from '../i18n/he.json' with { type: 'json' };
import en from '../i18n/en.json' with { type: 'json' };
import { translate } from '../i18n/translate.ts';
import type { Dict } from '../i18n/translate.ts';
import { dayOfWeek, dualDate } from '../dates.ts';
import { mazalParts } from '../schedule/sheetModel.ts';
import type { MazalPart } from '../schedule/sheetModel.ts';
import type { Lang, Message, MessageType, TemplateFields, TemplateId } from './types.ts';

export type FieldSpec = {
  key: string;
  kind: 'text' | 'long' | 'date' | 'time' | 'chips' | 'family';
  required: boolean;
  options?: string[];
  labelKey: string;
  requiredWhen?: (f: TemplateFields) => boolean;
  showWhen?: (f: TemplateFields) => boolean;
  /** Date fields: how many days the select offers, from today. */
  days?: number;
};

const is = (key: string, value: string) => (f: TemplateFields) => f[key] === value;
const OCCASIONS = ['birthSon', 'birthDaughter', 'barMitzvah', 'batMitzvah', 'engagement', 'wedding', 'other'];

/** Form order, §19.2. `cancelled` (event update toggle) and `firstNames` (filled by the family picker with `surname`) are not rows. */
export const TEMPLATES: Record<TemplateId, FieldSpec[]> = {
  event: [
    { key: 'name', kind: 'text', required: true, labelKey: 'tpl.event.name' },
    { key: 'date', kind: 'date', required: true, labelKey: 'tpl.event.date', days: 60 },
    { key: 'time', kind: 'time', required: true, labelKey: 'tpl.event.time' },
    { key: 'place', kind: 'text', required: true, labelKey: 'tpl.event.place' },
    { key: 'for', kind: 'chips', required: true, options: ['all', 'men', 'women', 'youth', 'kids'], labelKey: 'tpl.event.for' },
    { key: 'organisers', kind: 'text', required: false, labelKey: 'tpl.event.organisers' },
    { key: 'more', kind: 'long', required: false, labelKey: 'tpl.event.more' },
  ],
  mazal: [
    { key: 'occasion', kind: 'chips', required: true, options: OCCASIONS, labelKey: 'tpl.mazal.occasion' },
    { key: 'occasionOther', kind: 'text', required: false, labelKey: 'tpl.mazal.other', showWhen: is('occasion', 'other'), requiredWhen: is('occasion', 'other') },
    { key: 'surname', kind: 'family', required: true, labelKey: 'tpl.family' },
    { key: 'whose', kind: 'chips', required: true, options: ['parents', 'grandparents', 'other'], labelKey: 'tpl.mazal.whose' },
    { key: 'whoseOther', kind: 'text', required: false, labelKey: 'tpl.mazal.whoseOther', showWhen: is('whose', 'other'), requiredWhen: is('whose', 'other') },
    { key: 'name', kind: 'text', required: false, labelKey: 'tpl.mazal.name' },
    { key: 'parents', kind: 'text', required: false, labelKey: 'tpl.mazal.parents', showWhen: is('whose', 'grandparents') },
    { key: 'blessing', kind: 'text', required: false, labelKey: 'tpl.mazal.blessing' },
  ],
  condolence: [
    { key: 'variant', kind: 'chips', required: true, options: ['only', 'later', 'full'], labelKey: 'tpl.condolence.variant' },
    { key: 'surname', kind: 'family', required: true, labelKey: 'tpl.family' },
    { key: 'deceased', kind: 'text', required: true, labelKey: 'tpl.condolence.deceased' },
    { key: 'relation', kind: 'text', required: true, labelKey: 'tpl.condolence.relation' },
    { key: 'address', kind: 'text', required: false, labelKey: 'tpl.condolence.address', showWhen: is('variant', 'full'), requiredWhen: is('variant', 'full') },
    { key: 'hours', kind: 'text', required: false, labelKey: 'tpl.condolence.hours', showWhen: is('variant', 'full'), requiredWhen: is('variant', 'full') },
    { key: 'until', kind: 'date', required: false, labelKey: 'tpl.condolence.until', days: 14, showWhen: is('variant', 'full'), requiredWhen: is('variant', 'full') },
    { key: 'prayers', kind: 'text', required: false, labelKey: 'tpl.condolence.prayers', showWhen: is('variant', 'full') },
  ],
};

const OPTION_KEY: Record<string, string> = {
  'event.for.all': 'tpl.event.forAll', 'event.for.men': 'tpl.event.men', 'event.for.women': 'tpl.event.women',
  'event.for.youth': 'tpl.event.youth', 'event.for.kids': 'tpl.event.kids',
  'mazal.whose.parents': 'tpl.mazal.parentsChip', 'mazal.whose.grandparents': 'tpl.mazal.grandparentsChip', 'mazal.whose.other': 'tpl.mazal.otherChip',
  'condolence.variant.only': 'tpl.condolence.vOnly', 'condolence.variant.later': 'tpl.condolence.vLater', 'condolence.variant.full': 'tpl.condolence.vFull',
};
/** The i18n key of a chip's label. */
export function optionLabelKey(id: TemplateId, key: string, option: string): string {
  return OPTION_KEY[`${id}.${key}.${option}`] ?? `tpl.${id}.${option}`;
}

export function templateOf(type: MessageType): TemplateId | null {
  return type === 'event' ? 'event' : type === 'celebration' ? 'mazal' : type === 'condolence' ? 'condolence' : null;
}

const str = (f: TemplateFields, key: string): string => {
  const v = f[key];
  return typeof v === 'string' ? v.trim() : '';
};

/** Keys of the required fields (and those required by the other values) that are empty, in form order. */
export function missingFields(id: TemplateId, f: TemplateFields): string[] {
  return TEMPLATES[id].filter(s => (s.required || s.requiredWhen?.(f)) && !str(f, s.key)).map(s => s.key);
}

const DICT: Record<Lang, Dict> = { he, en };
const text = (lang: Lang, key: string): string => translate(DICT[lang], he, key);

/** Replaces {name} placeholders; unknown ones stay. No Unicode isolates (unlike `translate`). */
export function fill(raw: string, params: Record<string, string>): string {
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? params[name]! : m));
}
const t = (lang: Lang, key: string, params: Record<string, string> = {}): string => fill(text(lang, key), params);

const LONG_DAYS: Record<Lang, string[]> = {
  he: ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const SHORT_DAYS: Record<Lang, string[]> = {
  he: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
/** The weekday of an `YYYY-MM-DD` day: he "יום ג׳" / "ג׳", en "Tuesday" / "Tue". */
export function dayLabel(iso: string, lang: Lang, form: 'long' | 'short'): string {
  return (form === 'long' ? LONG_DAYS : SHORT_DAYS)[lang][dayOfWeek(iso)]!;
}
/** "3.11". The Gregorian date is only ever shown next to the Hebrew one (`dualDate`). */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}.${m}`;
}

const MEMORIAL_END = /(ז״ל|ז"ל|ע״ה|ע"ה)$/;
/** Hebrew: appends " ז״ל" unless the name already ends in ז״ל or ע״ה (either quote style). English: unchanged. */
export function withMemorial(name: string, lang: Lang): string {
  const n = name.trim();
  return lang !== 'he' || !n || MEMORIAL_END.test(n) ? n : `${n} ז״ל`;
}

const BLESSING_GROUP: Record<string, string> = {
  birthSon: 'birth', birthDaughter: 'birth', barMitzvah: 'barMitzvah', batMitzvah: 'batMitzvah', engagement: 'couple', wedding: 'couple',
};
/** The suggested blessing line for an occasion (§19.2); empty for "other". */
export function defaultBlessing(occasion: string, lang: Lang): string {
  const group = BLESSING_GROUP[occasion];
  return group ? text(lang, `tpl.mazal.blessingDefault.${group}`) : '';
}

// Mazal tov -----------------------------------------------------------------------------------------------------

const GRANDPARENT_PHRASES = new Set(['birthSon', 'birthDaughter', 'barMitzvah', 'batMitzvah']);
const MALE = new Set(['birthSon', 'barMitzvah']);
const FEMALE = new Set(['birthDaughter', 'batMitzvah']);

/** "להולדת הנכדה נועה" (+ ", בת לדוד ושרה" for grandparents who named the parents). */
function mazalSub(f: TemplateFields, lang: Lang): string {
  const occasion = str(f, 'occasion');
  const grand = str(f, 'whose') === 'grandparents' && GRANDPARENT_PHRASES.has(occasion);
  const name = str(f, 'name');
  const phrase = t(lang, `tpl.mazal.phrase.${occasion}.${grand ? 'grandparents' : 'parents'}.${name ? 'name' : 'plain'}`, { name, other: str(f, 'occasionOther') });
  const parents = str(f, 'parents');
  if (!grand || !parents) return phrase;
  return `${phrase}, ${t(lang, `tpl.mazal.childOf.${MALE.has(occasion) ? 'm' : FEMALE.has(occasion) ? 'f' : 'm'}`, { parents })}`;
}

// Event ---------------------------------------------------------------------------------------------------------

function eventBody(f: TemplateFields, lang: Lang): string {
  const date = str(f, 'date');
  const lines = [t(lang, 'tpl.event.bodyLine', {
    day: dayLabel(date, lang, 'long'), hdate: dualDate(date, lang), time: str(f, 'time'), place: str(f, 'place'),
    for: t(lang, optionLabelKey('event', 'for', str(f, 'for'))),
  })];
  if (str(f, 'organisers')) lines.push(t(lang, 'tpl.event.organisersLine', { names: str(f, 'organisers') }));
  if (str(f, 'more')) lines.push(str(f, 'more'));
  return lines.join('\n');
}

// Condolence ----------------------------------------------------------------------------------------------------

function condolenceBody(f: TemplateFields, lang: Lang): string {
  const parts = [t(lang, 'tpl.condolence.bodyStart', { surname: str(f, 'surname'), deceased: withMemorial(str(f, 'deceased'), lang), relation: str(f, 'relation') })];
  const variant = str(f, 'variant');
  if (variant === 'later') parts.push(t(lang, 'tpl.condolence.laterLine'));
  if (variant === 'full') {
    parts.push(t(lang, 'tpl.condolence.fullLine', {
      address: str(f, 'address'), until: dualDate(str(f, 'until'), lang, { weekday: true }), hours: str(f, 'hours'),
    }));
    if (str(f, 'prayers')) parts.push(t(lang, 'tpl.condolence.prayersLine', { prayers: str(f, 'prayers') }));
  }
  parts.push(t(lang, 'tpl.condolence.closing'));
  return parts.join(' ');
}

/** The title and body a template posts. */
export function buildMessage(id: TemplateId, f: TemplateFields, lang: Lang): { title: string; body: string } {
  if (id === 'event') return { title: str(f, 'name'), body: eventBody(f, lang) };
  if (id === 'condolence') return { title: t(lang, 'tpl.condolence.title', { surname: str(f, 'surname') }), body: condolenceBody(f, lang) };
  const blessing = str(f, 'blessing');
  return {
    title: t(lang, 'tpl.mazal.title', { surname: str(f, 'surname') }),
    body: `${mazalSub(f, lang)}.${blessing ? ` ${blessing}` : ''}`,
  };
}

// Sheet line ----------------------------------------------------------------------------------------------------

export type SheetLine = { main: MazalPart[]; sub: string; blessing: string; icon: 'heart' | 'star' | null; cancelled: boolean };

/** The printed sheet is fixed Hebrew (like `SHEET_TEXT`), so these lead-ins are not in the i18n files. */
const SHEET = { mazalNamed: 'מזל טוב ל', mazalFamily: 'מזל טוב למשפחת ', family: 'משפחת ', passing: ' · במות ' };

/** One sheet line, always Hebrew. Without a template (free text) the title is the line and the family name is bold. */
export function buildSheetLine(m: Pick<Message, 'type' | 'title' | 'templateId' | 'fields' | 'targetName'>): SheetLine {
  const f = m.fields;
  const line = (over: Partial<SheetLine>): SheetLine => ({ main: [], sub: '', blessing: '', icon: null, cancelled: false, ...over });
  if (f && m.templateId === 'event') {
    const date = str(f, 'date');
    return line({
      main: [{ text: str(f, 'name'), bold: true }, { text: ` · ${dayLabel(date, 'he', 'short')} ${str(f, 'time')} · ${str(f, 'place')}`, bold: false }],
      cancelled: f.cancelled === true,
    });
  }
  if (f && m.templateId === 'mazal') {
    const first = str(f, 'firstNames');
    const occasion = str(f, 'occasion');
    return line({
      main: [{ text: first ? `${SHEET.mazalNamed}${first} ` : SHEET.mazalFamily, bold: false }, { text: str(f, 'surname'), bold: true }],
      sub: mazalSub(f, 'he'),
      blessing: str(f, 'blessing'),
      icon: occasion === 'barMitzvah' || occasion === 'batMitzvah' ? 'star' : 'heart',
    });
  }
  if (f && m.templateId === 'condolence') {
    const variant = str(f, 'variant');
    return line({
      main: [{ text: SHEET.family, bold: false }, { text: str(f, 'surname'), bold: true }, { text: `${SHEET.passing}${withMemorial(str(f, 'deceased'), 'he')}`, bold: false }],
      sub: variant === 'later' ? t('he', 'tpl.condolence.sheetLater')
        : variant === 'full' ? t('he', 'tpl.condolence.sheetFull', { address: str(f, 'address'), dayShort: dayLabel(str(f, 'until'), 'he', 'short') })
        : '',
    });
  }
  return line({ main: mazalParts(m.title, m.targetName) });
}
