export type Scheme = 'light' | 'dark';
// Server message types (routes_messages.TYPES plus chat).
export type MessageType = 'weekly' | 'celebration' | 'condolence' | 'event' | 'general' | 'chat';

const light = {
  stone: '#F6F7F2', ink: '#151A33', tekhelet: '#2A3F94', pomegranate: '#A32A47', ash: '#555B75',
  gold: '#8F6512', olive: '#44652A', band: '#161C44',
  surface: '#FFFFFF', line: '#DDE0D4', muted: '#555B75', onAction: '#FFFFFF', danger: '#A32A47',
};
const dark: typeof light = {
  stone: '#10132A', ink: '#ECEEF7', tekhelet: '#8FA2F0', pomegranate: '#E8829A', ash: '#AEB4CC',
  gold: '#D9AD55', olive: '#93BC72', band: '#0A0D24',
  surface: '#1A1E3A', line: '#2E3358', muted: '#AEB4CC', onAction: '#10132A', danger: '#E8829A',
};
export type Tokens = typeof light;
export const tokens = (scheme: Scheme): Tokens => (scheme === 'dark' ? dark : light);

/** Type scale: 28 / 21 / 19 / 16 / 14 / 12.5 (minimum). */
export const type = { display: 28, title: 21, heading: 19, body: 16, small: 14, caption: 12.5 } as const;
export const TOUCH = 48;
export const fonts = { ui: 'Heebo_400Regular', uiBold: 'Heebo_700Bold', title: 'NotoSerifHebrew_700Bold' } as const;

/** Stripe (message edge) colour per message type. */
export function edge(t: MessageType, scheme: Scheme = 'light'): string {
  const k = tokens(scheme);
  return { weekly: k.gold, celebration: k.pomegranate, condolence: k.ash, event: k.tekhelet, general: k.tekhelet, chat: k.tekhelet }[t];
}
