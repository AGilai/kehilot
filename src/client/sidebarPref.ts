/** UX-DESIGN §18.3: the management sidebar (wide screens) can collapse to an icon rail; the choice is per device. */
export const SIDEBAR_COLLAPSED_KEY = 'kehilot.sidebarCollapsed';
export const SIDEBAR_WIDTH = 272;
export const SIDEBAR_RAIL_WIDTH = 64;

export type SidebarStore = { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void> };

/** Only a stored "1" means collapsed; missing or anything else is expanded. */
export const parseSidebarCollapsed = (raw: string | null | undefined): boolean => raw === '1';

export const sidebarWidth = (collapsed: boolean): number => (collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH);

export async function loadSidebarCollapsed(store: SidebarStore): Promise<boolean> {
  try { return parseSidebarCollapsed(await store.get(SIDEBAR_COLLAPSED_KEY)); } catch { return false; }
}

export async function saveSidebarCollapsed(store: SidebarStore, collapsed: boolean): Promise<void> {
  try { await store.set(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* storage blocked: the choice lasts for this session only */ }
}
