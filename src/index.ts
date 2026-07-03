import { AcpAmpTransport, AlfLogger, AlfLoggerContextBuilder, LogFactory } from '@acp/common-logging';

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

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "Event received" }),
  };
};
