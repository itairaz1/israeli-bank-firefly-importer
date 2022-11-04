#!/usr/bin/env node

import './load-config.js';
import { doImport } from './importer/index.js';
import { createConfig, getConfig } from './firefly.js';
import moment from 'moment';
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
    const axiosResponse = await getConfig();
    const lastImport = axiosResponse.data.data.attributes.data.lastImport;
    const startScan = lastImport ? moment(lastImport).subtract(7, 'days') : moment().subtract('5', 'years');

    await doImport({
      skipEdit: true,
      onlyAccounts: undefined,
      since: startScan.format('YYYY-MM-DD'),
      cleanup: false,
    });

    await createConfig("lastImport", moment().toISOString())
      .catch(err => logger.error(err));
  } catch (err) {
    logger.error(err, 'Fatal error');
  }
}