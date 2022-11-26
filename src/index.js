#!/usr/bin/env node

import config from 'config';
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
  await loadConfig(process.env.CONFIG_FILE || './config.yaml');
  loggerInit();
  fireFlyInit();
}

try {
  await init();
  await run();
  if (config.cron) {
    logger().info({ cron: config.cron }, 'Running with cron');
    schedule(config.cron, run);
  }
} catch (err) {
  logger().error(err);
}
