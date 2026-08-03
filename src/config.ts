// Ping environment name and the SSM SecureString parameter with Mixpanel project token.

export type Direction = 'inbound' | 'outbound';

export interface PingEnv {
  id: string;
  name: string;
  tokenParam: string;
  // TEMP: hardcoded token until SSM is set up. Test project only. Move to SSM.
  token?: string;
  outboundApps: string[];
  inboundApps: string[];
  pingClientId: string | null;
  pingClientSecret: string | null;

}

export const PING_ENVIRONMENTS: Record<string, PingEnv> = {
  test3: {
    id: '9221ad0f-1c2f-4873-b6b4-9ff0b8011c82',
    name: 'Non-Prod Unified',
    tokenParam: '/identity/ping-unified-events/mixpanel-token-nonprod',
    token: '1aed6df8282444d208215485628f4d6f',
    // if accessed resource is one of these apps, the event is an outbound sso (app calls back to okta)
    outboundApps: ['71d1203c-28c0-4814-8e79-2259d261b23e'],
    // if accessed resource is one of these apps, the event is an inbound sso (app goes to portal)
    inboundApps: [
      '6563a2eb-cfcb-4d5c-acc7-000551d6f7be', // Android
      '5566e1f4-49cb-4a99-9043-d43b729f7671', // Web
      '58e7d1ac-1b67-4ed9-8713-27d749b414cb'  // iOS
    ],
    pingClientId: '23b05b34-f49c-468c-bd25-094ce833fe87',
    pingClientSecret: 'k2OLjwNbpqE8n~xpJPgEZG.RByXWH7GiMWHf4SztZFUOtH67.GvBVUuHGg3Q5ykc'
  },
  prod: {
    id: 'c4d8d0fc-156e-4938-8671-b725f085d585',
    name: 'Prod Unified',
    tokenParam: '/identity/ping-unified-events/mixpanel-token-prod',
    outboundApps: [],
    inboundApps: [],
    pingClientId: '',
    pingClientSecret: ''
  }
};

// The Ping environment id lives on both actors; they match.
export function getPingEnvId(event: any): string | undefined {
  return event?.actors?.user?.environment?.id ?? event?.actors?.client?.environment?.id;
}

export function resolvePingEnv(event: any): PingEnv | undefined {
  const id = getPingEnvId(event);
  if (!id) {
    return undefined;
  }
  return Object.values(PING_ENVIRONMENTS).find((env) => env.id === id);
}

// app-id → direction
export function directionByAppId(env: PingEnv): Record<string, Direction> {
  const map: Record<string, Direction> = {};
  for (const id of env.outboundApps) map[id] = 'outbound';
  for (const id of env.inboundApps) map[id] = 'inbound';
  return map;
}