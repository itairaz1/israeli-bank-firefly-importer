import pino, { Logger } from 'pino';
import config from 'nconf';

let pinoInstance: Logger;

export function init(): void {
  pinoInstance = pino({
    level: config.get('log:level'),
    transport: config.get('log:prettyPrint') ? {
      target: 'pino-pretty',
      options: { translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l' },
    } : undefined,
    redact: config.get('log:redact'),
  });
}

export default function getPino(): Logger {
  return pinoInstance;
}

// Init with default before load config
init();
