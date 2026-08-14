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
    // "Non-Prod Unified" — the env this lambda monitors. (Note: 470ae5bd-… "SSO Partner Test - Unified Transcarent" is a separate test-IdP env used to originate inbound, not this one.)
    id: '9221ad0f-1c2f-4873-b6b4-9ff0b8011c82',
    name: 'Non-Prod Unified',
    secretId: '/identity/lambda/unified-migration-event-svc/test',
    // if accessed resource is one of these apps, the event is an outbound sso (app calls back to okta)
    outboundApps: [
      '71d1203c-28c0-4814-8e79-2259d261b23e', // Nonprod - Unified Transcarent - Outbound SSO Proxy
      '5666a895-f092-4658-a851-9d5aa458a65b' // TC Okta Outbound SSO (Ping SAML app) — the Ping→Okta outbound federation app
    ],
    // if accessed resource is one of these apps, the event is an inbound sso (app goes to portal)
    // Inbound confirmed 2026-08-09: an external IdP → Okta → Ping login lands on the Web App
    // below and runs Ping's Single_Factor policy (NOT Inbound-Federation-SSO, which gets zero
    // hits) — see README "Single_Factor is a temporary discriminator".
    inboundApps: [
      '60e1487c-366f-4148-a20f-40ba6f2bcc2e', // TC Okta (Ping external IdP) — the Okta→Ping inbound federation object
      '6563a2eb-cfcb-4d5c-acc7-000551d6f7be', // Android
      '5566e1f4-49cb-4a99-9043-d43b729f7671', // Web (Unified Transcarent Web App) — confirmed inbound landing app
      '58e7d1ac-1b67-4ed9-8713-27d749b414cb'  // iOS
    ],
    // TODO the "Track Proxy SSO" webhook is scoped to 7 applications, but only the 6 ids above
    // are mapped. "Unified Transcarent" and "External Partner Test" have no entry, so their
    // events arrive and are emitted as PING.unknown_direction.* — add their ids and a
    // direction. "External Partner Test" is likely the inbound origination app.
    pingClientId: '23b05b34-f49c-468c-bd25-094ce833fe87'
  },
  prod: {
    id: 'c4d8d0fc-156e-4938-8671-b725f085d585',
    name: 'Prod Unified',
    secretId: '/identity/lambda/unified-migration-event-svc/prod',
    // TODO: prod outbound SSO proxy / TC Okta outbound SAML app ids not yet collected —
    // until they are here, outbound events emit as PING.unknown_direction.*
    outboundApps: ['c695c059-7d72-42e5-91d0-e841b97a407c'], //TC Okta Outbound SSO
    inboundApps: [
      'e9e0e9e0-feb8-47fd-93c8-4dd319a4501e', // TC Okta (Ping external IdP) — inbound SAML IdP trusting prod-tc Okta
      '06b50525-08dd-4a4c-91da-8ed604f76b35', // Unified Transcarent Android App
      '7f71ab98-905f-4859-bc88-de7bcc8e69f6', // Unified Transcarent Web App
      '6fbd61bd-5ff4-4840-a17a-b0123de7cb52'  // Unified Transcarent iOS App
    ],
    pingClientId: '6f4c12cf-db01-4d1f-bc92-7574acb0cc66'
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