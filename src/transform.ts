import { SSM } from 'aws-sdk';

// Ping events forwarded to Mixpanel
export const ASSERTION_TYPES = ['ASSERTION.CHECK_SUCCESS', 'ASSERTION.CHECK_FAILED'];

export function isAssertionEvent(event: any): boolean {
  return ASSERTION_TYPES.includes(event?.action?.type);
}

// transform a Ping log  into a Mixpanel /import event body.
export function transformToMixpanel(event: any, environmentName: string | null = null) {
  const user = event.actors.user;
  const app = event.resources[0];

  return {
    event: event.action.type,
    properties: {
      // Mixpanel required fields
      time: Math.floor(Date.parse(event.recordedAt) / 1000),
      distinct_id: user.id, // Ping id
      $insert_id: event.id, // stable Ping event id doubles as the dedup key

      // requested attributes
      environment_id: app.environment.id,
      environment_name: environmentName ?? app.environment.name ?? null,
      user_ping_id: user.id,
      user_name: user.name,
      action_type: event.action.type,
      action_description: event.action.description,
      resource_name: app.name,
      resource_id: app.id,
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
