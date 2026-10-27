// Accept both current server payloads and notifications sent by older clients.
export function opensMessages(data: Record<string, unknown> | undefined): boolean {
  return !!data && (['messages', 'healing', 'membership'].includes(String(data.screen)) || typeof data.messageId === 'string');
}
