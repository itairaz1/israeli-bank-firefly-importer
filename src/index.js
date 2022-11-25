#!/usr/bin/env node

import './load-config.js';
import config from 'config';
import { schedule } from 'node-cron';
import doImport from './importer/index.js';
import logger from './logger.js';

async function run() {
  try {
    await doImport({
      skipEdit: true,
      onlyAccounts: undefined,
      cleanup: false,
    });
  } catch (err) {
    logger.error(err, 'Fatal error');
  }
}

await run();

if (config.cron) {
  logger.info({ cron: config.cron }, 'Running with cron');
  schedule(config.cron, run);
}
