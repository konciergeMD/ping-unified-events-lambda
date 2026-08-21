import { SSM } from 'aws-sdk';
import { PingEnv } from './config';

// Shared token cache- Uses token TTL, cache it in two layers:
//   1: module-scope map - reused per warm container
//   2: SSM Parameter Store - shared across all concurrent containers
// On a miss/near-expiry a single caller getsa  new token and writes it to Parameter Store.

// declared at module scope, run once per warm container
const ssm = new SSM();
const tokenCacheById: Record<string, CachedToken> = {};

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Refresh this many seconds before the real expiry and random jitter so the containers don't all refresh
const REFRESH_MARGIN_SECONDS = 300;
const REFRESH_JITTER_SECONDS = 60;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isFresh(entry: CachedToken | undefined): entry is CachedToken {
  if (!entry) return false;
  const margin = REFRESH_MARGIN_SECONDS + Math.floor(Math.random() * REFRESH_JITTER_SECONDS);
  return entry.expiresAt - nowSeconds() > margin;
}

// SSM param that holds the cached token 
function paramName(env: PingEnv): string {
  const prefix =
    process.env.PING_TOKEN_PARAM_PREFIX ??
    '/identity/lambda/ping-unified-events-svc/ping-token';
  return `${prefix}/${env.id}`;
}

// pull cached token from SSM 
async function readTokenFromSsm(env: PingEnv): Promise<CachedToken | undefined> {
  try {
    const { Parameter } = await ssm
      .getParameter({ Name: paramName(env), WithDecryption: true })
      .promise();
    if (!Parameter?.Value) return undefined;
    const parsed = JSON.parse(Parameter.Value) as CachedToken;
    return parsed?.token ? parsed : undefined;
  } catch (err: any) {
    // ParameterNotFound means none fetched yet -> fetch
    if (err?.code !== 'ParameterNotFound') {
      console.error(`Failed to read Ping token from SSM: ${err}`);
    }
    return undefined;
  }
}

// 2 write: store new token 
async function writeTokenToSsm(env: PingEnv, entry: CachedToken): Promise<void> {
  try {
    await ssm
      .putParameter({
        Name: paramName(env),
        Value: JSON.stringify(entry),
        Type: 'SecureString',
        Overwrite: true
      })
      .promise();
  } catch (err: any) {
    // TooManyUpdates = several cold containers minted concurrently and raced on this write.
    // Benign: a valid token still won, and each container keeps its own in-memory copy either
    // way, so this is not worth an ERROR line.
    if (err?.code === 'TooManyUpdates') {
      return;
    }
    console.error(`Failed to write Ping token to SSM: ${err}`);
  }
}

// get new token from PingOne
async function mintPingToken(env: PingEnv): Promise<CachedToken | null> {
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
  const token = json?.access_token;
  if (!token) return null;
  // expires_in is seconds-from-now, uses 1h if Ping doesn't add it.
  const expiresIn = typeof json?.expires_in === 'number' ? json.expires_in : 3600;
  return { token, expiresAt: nowSeconds() + expiresIn };
}

// get token 
export async function fetchPingToken(env: PingEnv): Promise<string | null> {
  if (!env || !env.pingClientId || !env.pingClientSecret) {
    return null;
  }

  // 1: warm-container memory
  if (isFresh(tokenCacheById[env.id])) {
    return tokenCacheById[env.id].token;
  }

  // 2: shared SSM cache 
  const fromSsm = await readTokenFromSsm(env);
  if (isFresh(fromSsm)) {
    tokenCacheById[env.id] = fromSsm;
    return fromSsm.token;
  }

  // Miss/near-expiry: get fresh and populate
  const minted = await mintPingToken(env);
  if (!minted) return null;
  tokenCacheById[env.id] = minted;
  await writeTokenToSsm(env, minted);
  return minted.token;
}