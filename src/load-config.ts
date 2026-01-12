import { createRequire } from 'node:module';
import config from 'nconf';
// @ts-expect-error ignore for now
import nconfYaml from 'nconf-yaml';

const require = createRequire(import.meta.url);

const envMap: Record<string, string> = {
  FIREFLY_BASE_URL: 'firefly:baseUrl',
  FIREFLY_TOKEN_API: 'firefly:tokenApi',
  CRON: 'cron',
  SCRAPER_PARALLEL: 'scraper:parallel',
  SCRAPER_TIMEOUT: 'scraper:timeout',
  LOG_LEVEL: 'log:level',
};

config
  .defaults(require('../config/default.json'));

export default async function loadConfig(path: string) {
  config.remove('defaults');
  config.env({
    transform: (obj: any) => {
      if (!envMap[obj.key]) {
        return null;
      }
      // eslint-disable-next-line no-param-reassign
      obj.key = envMap[obj.key];
      return obj;
    },
  })
    .file({
      file: path,
      format: nconfYaml,
    })
    .defaults(require('../config/default.json'))
    .required(['firefly', 'firefly:baseUrl', 'firefly:tokenApi', 'banks']);
}
