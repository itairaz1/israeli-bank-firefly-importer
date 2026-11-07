#!/usr/bin/env node

import { readFile } from 'fs/promises';
import config from 'nconf';
import { schedule } from 'node-cron';
import loadConfig from './load-config.js';
import doImport from './importer/index.js';
import logger, { init as loggerInit } from './logger.js';
import { getErrorMessage, init as fireFlyInit } from './firefly.js';

const packageJsonContent = await readFile(new URL('../package.json', import.meta.url));
const pkg: { version: string } = JSON.parse(packageJsonContent.toString());

async function run(): Promise<void> {
  try {
    await doImport({
      skipEdit: true,
      onlyAccounts: undefined,
      cleanup: false,
    });
  } catch (err) {
    logger()
      .error({
        error: err,
        message: getErrorMessage(err),
      }, 'Fatal error');
  }
}

async function init(): Promise<void> {
  const configFile = process.env.CONFIG_FILE || './config.yaml';
  await loadConfig(configFile);
  loggerInit();
  logger().debug(`Config file '${configFile}' loaded.`);

  fireFlyInit();
}

try {
  await init();
  logger()
    .info({ version: pkg.version }, 'Starting Israeli Bank Firefly iii Importer');
  await run();
  const cron: string | undefined = config.get('cron');
  if (cron) {
    logger()
      .info({ cron }, 'Running with cron');
    schedule(cron, run);
  }
} catch (err) {
  logger()
    .error(err, 'Critical error');
}
