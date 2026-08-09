import { AcpAmpTransport, AlfLogger, AlfLoggerContextBuilder, LogFactory } from '@acp/common-logging';
import { isTrackedEvent, sendToMixpanel, transformToMixpanel } from './transform';
import { loadPingEnv, PingEnv } from './config';
import { fetchPingToken } from './util';

const logFactory = new LogFactory();
const acpTransport = new AcpAmpTransport({
  stack: process.env.stack!,
  owner: 'identity',
  systemName: 'identity-ping-unified-events-svc'
});

logFactory.addTransport(acpTransport);
const logger = logFactory.buildLogger(AlfLogger, new AlfLoggerContextBuilder().build());


// Raw payloads carry PII (email, IP, geolocation, user agent). Useful while testing, never
// in prod — so the dump is gated on the deployment environment rather than removed.
const LOG_RAW_EVENTS = process.env.Environment !== 'prod';

export const handler = async (event: any) => {
  if (LOG_RAW_EVENTS) {
    logger.info(`Received Ping event: ${JSON.stringify(event)}`);
  }

  if (!isTrackedEvent(event)) {
    logger.info(`Ignoring other event type: ${event?.action?.type}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Ignored' })
    };
  }

  let pingEnv: PingEnv | undefined;
  try {
    pingEnv = await loadPingEnv(event);
  } catch (err) {
    // Can't read the secret -> 500 so source retries (fail closed)
    logger.error(`Failed to load config/secrets for '${process.env.Environment}': ${err}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Not configured' })
    };
  }
  if (!pingEnv) {
    logger.info(`Ignoring event from unrecognized Ping environment`);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Ignored' })
    };
  }

  const pingToken = await fetchPingToken(pingEnv);

  const mixpanelBody = await transformToMixpanel(event, pingEnv, pingToken);
  logger.info(`Transformed event: ${JSON.stringify(mixpanelBody)}`);

  try {
    const token = pingEnv.token;
    if (!token) {
      throw new Error(`No Mixpanel token configured for ${pingEnv.name}`);
    }
    await sendToMixpanel(mixpanelBody, token);
    logger.info(`Sent event to Mixpanel (${pingEnv.name})`);
  } catch (err) {
    logger.error(`Failed to send event to Mixpanel: ${err}`);
    throw err;
  }

  return {
    statusCode: 200,
    body: JSON.stringify(mixpanelBody)
  };
};
