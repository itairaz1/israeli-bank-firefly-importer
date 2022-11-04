import config from 'config';
import { delimiter, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configDir = resolve(__dirname, '../config');

const configFromEnvVarAsArray = process.env['IBFI_CONFIG_PATH'] ? [process.env['IBFI_CONFIG_PATH']] : [] ;
const resolvedConfigDirs = [...configFromEnvVarAsArray, configDir].join(delimiter);
config.util.extendDeep(config, config.util.loadFileConfigs(resolvedConfigDirs));

const { default: logger } = await import('./logger.js');
logger.debug({path: resolvedConfigDirs}, `Config loaded`);
