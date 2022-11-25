import pino from 'pino';
import config from 'config';

const { log: logConfig } = config;

const transport = logConfig.prettyPrint ? {
  target: 'pino-pretty',
} : {};

export default pino({ level: logConfig.level, transport });
