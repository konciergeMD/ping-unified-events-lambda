// Ping environment routing config. Secret values (Mixpanel token, Ping client secret) live in AWS Secrets Manager 

import { SecretsManager } from 'aws-sdk';

export type Direction = 'inbound' | 'outbound';

export interface PingEnv {
  id: string;
  name: string;
  // AWS Secrets Manager secret (JSON) shared with the Okta lambda
  // this lambda uses mixpanelToken, pingClientSecret
  secretId: string;
  outboundApps: string[];
  inboundApps: string[];
  pingClientId: string | null;
  // populated from Secrets Manager:
  token?: string;
  pingClientSecret?: string | null;
}

// Non-secret config
export const PING_ENVIRONMENTS: Record<string, PingEnv> = {
  test3: {
    id: '9221ad0f-1c2f-4873-b6b4-9ff0b8011c82',
    name: 'Non-Prod Unified',
    secretId: '/identity/lambda/unified-migration-event-svc/test',
    // if accessed resource is one of these apps, the event is an outbound sso (app calls back to okta)
    outboundApps: ['71d1203c-28c0-4814-8e79-2259d261b23e'],
    // if accessed resource is one of these apps, the event is an inbound sso (app goes to portal)
    inboundApps: [
      '6563a2eb-cfcb-4d5c-acc7-000551d6f7be', // Android
      '5566e1f4-49cb-4a99-9043-d43b729f7671', // Web
      '58e7d1ac-1b67-4ed9-8713-27d749b414cb'  // iOS
    ],
    pingClientId: '23b05b34-f49c-468c-bd25-094ce833fe87'
  },
  prod: {
    id: 'c4d8d0fc-156e-4938-8671-b725f085d585',
    name: 'Prod Unified',
    secretId: '/identity/lambda/unified-migration-event-svc/prod',
    outboundApps: [],
    inboundApps: [],
    pingClientId: ''
  }
};

// The Ping environment id is on both 'actors'
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

// app-id -> direction
export function directionByAppId(env: PingEnv): Record<string, Direction> {
  const map: Record<string, Direction> = {};
  for (const id of env.outboundApps) map[id] = 'outbound';
  for (const id of env.inboundApps) map[id] = 'inbound';
  return map;
}

// declared at module scope, run once per warm container
const secretsClient = new SecretsManager();
// Cache the merged env per Ping env id to limmit calls if needed
// declared at module scope, run once per warm container
const cachedEnvById: Record<string, PingEnv> = {};

interface PingSecret {
  mixpanelToken?: string;
  pingClientSecret?: string;
}

// Resolve env from event and merge the secret values
export async function loadPingEnv(event: any): Promise<PingEnv | undefined> {
  const base = resolvePingEnv(event);
  if (!base) return undefined;

  const cached = cachedEnvById[base.id];
  if (cached) return cached;

  const { SecretString } = await secretsClient
    .getSecretValue({ SecretId: base.secretId })
    .promise();
  if (!SecretString) {
    throw new Error(`Secret ${base.secretId} has no SecretString`);
  }
  const secret: PingSecret = JSON.parse(SecretString);

  const merged: PingEnv = {
    ...base,
    token: secret.mixpanelToken,
    pingClientSecret: secret.pingClientSecret ?? null //could chace null if not fetched and cause issues for multiple runs - should retry?
  };
  cachedEnvById[base.id] = merged;
  return merged;
}