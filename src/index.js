#!/usr/bin/env node

import config from 'nconf';
import { schedule } from 'node-cron';
import loadConfig from './load-config.js';
import doImport from './importer/index.js';
import logger, { init as loggerInit } from './logger.js';
import { init as fireFlyInit } from './firefly.js';

async function run() {
  try {
    await doImport({
      skipEdit: true,
      onlyAccounts: undefined,
      cleanup: false,
    });
  } catch (err) {
    logger().error(err, 'Fatal error');
  }
}

async function init() {
  const configFile = process.env.CONFIG_FILE || './config.yaml';
  await loadConfig(configFile);
  logger().debug(`Config file '${configFile}' loaded.`);

  loggerInit();
  fireFlyInit();
}

try {
  await init();
  await run();
  const cron = config.get('cron');
  if (cron) {
    logger().info({ cron }, 'Running with cron');
    schedule(cron, run);
  }
} catch (err) {
  logger().error(err);
}
