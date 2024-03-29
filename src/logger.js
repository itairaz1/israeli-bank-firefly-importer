import pino from 'pino';
import config from 'nconf';

let pinoInstance;

export function init() {
  pinoInstance = pino({
    level: config.get('log:level'),
    transport: config.get('log:prettyPrint') ? {
      target: 'pino-pretty',
      options: { translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l' },
    } : {},
    redact: config.get('log:redact'),
  });
}

export default function getPino() {
  return pinoInstance;
}

// Init with default before load config
init();
