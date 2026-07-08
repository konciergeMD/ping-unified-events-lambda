import { AcpAmpTransport, AlfLogger, AlfLoggerContextBuilder, LogFactory } from '@acp/common-logging';
import { isAssertionEvent, transformToMixpanel } from './transform';

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
    logger.info(`Ignoring non-assertion event: ${event?.action?.type}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Ignored' })
    };
  }

  const mixpanelBody = transformToMixpanel(event);
  logger.info(`Transformed event: ${JSON.stringify(mixpanelBody)}`);

  return {
    statusCode: 200,
    body: JSON.stringify(mixpanelBody)
  };
};
