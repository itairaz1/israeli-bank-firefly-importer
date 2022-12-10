import pino from 'pino';
import config from 'nconf';

let pinoInstance;

export function init() {
  pinoInstance = pino({
    level: config.get('log:level'),
    transport: config.get('log:prettyPrint') ? {
      target: 'pino-pretty',
    } : {},
  });
}

export default function getPino() {
  return pinoInstance;
}

// Init with default before load config
init();
