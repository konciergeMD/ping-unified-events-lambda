// Ping environment name and the SSM SecureString parameter with Mixpanel project token.

export interface PingEnv {
  name: string;
  tokenParam: string;
  // TEMP: hardcoded token until SSM is set up. Test project only. Move to SSM.
  token?: string;
  outboundApp: string;
  inboundApp: string;
}

export const PING_ENVIRONMENTS: Record<string, PingEnv> = {
  '9221ad0f-1c2f-4873-b6b4-9ff0b8011c82': {
    name: 'Non-Prod Unified',
    tokenParam: '/identity/ping-unified-events/mixpanel-token-nonprod',
    token: '1aed6df8282444d208215485628f4d6f',
    outboundApp: '71d1203c-28c0-4814-8e79-2259d261b23e',
    inboundApp: '5566e1f4-49cb-4a99-9043-d43b729f7671'
  },
  'c4d8d0fc-156e-4938-8671-b725f085d585': {
    name: 'Prod Unified',
    tokenParam: '/identity/ping-unified-events/mixpanel-token-prod',
    outboundApp: 'REPLACE_ME',
    inboundApp: 'REPLACE_ME'
  }
};

// The Ping environment id lives on both actors; they match.
export function getPingEnvId(event: any): string | undefined {
  return event?.actors?.user?.environment?.id ?? event?.actors?.client?.environment?.id;
}

export function resolvePingEnv(event: any): PingEnv | undefined {
  const id = getPingEnvId(event);
  return id ? PING_ENVIRONMENTS[id] : undefined;
}
