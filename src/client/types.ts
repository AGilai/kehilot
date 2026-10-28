// v2 shapes from server/API.md.
export type Role = 'listener' | 'member' | 'gabbai';
export type Classification = '' | 'א' | 'קבוע';
export type Lang = 'he' | 'en';
export type MessageType = 'weekly' | 'celebration' | 'condolence' | 'event' | 'general' | 'chat';
export type PostPolicy = 'management' | 'broadcasters';
export type ImageType = 'image/jpeg' | 'image/png';

export type Profile = { firstName: string; lastName: string; lang: Lang; phone?: string | null };

export type KehilaSummary = { kehilaId: string; name: string; role: Role; logoVersion: string | null };

export type Me = { userId: string; email: string; profile: Profile | null; kehilot: KehilaSummary[]; age13Required: boolean };

export type NotifyPrefs = {
  mutedChannels: string[];
  mutedTypes: string[];
  membersBroadcasts: 'all' | 'management_only';
  mutedMembers: string[];
  chatChannels: string[];
};

/** Gabbaim only: who may post a type and whether guests (listeners) see it. */
export type TypeRule = { post: 'management' | 'broadcasters'; listeners: boolean };
export type TypeRules = { celebration?: TypeRule; condolence?: TypeRule };

export type Kehila = {
  kehilaId: string;
  name: string;
  role: Role;
  classification: Classification;
  logoVersion: string | null;
  canBroadcast: boolean;
  pendingRequest: boolean;
  notify: NotifyPrefs;
  /** The caller's group IDs. */
  groups: string[];
  /** Groups the caller administers. */
  adminGroups: string[];
  /** The caller's own role tags. */
  tags: RoleTag[];
  settings: { pollSeconds: number; maxListeners?: number };
  /** Gabbaim only. */
  typeRules?: { celebration: TypeRule; condolence: TypeRule };
  listenerCount?: number;
  /** The Kehila's privacy contact text, or ''. */
  privacyContact: string;
  /** The caller's phone-list switch for this Kehila. */
  showPhone: boolean;
  cards: HomeCards;
  /** Gabbaim only: who accepted the Kehila terms (null until someone has). `at` is Unix seconds. */
  termsAccepted?: { name: string; at: number } | null;
};

export type HomeCards = {
  gabbaiLink: { gabbaiName: string; partnerName: string } | null;
  request: { fromUserId: string; fromName: string } | null;
  imported: boolean;
  phoneAsk: boolean;
  terms: boolean;
  /** A gabbai linked seats you held without an account to your family: `seats` is how many, `at` when. Once, until dismissed. */
  seatLink?: { seats: number; at: number } | null;
};

export type Child = { id: string; firstName: string; gender: 'm' | 'f'; birthDate?: string };
export type ChildFields = Omit<Child, 'id'>;

/** Times are Unix seconds. */
export type FamilyView = {
  familyId: string;
  name: string;
  adults: Array<{ userId: string; displayName: string; me: boolean }>;
  children: Child[];
  sent: { toUserId: string; toName: string; expiresAt: number; state: 'pending' | 'declined' | 'expired' } | null;
  received: Array<{ fromUserId: string; fromName: string; expiresAt: number }>;
  notice: { gabbaiName: string; partnerName: string } | null;
};

export type Candidate = { userId: string; displayName: string; cooldownUntil?: number };

/** Adults who chose to show a number; never children. */
export type PhoneListFamily = { familyId: string; name: string; people: Array<{ userId: string; name: string; phone: string; tags: RoleTag[] }> };

export type TargetFamily = { familyId: string; name: string; firstNames: string[]; targetMemberId: string };

/** Gabbai view: children are first name, gender and birth year only. */
export type AdminFamily = {
  familyId: string;
  name: string;
  adults: Array<{ userId: string; displayName: string }>;
  children: Array<{ firstName: string; gender: 'm' | 'f'; birthYear?: number }>;
};

/** Gabbai: one upcoming simcha (UX §17.14). First name, surname and date only; `manual` = the family chose the bar mitzvah Shabbat. */
export type SimchaItem = { kind: 'bar' | 'bat'; firstName: string; surname: string; date: string; manual: boolean; label?: string };
/** A week (Sunday `week` to Saturday `shabbat`, ISO days); `parasha` is '' on a holiday Shabbat. A quiet week has no items. */
export type SimchaWeek = { week: string; shabbat: string; parasha: string; label: string; items: SimchaItem[] };

export type ExportLink = { url: string; expiresAt: number };
export type DismissCard = 'gabbai_link' | 'imported' | 'phone' | 'seat_link';

