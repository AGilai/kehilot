import { config } from '../config.ts';
import { ApiCodeError } from './errors.ts';
import { endpoints } from './endpoints.ts';
import type { Http } from './http.ts';
import type { Kehila, Lang, Role } from './types.ts';

export type FixtureParams = { role: Role; lang: Lang | null; screen: string | null };

/** Fixture mode is for screenshots and demos only: it must never run beside a real API. */
export function assertFixturesAllowed(apiUrl: string = config.apiUrl): void {
  if (apiUrl) throw new Error('EXPO_PUBLIC_FIXTURES and EXPO_PUBLIC_API_URL are both set');
}

export function parseFixtureParams(search: string): FixtureParams {
  const q = new URLSearchParams(search);
  const role = q.get('role');
  const lang = q.get('lang');
  return {
    role: role === 'listener' || role === 'gabbai' ? role : 'member',
    lang: lang === 'he' || lang === 'en' ? lang : null,
    screen: q.get('screen'),
  };
}

export function fixtureParams(): FixtureParams {
  const search = typeof window !== 'undefined' && window.location ? window.location.search : '';
  return parseFixtureParams(search);
}

// All names below are invented.
export function createFixtureApi(role: Role, screen: string | null = null) {
  assertFixturesAllowed();
  const kehila: Kehila = {
    kehilaId: '01FIXTUREKEHILA0000000001', name: 'קהילת בדיוני', role, classification: '', logoVersion: null,
    canBroadcast: role === 'gabbai', pendingRequest: false,
    notify: { mutedChannels: [], mutedTypes: [], membersBroadcasts: 'all', mutedMembers: [], chatChannels: [] },
    groups: [], adminGroups: [], settings: { pollSeconds: 60 },
  };
  const me = {
    userId: '01FIXTUREUSER00000000001', email: 'dana@example.invalid',
    // ?screen=profile shows the profile form; ?screen=switcher gives three Kehilot and no remembered choice.
    profile: screen === 'profile' ? null : { firstName: 'דנה', lastName: 'בדויה', lang: 'he' as Lang },
    kehilot: [
      { kehilaId: kehila.kehilaId, name: kehila.name, role, logoVersion: null },
      ...(screen === 'switcher' ? [
        { kehilaId: '01FIXTUREKEHILA0000000002', name: 'בית כנסת הדוגמה', role: 'gabbai' as Role, logoVersion: null },
        { kehilaId: '01FIXTUREKEHILA0000000003', name: 'קהילת הנחל המצויר', role: 'listener' as Role, logoVersion: null },
      ] : []),
    ],
  };
  const channels = [{
    channelId: '01FIXTURECHANNEL00000001', name: 'הודעות הקהילה', listenersCanRead: true, postPolicy: 'management' as const,
    canPost: role === 'gabbai', inAudience: true, conversation: false, chatHourlyLimit: 0, isAdmin: role === 'gabbai',
  }];
  const messages = [{
    messageId: '01FIXTUREMESSAGE0000001', channelId: channels[0]!.channelId, type: 'weekly' as const, title: 'שבת שלום מהקהילה הבדיונית',
    body: 'הודעת דוגמה בלבד.', authorId: 'm1', authorName: 'יוסי לדוגמה', authorKind: 'management' as const, joinCount: 0,
  }];
  const routes: Record<string, unknown> = {
    'GET /v1/me': me,
    'PUT /v1/me/profile': { firstName: 'דנה', lastName: 'בדויה', lang: 'he' },
    [`GET /v1/kehilot/${kehila.kehilaId}`]: kehila,
    [`GET /v1/kehilot/${kehila.kehilaId}/channels`]: channels,
    [`GET /v1/kehilot/${kehila.kehilaId}/messages`]: messages,
  };
  for (const x of me.kehilot.slice(1)) {
    routes[`GET /v1/kehilot/${x.kehilaId}`] = { ...kehila, kehilaId: x.kehilaId, name: x.name, role: x.role };
    routes[`GET /v1/kehilot/${x.kehilaId}/channels`] = channels;
  }
  const http: Http = {
    async request(method, path) {
      const hit = routes[`${method} ${path.split('?')[0]}`];
      if (hit === undefined) throw new ApiCodeError(404, 'not_found');
      return structuredClone(hit) as any;
    },
  };
  return endpoints(http);
}

