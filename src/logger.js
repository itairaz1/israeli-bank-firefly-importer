import pino from 'pino';
import config from 'config';

let pinoInstance;

export function init() {
  pinoInstance = pino({
    level: config.log.level,
    transport: config.log.prettyPrint ? {
      target: 'pino-pretty',
    } : {},
  });
}

export default function getPino() {
  return pinoInstance;
}

// Init with default before load config
init();
