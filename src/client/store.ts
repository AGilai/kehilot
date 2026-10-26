import type { KeyValue } from '../auth/tokens.ts';
import type { endpoints } from './endpoints.ts';
import type { Channel, Kehila, Lang, Me, Message } from './types.ts';

type Api = ReturnType<typeof endpoints>;

export type StoreState = {
  /** Bumped by reset(); async results from an older generation are dropped. */
  generation: number;
  me: Me | null;
  kehilaId: string | null;
  kehila: Kehila | null;
  channels: Channel[];
  feed: Message[];
};

/** Where the start sequence ends: profile form, join screen, Kehila picker, or the signed-in app. */
export type Route = 'setup' | 'none' | 'switcher' | 'ready';

export const lastKehilaKey = (userId: string) => `kehilot.lastKehila.${userId}`;

const empty = (generation: number): StoreState => ({ generation, me: null, kehilaId: null, kehila: null, channels: [], feed: [] });

export function createStore(api: Api, storage: KeyValue) {
  let state = empty(0);
  const listeners = new Set<() => void>();
  const set = (patch: Partial<StoreState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
  const guard = (gen: number) => gen === state.generation;

  async function loadMe(): Promise<Me | null> {
    const gen = state.generation;
    const me = await api.me();
    if (!guard(gen)) return null;
    set({ me });
    return me;
  }

  /** Loads the Kehila and its channels; false when the store was reset meanwhile. */
  async function selectKehila(k: string): Promise<boolean> {
    const gen = state.generation;
    const userId = state.me?.userId;
    const [kehila, channels] = await Promise.all([api.kehila(k), api.channels(k)]);
    if (!guard(gen)) return false;
    set({ kehilaId: k, kehila, channels, feed: [] });
    if (userId) { try { await storage.set(lastKehilaKey(userId), k); } catch { /* the choice is only a convenience */ } }
    return true;
  }

  /** The last Kehila, else the only one, else the switcher; no Kehilot gives 'none'. */
  async function chooseKehila(): Promise<Route> {
    const gen = state.generation;
    const me = state.me;
    if (!me) return 'none';
    if (!me.profile) return 'setup';
    if (me.kehilot.length === 0) return 'none';
    let last: string | null = null;
    try { last = await storage.get(lastKehilaKey(me.userId)); } catch { /* ignore */ }
    if (!guard(gen)) return 'none';
    const pick = me.kehilot.find(x => x.kehilaId === last) ?? (me.kehilot.length === 1 ? me.kehilot[0] : undefined);
    if (!pick) return 'switcher';
    return (await selectKehila(pick.kehilaId)) ? 'ready' : 'none';
  }

  async function start(): Promise<Route> {
    if (!(await loadMe())) return 'none';
    return chooseKehila();
  }

  async function saveProfile(p: { firstName: string; lastName: string; lang: Lang }): Promise<Route> {
    const gen = state.generation;
    const profile = await api.putProfile(p);
    if (!guard(gen) || !state.me) return 'none';
    set({ me: { ...state.me, profile } });
    return chooseKehila();
  }

  /** After a focus refresh: forget a selected Kehila the user no longer belongs to. */
  function dropMissingSelection(): boolean {
    const { me, kehilaId } = state;
    if (!me || !kehilaId || me.kehilot.some(x => x.kehilaId === kehilaId)) return false;
    set({ kehilaId: null, kehila: null, channels: [], feed: [] });
    return true;
  }

  function reset(): void {
    state = empty(state.generation + 1);
    listeners.forEach(l => l());
  }

  return {
    getState: () => state,
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    loadMe, selectKehila, chooseKehila, start, saveProfile, dropMissingSelection, reset, guard,
  };
}

export type Store = ReturnType<typeof createStore>;
