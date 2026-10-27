export type Dict = Record<string, unknown>;
export type Lang = 'he' | 'en';

function lookup(dict: Dict, key: string): string | undefined {
  if (typeof dict[key] === 'string') return dict[key] as string;
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Dict)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** Strings get Unicode isolates (FSI..PDI) so a Hebrew name in an English sentence, or the reverse, keeps its own direction; numbers stay as they are. */
function isolate(v: string | number): string {
  return typeof v === 'string' ? `\u2068${v}\u2069` : String(v);
}

/** Looks up `key` (dotted path) in `dict`, then `fallback`, then returns the key. Replaces {name} placeholders. */
export function translate(dict: Dict, fallback: Dict, key: string, params?: Record<string, string | number>): string {
  const text = lookup(dict, key) ?? lookup(fallback, key) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? isolate(params[name]!) : m));
}
