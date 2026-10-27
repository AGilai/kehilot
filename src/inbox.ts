import type { CommunityMessage, HealingPrayer, MemberState } from './types.ts';

export const HEALING_MESSAGE_PREFIX = 'healing-reminder-';
export const healingMessageId = (cycleId: string) => HEALING_MESSAGE_PREFIX + cycleId;

function reminderMessage(entry: HealingPrayer): CommunityMessage {
  const reminder = entry.reminder!;
  const introduction = reminder.confirmedOn ? 'חלפו שבועיים מאז שאישרת להשאיר את השם' : 'חלפו שבועיים מאז שהוספת את השם';
  return { id: healingMessageId(reminder.cycleId), kind: 'healing', category: 'event', title: `תזכורת למי שברך לחולים: ${entry.name}`,
    body: `${introduction} ${entry.name} למי שברך לחולים. האם להשאיר את השם ברשימה או להסירו?`,
    author: 'תזכורת אישית', createdAt: `${reminder.createdOn || reminder.dueOn}T12:00:00Z`, pinned: false, replies: [],
    healing: { prayerId: entry.id, cycleId: reminder.cycleId, expiresOn: reminder.expiresOn } };
}

// Keep the inbox in step with successful keep/delete actions and demo refreshes.
// Preserve server timestamps for messages already returned by the private API.
export function syncHealingInbox(state: MemberState): MemberState {
  const reminders = state.healingPrayers.filter(entry => entry.reminder?.pending).map(entry =>
    state.messages.find(message => message.kind === 'healing' && message.id === healingMessageId(entry.reminder!.cycleId)) || reminderMessage(entry));
  const currentIds = new Set(reminders.map(message => message.id));
  const read = new Set(state.readIds.filter(id => !id.startsWith(HEALING_MESSAGE_PREFIX) || currentIds.has(id)));
  for (const entry of state.healingPrayers) if (entry.reminder?.pending && entry.reminder.read) read.add(healingMessageId(entry.reminder.cycleId));
  return { ...state, messages: [...state.messages.filter(message => message.kind !== 'healing'), ...reminders], readIds: [...read] };
}

export function unreadMessageCount(state: Pick<MemberState, 'messages' | 'readIds'>): number {
  const read = new Set(state.readIds);
  return state.messages.filter(message => !read.has(message.id)).length;
}
