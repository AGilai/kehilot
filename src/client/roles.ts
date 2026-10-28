import type { Lang, Role } from './types.ts';

/** Every role, as the server stores it. */
export const ROLES: readonly Role[] = ['listener', 'member', 'gabbai', 'tech'];

/** "צוות הניהול": the roles that see the management screens. Must match `MANAGEMENT` in server/cloud/authz.py. */
export const MANAGEMENT: readonly Role[] = ['gabbai', 'tech'];

/** A gabbai or a tech: every gabbai permission (owner decision 2026-10-28). An unknown or missing role is not management. */
export const isManagement = (role: string | null | undefined): boolean => role === 'gabbai' || role === 'tech';

const LABELS: Record<Role, Record<Lang, string>> = {
  listener: { he: 'מתפלל אורח', en: 'Guest' },
  member: { he: 'חבר/ת קהילה', en: 'Member' },
  gabbai: { he: 'גבאי', en: 'Gabbai' },
  tech: { he: 'טכני', en: 'Tech' },
};

/** An adult with a family: member, gabbai or tech (server `ADULTS`). */
export const isAdult = (role: string | null | undefined): boolean => role === 'member' || isManagement(role);

/** Tag tone: a gabbai is the strong (tekhelet) tag, a tech the plain ash outline (UX-DESIGN §20.4). */
export const roleTone = (role: string): 'strong' | 'plain' => (role === 'gabbai' ? 'strong' : 'plain');

/** The role on an attribution: `tech` stays tech; anything else, including a missing value from before roles were recorded, was a gabbai. */
export const staffRole = (role: string | null | undefined): 'gabbai' | 'tech' => (role === 'tech' ? 'tech' : 'gabbai');

/** The word for a role. A tech is "טכני", never "גבאי" (UX-DESIGN §20.4). */
export const roleLabel = (role: Role, lang: Lang): string => LABELS[role]?.[lang] ?? LABELS.member[lang];

/** The roles the picker on a member's card offers, in order (a listener is reached only through approval). */
export const PICKER_ROLES: readonly Role[] = ['member', 'tech', 'gabbai'];

/** The i18n key of the picker's button for the chosen role. */
export const roleChangeKey = (role: Role): string => (role === 'tech' ? 'admin.role.toTech' : role === 'gabbai' ? 'admin.role.toGabbai' : 'admin.role.toMember');
