import { SSM } from 'aws-sdk';
import { Direction, PingEnv, directionByAppId } from './config';

// Ping events forwarded to Mixpanel
//'USER.ACCESS_ALLOWED', 'USER.ACCESS_DENIED' - access to SP application (for OB, user has valid session and passed access controls)
// FLOW.CREATED, FLOW.UPDATED, FLOW.DELETED - user journey through auth flow?
// user.session.created - new session started for user in env
export const ACCESS_EVENT_TYPES = ['USER.ACCESS_ALLOWED', 'USER.ACCESS_DENIED'];

export function isAccessEvent(event: any): boolean {
  return ACCESS_EVENT_TYPES.includes(event?.action?.type);
}

type ResolvedDirection = Direction | 'unable to determine direction';

// ACCESS events resource is the app (actors.client) - Direction is determined by matching the id against the configured inbound/outbound apps
// outboundApp (Ping app that calls back to Okta) → outbound AND   - inboundApp  (Ping app that calls to the portal) → inbound
// an unmatched app id is reported as unknown (event hook filters app so unlikely)
function resolveDirection(appId: string | undefined, pingEnv?: PingEnv): ResolvedDirection {
  if (pingEnv && appId) {
    const byId = directionByAppId(pingEnv);
    if (byId[appId]) {
      return byId[appId];
    }
  }
  return 'unable to determine direction';
}


// Use Ping ID to find ssoUUID 
export async function fetchPingUser(logEvent: any, env: PingEnv, token: string | null): Promise<string | null> {
  const user = logEvent?.actors?.user.id;
  if (!user || !token) {
    return 'UNABLE_TO_FIND_PING_USER';
  }
  const res = await fetch(
    `https://api.pingone.com/v1/environments/${env.id}/users/${user}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  if (!res.ok) {
    console.error(`PingOne user lookup failed for ${user}: HTTP ${res.status}`);
    return 'unableToGetPingId';
  }

  // GET /users/{id} returns the single user resource directly (not an _embedded collection).
  const json: any = await res.json();
  return json?.ssoUUID ?? 'UNABLE_TO_FIND_SSO_UUID';
}




// transform a Ping log  into a Mixpanel /import event body.
export async function transformToMixpanel(event: any, pingEnv?: PingEnv, pingToken?: string | null): Promise<any> {
  const user = event.actors.user;
  const client = event.actors.client; // the requesting app (relying party)
  const ssoUUID = await fetchPingUser(event, pingEnv!, pingToken!); 

  const direction = resolveDirection(client?.id, pingEnv);

  return {
    // SYSTEM.DIRECTION.ACTION_TYPE
    event: `PING.${direction}.${event.action.type}`,
    properties: {
      // Mixpanel required fields
      time: Math.floor(Date.parse(event.recordedAt) / 1000),
      // correlationId is stable across the events in one flow (Okta groups login by externalSessionId)
      distinct_id: event.correlationId ?? event.internalCorrelation?.transactionId ?? user.id,
      $insert_id: event.id, // stable Ping event id doubles as the dedup key

      // requested attributes
      environment_id: user.environment.id,
      environment_name: pingEnv?.name ?? null,
      user_ping_id: user.id,
      ssoUUID: ssoUUID ?? 'UNABLE_TO_FIND_SSO_UUID',
      // user_name: user.name, // opaque id, not necessarily an email
      action_type: event.action.type,
      action_description: event.action.description,
      direction,
      // The accessed resource on an ACCESS event is the service-provider app.
      app_name: client?.name ?? null,
      app_id: client?.id ?? null,
      result_status: event.result.status,
      ping_timestamp: event.recordedAt,
      correlation_id: event.correlationId
    }
  };
}

const ssm = new SSM();
const tokenCache: Record<string, string> = {};

// strict=1 makes Mixpanel validate and return per-record error details.
const MIXPANEL_IMPORT_URL = 'https://api.mixpanel.com/import?strict=1';

// get a Mixpanel token from SSM SecureString param. 
export async function getToken(paramName: string): Promise<string> {
  if (tokenCache[paramName]) {
    return tokenCache[paramName];
  }

  const result = await ssm.getParameter({ Name: paramName, WithDecryption: true }).promise();
  const token = result.Parameter?.Value;
  if (!token) {
    throw new Error(`SSM parameter ${paramName} has no value`);
  }

  tokenCache[paramName] = token;
  return token;
}

// POST an event to Mixpanel 
export async function sendToMixpanel(event: unknown, token: string): Promise<void> {
  const auth = Buffer.from(`${token}:`).toString('base64');
  const response = await fetch(MIXPANEL_IMPORT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`
    },
    body: JSON.stringify([event])
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Mixpanel HTTP ${response.status}: ${text}`);
  }

  const parsed = JSON.parse(text);
  if (parsed.code !== 200) {
    throw new Error(`Mixpanel rejected event: ${text}`);
  }
}
