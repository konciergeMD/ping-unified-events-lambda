import { AcpAmpTransport, AlfLogger, AlfLoggerContextBuilder, LogFactory } from '@acp/common-logging';
// getToken (SSM) temporarily unused — re-add when switching back to SSM.
import { isAssertionEvent, sendToMixpanel, transformToMixpanel } from './transform';
import { resolvePingEnv } from './config';

const logFactory = new LogFactory();
const acpTransport = new AcpAmpTransport({
  stack: process.env.stack!,
  owner: 'identity',
  systemName: 'identity-ping-unified-events-svc'
});

logFactory.addTransport(acpTransport);
const logger = logFactory.buildLogger(AlfLogger, new AlfLoggerContextBuilder().build());


export const handler = async (event: any) => {
  logger.info(`Received Ping event: ${JSON.stringify(event)}`);

  if (!isAssertionEvent(event)) {
    logger.info(`Ignoring other event type: ${event?.action?.type}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Ignored' })
    };
  }

  const pingEnv = resolvePingEnv(event);
  if (!pingEnv) {
    logger.info(`Ignoring event from unrecognized Ping environment`);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Ignored' })
    };
  }

  const mixpanelBody = transformToMixpanel(event, pingEnv.name);
  logger.info(`Transformed event: ${JSON.stringify(mixpanelBody)}`);

  try {
    // TODO: switch back to SSM once the parameter is set up.
    // const token = await getToken(pingEnv.tokenParam);
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
