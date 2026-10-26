// v2 shapes from server/API.md.
export type Role = 'listener' | 'member' | 'gabbai';
export type Classification = '' | 'א' | 'קבוע';
export type Lang = 'he' | 'en';
export type MessageType = 'weekly' | 'celebration' | 'condolence' | 'event' | 'chat';
export type PostPolicy = 'management' | 'broadcasters';
export type ImageType = 'image/jpeg' | 'image/png';

export type Profile = { firstName: string; lastName: string; lang: Lang };

export type KehilaSummary = { kehilaId: string; name: string; role: Role; logoVersion: string | null };

export type Me = { userId: string; email: string; profile: Profile | null; kehilot: KehilaSummary[] };

export type NotifyPrefs = {
  mutedChannels: string[];
  mutedTypes: string[];
  membersBroadcasts: 'all' | 'management_only';
  mutedMembers: string[];
  chatChannels: string[];
};

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
  settings: { pollSeconds: number; maxListeners?: number };
  listenerCount?: number;
};

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
  targetName?: string;
  replierCount?: number;
};

export type PostMessageBody = {
  channelId: string;
  type?: MessageType;
  title?: string;
  body?: string;
  targetMemberId?: string;
  imageUploadId?: string;
};

export type Reply = { replyId: string; authorId: string; authorName: string; body: string; createdAt: string };

export type Change =
  | { kind: 'message' | 'join' | 'reply_count'; id: string; item: Message }
  | { kind: 'message_removed'; id: string; item: { id: string } }
  | { kind: 'reply'; id: string; item: Reply & { messageId: string } }
  | { kind: 'read'; id: string; item: { messageId: string } };

export type ChangesPage = { cursor: string; more: boolean; changes: Change[] } | { resync: true };

export type InvitePreview = { kehilaName: string; role: Role; expiresAt: string };
export type InviteRow = { code: string; role: Role; usesLeft: number; expiresAt: string; mine: boolean };
export type InviteOptions = { uses?: number; days?: number; role?: 'listener' | 'member'; classification?: Classification };

export type DirectoryEntry = { userId: string; displayName: string };

export type RequestRow = { userId: string; displayName: string; createdAt: string; previouslyRejected: boolean };

export type MemberRow = {
  userId: string;
  displayName: string;
  role: Role;
  classification: Classification;
  canBroadcast: boolean;
  groups: string[];
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
export type GroupRequestRow = { userId: string; displayName: string; role: Role; createdAt: string };
export type GroupMemberRow = { userId: string; displayName: string; role: Role; isAdmin: boolean };

export type ImportRow = {
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  classification: Classification;
  groups?: string[];
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
  expiresAt: string;
};
