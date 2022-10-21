import config from 'config';
import { delimiter, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configFromEnvVarAsArray = process.env['CONFIG_PATH'] ? [process.env['CONFIG_PATH']] : [] ;
const configDir = [...configFromEnvVarAsArray, __dirname + '/config/'].join(delimiter);
console.log(`Loading config from ${configDir}`);
config.util.extendDeep(config, config.util.loadFileConfigs(configDir));
