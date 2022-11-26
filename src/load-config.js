import config from 'config';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import logger from './logger.js';

async function readConfigFile(path) {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Config file ${path} not found`);
    }
    throw err;
  }
}

export default async function loadConfig(path) {
  logger().debug(`Trying to load config file '${path}'...`);
  const configContent = await readConfigFile(path);
  // TODO: add schema
  const fileData = yaml.load(configContent, { filename: path });
  config.util.extendDeep(config, fileData);
  logger().debug(`Config file '${path}' loaded.`);
}
