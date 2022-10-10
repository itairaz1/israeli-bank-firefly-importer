import './load-config.js';
import { doImport } from './importer/index.js';
import { createConfig, getConfig } from './firefly.js';
import moment from 'moment';
import config from 'config';
import { schedule } from 'node-cron';

if (config.cron) {
  schedule(config.cron, run);
} else {
  run();
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
      .catch(err => console.log(err));
  } catch (err) {
    console.log(`Fatal error: ${err.stack || err}`)
  }
}