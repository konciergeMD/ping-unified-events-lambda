import { Direction, PingEnv, directionByAppId } from './config';

// FLOW.CREATED ("Sign-on flow started") the ONLY signal that outbound attempt reached ping
// Okta doesnt log unitl getting a response, so abandoned at Ping leaves no proof 
// FLOW.DELETED ("Sign-on flow finished") — result.status/description carry is outcome
//
// FLOW.UPDATED ("Sign-on flow continued") is deliberately NOT tracked: real audit rows show
// it duplicating FLOW.DELETED in the same second with an identical description.
// check this - do all send both?
//
// USER.ACCESS_* confirm the app was actually reached, fire when a user reaches the app on an existing session with no sign-on flow 

export const TRACKED_EVENT_TYPES = [
  'FLOW.CREATED',
  'FLOW.DELETED',
  'USER.ACCESS_ALLOWED',
  'USER.ACCESS_DENIED'
];

export function isTrackedEvent(event: any): boolean {
  return TRACKED_EVENT_TYPES.includes(event?.action?.type);
}

// Kept a single token so the Mixpanel event name stays dot-delimited with no spaces.
type ResolvedDirection = Direction | 'unknown_direction';

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
  return 'unknown_direction';
}

// fill in for a failed fetch sso_uuid. 
const NO_USER = 'unable to find ping user';
const LOOKUP_FAILED = 'unable to fetch ping user';
const NO_SSO_UUID = 'unable to find sso_uuid';
const SSO_UUID_SENTINELS = [NO_USER, LOOKUP_FAILED, NO_SSO_UUID];

// Use Ping ID to find sso_uuid.
// FLOW.CREATED has no actors.user so NO_USER is the normal outcome there, not an error.
export async function fetchPingUser(logEvent: any, env: PingEnv, token: string | null): Promise<string> {
  const user = logEvent?.actors?.user?.id;
  if (!user || !token) {
    return NO_USER;
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
    return LOOKUP_FAILED;
  }

  const json: any = await res.json();
  return json?.ssoUUID ?? NO_SSO_UUID;
}

// distinct_id is sso_uuid
//
// FLOW.CREATED has no user, it falls back to flow's transaction id. 
// CANNOT be step 1 of funnel with user-keyed events — count abandonment by count(FLOW.CREATED) - count(FLOW.DELETED) grouped by transaction_id
function resolveDistinctId(ssoUUID: string, pingUserId?: string, transactionId?: string): string {
  if (!SSO_UUID_SENTINELS.includes(ssoUUID)) return ssoUUID;
  const searched = pingUserId ?? transactionId;
  return searched ? `${ssoUUID}:${searched}` : ssoUUID;
}




// transform a Ping log  into a Mixpanel /import event body.
export async function transformToMixpanel(event: any, pingEnv?: PingEnv, pingToken?: string | null): Promise<any> {

  // FLOW.CREATED carries no actors.user, so leave this undefined rather than defaulting to a
  // string — every read below is optional-chained and a string would silently answer
  // undefined to `.id`/`.environment` instead of being an honest absence.
  const user = event?.actors?.user;
  const client = event?.actors?.client; // the requesting app (relying party)
  const ssoUUID = await fetchPingUser(event, pingEnv!, pingToken!);

  const direction = resolveDirection(client?.id, pingEnv);
  const transactionId = event?.internalCorrelation?.transactionId;
  // The FLOW resource groups the events of one sign-on flow. Present on FLOW.* events; absent
  // on USER.ACCESS_* (whose resources[] holds the USER instead), hence null there.
  const flowId = (event?.resources ?? []).find((r: any) => r?.type === 'FLOW')?.id;

  return {
    // SYSTEM.DIRECTION.ACTION_TYPE
    event: `PING.${direction}.${event?.action?.type}`,
    properties: {
      // Mixpanel required fields
      time: Math.floor(Date.parse(event.recordedAt) / 1000),
      distinct_id: resolveDistinctId(ssoUUID, user?.id, transactionId),
      $insert_id: event.id, // stable Ping event id doubles as the dedup key

      // requested attributes
      environment_id: user?.environment?.id ?? client?.environment?.id ?? null,
      environment_name: pingEnv?.name ?? null,
      user_ping_id: user?.id ?? null,
      sso_uuid: ssoUUID,
      // user_name: user.name, // opaque id, not necessarily an email
      action_type: event?.action?.type ?? null,
      action_description: event?.action?.description ?? null,
      direction,
      // The accessed resource on an ACCESS event is the service-provider app.
      app_name: client?.name ?? null,
      app_id: client?.id ?? null,
      result_status: event?.result?.status ?? null,
      result_description: event?.result?.description ?? null,
      ping_timestamp: event.recordedAt,
      // correlationId is per-EVENT, not per-flow 
      transaction_id: transactionId ?? null,
      flow_id: flowId ?? null,
      correlation_id: event.correlationId
    }
  };
}

// strict=1 makes Mixpanel validate and return per-record error details.
const MIXPANEL_IMPORT_URL = 'https://api.mixpanel.com/import?strict=1';

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
