// Whether the seat page's map card is folded (UX §15.10.3), remembered per device. Web uses localStorage, native AsyncStorage
// (loaded only when there is no localStorage, so the node tests never import it). Any storage failure means "open".
export const MAP_FOLD_KEY = 'kehilot.seatMapCollapsed';

type Store = { get: () => Promise<string | null>; set: (v: string) => Promise<void> };
function store(): Store {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (ls) return { get: async () => ls.getItem(MAP_FOLD_KEY), set: async (v) => ls.setItem(MAP_FOLD_KEY, v) };
  return {
    get: async () => (await import('@react-native-async-storage/async-storage')).default.getItem(MAP_FOLD_KEY),
    set: async (v) => (await import('@react-native-async-storage/async-storage')).default.setItem(MAP_FOLD_KEY, v),
  };
}

export async function readMapFolded(): Promise<boolean> {
  try { return (await store().get()) === '1'; } catch { return false; }
}
export async function writeMapFolded(v: boolean): Promise<void> {
  try { await store().set(v ? '1' : '0'); } catch { /* the preference is a convenience */ }
}
