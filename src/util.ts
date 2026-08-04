import { Direction, PingEnv } from './config';


// get token
export async function fetchPingToken(env: PingEnv): Promise<string | null> {
  if (!env || !env.pingClientId || !env.pingClientSecret) {
    return null;
  }
  const auth = Buffer.from(`${env.pingClientId}:${env.pingClientSecret}`).toString('base64');
  const res = await fetch(`https://auth.pingone.com/${env.id}/as/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) {
    console.error(`PingOne token request failed: HTTP ${res.status}`);
    return null;
  }
  const json: any = await res.json();
  return json?.access_token ?? null;
}

