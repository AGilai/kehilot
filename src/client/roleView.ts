import { postableChannels } from './messageView.ts';
import type { Channel, Role } from './types.ts';

export type MainTab = 'home' | 'messages' | 'me';

export type RoleFeatures = {
  /** Bottom tabs of the normal (non-management) app. */
  tabs: MainTab[];
  /** The "new message" button (broadcast). */
  compose: boolean;
  /** The member directory (blessing targets, muted-member names). */
  directory: boolean;
  /** Management mode. */
  management: boolean;
  /** The private blessing reply box (still needs a targeted message; see `canReply`). */
  blessingReply: boolean;
  /** Joining a simcha / condolence call. */
  join: boolean;
  /** M10: the "request membership" card and the locked rows on Home. */
  membershipCard: boolean;
  /** The phone list: Home entry card, Me card and the screen (members and gabbaim only). */
  phoneList: boolean;
  /** Me: the family card (partner, children). Members and gabbaim only. */
  family: boolean;
};

/**
 * What each role may see and do in the normal app (spec §1). A listener reads what the server returns and
 * posts only where a channel says `canPost`; the server decides, this only hides what would be refused.
 * An unknown role is treated like a listener.
 */
export function roleFeatures(role: Role | undefined): RoleFeatures {
  const tabs: MainTab[] = ['home', 'messages', 'me'];
  if (role === 'member' || role === 'gabbai') {
    return { tabs, compose: true, directory: true, management: role === 'gabbai', blessingReply: true, join: true, membershipCard: false, phoneList: true, family: true };
  }
  return { tabs, compose: false, directory: false, management: false, blessingReply: false, join: false, membershipCard: true, phoneList: false, family: false };
}

export const mainTabs = (role: Role | undefined): MainTab[] => roleFeatures(role).tabs;

/** The "new message" button: the role may broadcast and at least one channel accepts a broadcast from the caller. */
export function showCompose(role: Role | undefined, channels: Channel[]): boolean {
  return roleFeatures(role).compose && postableChannels(channels).length > 0;
}

/** The chat input: only in a conversation channel, and only where the server says the caller can post. */
export function canPostInChat(role: Role | undefined, channel: Pick<Channel, 'canPost' | 'conversation'>): boolean {
  if (role === 'listener' && !channel.conversation) return false;
  return channel.canPost;
}
