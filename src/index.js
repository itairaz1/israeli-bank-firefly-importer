#!/usr/bin/env node

import './load-config.js';
import { doImport } from './importer/index.js';
import config from 'config';
import { schedule } from 'node-cron';
import logger from './logger.js'

await run();

if (config.cron) {
  logger.info({cron: config.cron}, 'Running with cron');
  schedule(config.cron, run);
}

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