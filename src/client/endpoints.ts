import type { Http } from './http.ts';
import type { ScheduleDoc } from '../schedule/types.ts';
import type { ReportContext } from './reportContext.ts';
import type {
  TypeRules,
  AdminFamily, Candidate, Channel, ChannelCreated, ChannelFields, ChangesPage, Child, ChildFields, Classification,
  DirectoryEntry, DismissCard, ExportLink, FamilyView, Group, GroupMemberRow, RoleTag, TagRow, GroupMembership,
  GroupRequestRow, ImportResult, ImportRow, InviteOptions, InvitePreview, InviteRow, Kehila, Lang, Logo, Me,
  MemberFields, MemberRow, PhoneListFamily, PushTexts, Role, Message, NotifyPrefs, PostMessageBody, Profile, Reply,
  RequestRow, TargetFamily, UploadGrant,
} from './types.ts';

const e = encodeURIComponent;

export function endpoints(http: Http) {
  const r = http.request;
  const K = (k: string) => `/v1/kehilot/${e(k)}`;
  const A = (k: string) => `${K(k)}/admin`;
  const query = (pairs: Array<[string, string | number | undefined]>) => {
    const parts = pairs.filter(([, v]) => v !== undefined).map(([n, v]) => `${n}=${e(String(v))}`);
    return parts.length ? `?${parts.join('&')}` : '';
  };

  return {
    // profile and devices
    me: () => r<Me>('GET', '/v1/me'),
    putProfile: (p: { firstName: string; lastName?: string; lang: Lang }) => r<Profile>('PUT', '/v1/me/profile', p),
    putDevice: (token: string, platform: 'ios' | 'android' | 'web') => r<void>('PUT', '/v1/me/devices', { token, platform }),
    deleteDevice: (token: string) => r<void>('DELETE', `/v1/me/devices/${e(token)}`),
    deleteMe: (o: { deletePosts?: boolean } = {}) =>
      r<void>('DELETE', `/v1/me${o.deletePosts ? '?deletePosts=1' : ''}`),
    putPhone: (phone: string | null) => r<{ phone: string | null }>('PUT', '/v1/me/phone', { phone }),
    age13Consent: () => r<void>('POST', '/v1/me/consents/age13'),
    exportStatus: () => r<ExportLink>('GET', '/v1/me/export'),
    startExport: () => r<ExportLink>('POST', '/v1/me/export'),

    // bug reports (write-only; the anonymous one is public and sends no token)
    requestReportUpload: (o: { contentType: 'image/jpeg' | 'image/png'; bytes: number }) => r<UploadGrant>('POST', '/v1/reports/upload', o),
    postReport: (o: { text: string; context: ReportContext; imageUploadId?: string }) => r<{ reportId: string }>('POST', '/v1/reports', o),
    postAnonymousReport: (o: { text: string; context: ReportContext }) => r<{ reportId: string }>('POST', '/v1/reports/anonymous', o, { auth: false }),

    // kehila, invites, joining
    kehila: (k: string) => r<Kehila>('GET', K(k)),
    logo: (k: string) => r<Logo>('GET', `${K(k)}/logo`),
    createInvite: (k: string, o: InviteOptions = {}) =>
      r<{ code: string; expiresAt: number }>('POST', `${K(k)}/invites`, Object.keys(o).length ? o : undefined),
    invites: (k: string) => r<InviteRow[]>('GET', `${K(k)}/invites`),
    revokeInvite: (k: string, code: string) => r<void>('DELETE', `${K(k)}/invites/${e(code)}`),
    previewInvite: (code: string) => r<InvitePreview>('GET', `/v1/invites/${e(code)}`, undefined, { auth: false }),
    acceptInvite: (code: string) => r<{ kehilaId: string; role: Role }>('POST', `/v1/invites/${e(code)}/accept`),
    requestMembership: (k: string) => r<Record<string, never>>('POST', `${K(k)}/membership-request`),
    leave: (k: string) => r<void>('DELETE', `${K(k)}/membership`),

    // prayer schedule (every role; the saved schedule, week overrides, sheet cities and location)
    schedule: (k: string) => r<ScheduleDoc>('GET', `${K(k)}/schedule`),

    // channels and messages
    channels: (k: string) => r<Channel[]>('GET', `${K(k)}/channels`),
    messages: (k: string, o: { before?: string; limit?: number } = {}) =>
      r<Message[]>('GET', `${K(k)}/messages${query([['limit', o.limit], ['before', o.before]])}`),
    message: (k: string, m: string) => r<Message>('GET', `${K(k)}/messages/${e(m)}`),
    postMessage: (k: string, body: PostMessageBody) => r<Message>('POST', `${K(k)}/messages`, body),
    removeMessage: (k: string, m: string) => r<void>('DELETE', `${K(k)}/messages/${e(m)}`),
    join: (k: string, m: string) => r<{ joinCount: number; joined: true }>('POST', `${K(k)}/messages/${e(m)}/join`),
    markRead: (k: string, m: string) => r<void>('POST', `${K(k)}/messages/${e(m)}/read`),
    requestUpload: (k: string, o: { channelId: string; contentType: 'image/jpeg' | 'image/png'; bytes: number }) =>
      r<UploadGrant>('POST', `${K(k)}/uploads`, o),
    messageImage: (k: string, m: string) =>
      r<{ url: string; expiresAt: number }>('GET', `${K(k)}/messages/${e(m)}/image`),
    setChatLimit: (k: string, c: string, chatHourlyLimit: number) =>
      r<Record<string, never>>('PUT', `${K(k)}/channels/${e(c)}/chat-settings`, { chatHourlyLimit }),

    // replies
    replies: (k: string, m: string) => r<Reply[]>('GET', `${K(k)}/messages/${e(m)}/replies`),
    postReply: (k: string, m: string, body: string) => r<Reply>('POST', `${K(k)}/messages/${e(m)}/replies`, { body }),

    // feed, preferences, directory
    changes: (k: string, since?: string) => r<ChangesPage>('GET', `${K(k)}/changes${query([['since', since]])}`),
    putNotify: (k: string, partial: Partial<NotifyPrefs>) => r<Record<string, never>>('PUT', `${K(k)}/me/notify`, partial),
    directory: (k: string, channelId?: string) =>
      r<DirectoryEntry[]>('GET', `${K(k)}/members${query([['channelId', channelId]])}`),

    // management (gabbai)
    requests: (k: string) => r<RequestRow[]>('GET', `${A(k)}/requests`),
    approve: (k: string, u: string, classification: Classification) =>
      r<Record<string, never>>('POST', `${A(k)}/requests/${e(u)}/approve`, { classification }),
    reject: (k: string, u: string) => r<Record<string, never>>('POST', `${A(k)}/requests/${e(u)}/reject`),
    members: (k: string) => r<MemberRow[]>('GET', `${A(k)}/members`),
    updateMember: (k: string, u: string, fields: MemberFields) =>
      r<Record<string, never>>('PUT', `${A(k)}/members/${e(u)}`, fields),
    removeMember: (k: string, u: string) => r<void>('DELETE', `${A(k)}/members/${e(u)}`),
    putSettings: (k: string, s: { maxListeners?: number; privacyContact?: string; typeRules?: TypeRules }) =>
      r<Record<string, never>>('PUT', `${A(k)}/settings`, s),
    tags: (k: string) => r<TagRow[]>('GET', `${A(k)}/tags`),
    createTag: (k: string, name: string) => r<RoleTag>('POST', `${A(k)}/tags`, { name }),
    renameTag: (k: string, id: string, name: string) => r<RoleTag>('PUT', `${A(k)}/tags/${e(id)}`, { name }),
    deleteTag: (k: string, id: string) => r<void>('DELETE', `${A(k)}/tags/${e(id)}`),
    setMemberTags: (k: string, u: string, tagIds: string[]) => r<{ tags: RoleTag[] }>('PUT', `${A(k)}/members/${e(u)}/tags`, { tagIds }),
    adminFamilies: (k: string) => r<AdminFamily[]>('GET', `${A(k)}/families`),
    adminLink: (k: string, a: string, b: string) =>
      r<{ familyId: string }>('POST', `${A(k)}/families/link`, { userIds: [a, b] }),
    acceptTerms: (k: string) => r<{ at: number }>('POST', `${A(k)}/terms`),
    pushTexts: (k: string) => r<PushTexts>('GET', `${A(k)}/push-texts`),
    putPushText: (k: string, key: string, lang: Lang, text: string) =>
      r<Record<string, never>>('PUT', `${A(k)}/push-texts`, { key, lang, text }),
    setBroadcastAll: (k: string, allow: boolean) => r<Record<string, never>>('PUT', `${A(k)}/broadcast`, { allow }),
    importRows: (k: string, rows: ImportRow[]) =>
      r<{ results: ImportResult[] }>('POST', `${A(k)}/import`, { rows }),
    createChannel: (k: string, f: ChannelFields) =>
      r<ChannelCreated>('POST', `${A(k)}/channels`, f),
    updateChannel: (k: string, c: string, f: Partial<ChannelFields>) =>
      r<ChannelCreated>('PUT', `${A(k)}/channels/${e(c)}`, f),

    // groups: admin
    groups: (k: string) => r<Group[]>('GET', `${A(k)}/groups`),
    createGroup: (k: string, name: string) => r<{ groupId: string; name: string }>('POST', `${A(k)}/groups`, { name }),
    renameGroup: (k: string, g: string, name: string) =>
      r<{ groupId: string; name: string }>('PUT', `${A(k)}/groups/${e(g)}`, { name }),
    deleteGroup: (k: string, g: string) => r<void>('DELETE', `${A(k)}/groups/${e(g)}`),
    appointGroupAdmin: (k: string, g: string, u: string) =>
      r<void>('PUT', `${A(k)}/groups/${e(g)}/admins/${e(u)}`),
    unappointGroupAdmin: (k: string, g: string, u: string) =>
      r<void>('DELETE', `${A(k)}/groups/${e(g)}/admins/${e(u)}`),

    // families, phone list and privacy: member-facing
    dismissCard: (k: string, card: DismissCard) => r<void>('POST', `${K(k)}/me/cards/${e(card)}/dismiss`),
    putPhoneList: (k: string, show: boolean) => r<{ show: boolean }>('PUT', `${K(k)}/me/phone-list`, { show }),
    phoneList: (k: string) => r<PhoneListFamily[]>('GET', `${K(k)}/phone-list`),
    family: (k: string) => r<FamilyView>('GET', `${K(k)}/family`),
    addChild: (k: string, c: ChildFields) => r<Child>('POST', `${K(k)}/family/children`, c),
    editChild: (k: string, id: string, c: ChildFields) => r<Child>('PUT', `${K(k)}/family/children/${e(id)}`, c),
    removeChild: (k: string, id: string) => r<void>('DELETE', `${K(k)}/family/children/${e(id)}`),
    familyCandidates: (k: string) => r<Candidate[]>('GET', `${K(k)}/family/candidates`),
    requestPartner: (k: string, toUserId: string) =>
      r<{ toUserId: string; expiresAt: number }>('POST', `${K(k)}/family/requests`, { toUserId }),
    withdrawPartnerRequest: (k: string) => r<void>('DELETE', `${K(k)}/family/requests/mine`),
    confirmPartner: (k: string, fromUserId: string) =>
      r<FamilyView>('POST', `${K(k)}/family/requests/${e(fromUserId)}/confirm`),
    declinePartner: (k: string, fromUserId: string) =>
      r<void>('POST', `${K(k)}/family/requests/${e(fromUserId)}/decline`),
    unlink: (k: string) => r<FamilyView>('POST', `${K(k)}/family/unlink`),
    targetFamilies: (k: string, channelId: string) =>
      r<TargetFamily[]>('GET', `${K(k)}/families${query([['channelId', channelId]])}`),

    // groups: member-facing and group admins
    myGroups: (k: string) => r<GroupMembership[]>('GET', `${K(k)}/groups`),
    requestGroup: (k: string, g: string) => r<Record<string, never>>('POST', `${K(k)}/groups/${e(g)}/requests`),
    withdrawGroupRequest: (k: string, g: string) => r<void>('DELETE', `${K(k)}/groups/${e(g)}/requests/me`),
    groupRequests: (k: string, g: string) => r<GroupRequestRow[]>('GET', `${K(k)}/groups/${e(g)}/requests`),
    approveGroupRequest: (k: string, g: string, u: string) =>
      r<Record<string, never>>('POST', `${K(k)}/groups/${e(g)}/requests/${e(u)}/approve`),
    rejectGroupRequest: (k: string, g: string, u: string) =>
      r<void>('DELETE', `${K(k)}/groups/${e(g)}/requests/${e(u)}`),
    groupMembers: (k: string, g: string) => r<GroupMemberRow[]>('GET', `${K(k)}/groups/${e(g)}/members`),
    removeGroupMember: (k: string, g: string, u: string) =>
      r<void>('DELETE', `${K(k)}/groups/${e(g)}/members/${e(u)}`),
    leaveGroup: (k: string, g: string) => r<void>('DELETE', `${K(k)}/groups/${e(g)}/members/me`),
  };
}
