import './load-config.js';
import { doImport } from './importer/index.js';
import { createConfig, getConfig } from './firefly.js';
import moment from 'moment';

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