export type Logo = { logoVersion: string; contentType: 'image/png'; data: string };

export type Channel = {
  channelId: string;
  name: string;
  listenersCanRead: boolean;
  postPolicy: PostPolicy;
  canPost: boolean;
  inAudience: boolean;
  conversation: boolean;
  chatHourlyLimit: number;
  /** The caller administers this channel. */
  isAdmin: boolean;
  /** Group IDs; gabbaim only. */
  groups?: string[];
  /** The types the caller may post here (server-computed; empty for a conversation channel). */
  postableTypes?: MessageType[];
};

/** Response of create channel (`updateChannel` returns the same shape). */
export type ChannelCreated = Pick<Channel, 'channelId' | 'name' | 'listenersCanRead' | 'postPolicy'> & { groups: string[] };

export type ChannelFields = {
  name: string;
  listenersCanRead: boolean;
  postPolicy: PostPolicy;
  groups: string[];
  conversation: boolean;
  chatHourlyLimit?: number;
};

export type Message = {
  messageId: string;
  channelId: string;
  type: MessageType;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  authorKind: 'management' | 'member';
  joinCount: number;
  image?: { contentType: ImageType; bytes: number };
  read?: boolean;
  targetMemberId?: string;
  targetFamilyId?: string;
  targetName?: string;
  replierCount?: number;
};

export type PostMessageBody = {
  channelId: string;
  type?: MessageType;
  title?: string;
  body?: string;
  targetMemberId?: string;
  targetFamilyId?: string;
  imageUploadId?: string;
};

export type Reply = { replyId: string; authorId: string; authorName: string; body: string; createdAt: number };

export type Change =
  | { kind: 'message' | 'join' | 'reply_count'; id: string; item: Message }
  | { kind: 'message_removed'; id: string; item: { id: string } }
  | { kind: 'reply'; id: string; item: Reply & { messageId: string } }
  | { kind: 'read'; id: string; item: { messageId: string } };

export type ChangesPage = { cursor: string; more: boolean; changes: Change[] } | { resync: true };

export type InvitePreview = { kehilaName: string; role: Role; expiresAt: number };
export type InviteRow = { code: string; role: Role; usesLeft: number; expiresAt: number; mine: boolean };
export type InviteOptions = { uses?: number; days?: number; role?: 'listener' | 'member'; classification?: Classification };

export type DirectoryEntry = { userId: string; displayName: string };

export type RequestRow = {
  userId: string; displayName: string; createdAt: number; previouslyRejected: boolean;
  /** Seat holders without an account that look like this requester (top three); a suggestion only, nothing is linked. */
  seatSuggestions?: { count: number; items: Array<{ holderId: string; holderName: string; why: string; level: 'exact' | 'likely' }> };
};

/** A Kehila-defined label on a person. Labels only: nothing in the client may gate on it. */
export type RoleTag = { tagId: string; name: string };
export type TagRow = RoleTag & { memberCount: number };

export type MemberRow = {
  userId: string;
  displayName: string;
  role: Role;
  classification: Classification;
  canBroadcast: boolean;
  groups: string[];
  tags: RoleTag[];
};
export type MemberFields = Partial<{ role: Role; classification: Classification; canBroadcast: boolean; groups: string[] }>;

/** Admin listing row. */
export type Group = {
  groupId: string;
  name: string;
  memberCount: number;
  channelCount: number;
  adminCount: number;
  pendingCount: number;
};
/** Member-facing listing row. */
export type GroupMembership = { groupId: string; name: string; isMember: boolean; isAdmin: boolean; requested: boolean };
export type GroupRequestRow = { userId: string; displayName: string; role: Role; createdAt: number };
export type GroupMemberRow = { userId: string; displayName: string; role: Role; isAdmin: boolean };

export type ImportRow = {
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  classification: Classification;
  groups?: string[];
};
/** Gabbai-editable push texts: the defaults per key and language, and the Kehila's custom ones. */
export type PushTexts = {
  defaults: Record<string, Record<Lang, string>>;
  custom: Record<string, Partial<Record<Lang, string>>>;
};
export type ImportResult = {
  index: number;
  status: 'created' | 'added' | 'upgraded' | 'skipped' | 'exists' | 'invalid';
  error?:
    | 'invalid_email'
    | 'invalid_first_name'
    | 'invalid_last_name'
    | 'invalid_role'
    | 'invalid_classification'
    | 'duplicate_email'
    | 'invalid_groups'
    | 'unknown_group';
};

export type UploadGrant = {
  uploadId: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: number;
};
