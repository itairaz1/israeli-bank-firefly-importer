import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';
import config from 'nconf';
import moment from 'moment';
import logger from '../logger.js';
import { getLastImport } from './last-import-helper.js';
import manipulateScrapResult from './scrap-manipulater/index.js';

interface User {
  type: string;
  credentials: Record<string, string>;
  parentBankIndex?: number;
  name?: string;
  creditCards?: any[];
  lastImport?: string;
  scrapFrom?: moment.Moment;
}

function toUserOptions(creditCard: any, index?: number): User {
  return {
    type: creditCard.type,
    credentials: creditCard.credentials,
    parentBankIndex: index,
    name: creditCard.name,
  };
}

function enrichAccount(accounts: any[], currentAccount: User) {
  const accountDetails = currentAccount.parentBankIndex !== undefined ? {
    type: currentAccount.type,
    kind: 'credit-card',
  } : {
    type: currentAccount.type,
    kind: 'bank',
  };
  return accounts.map((x) => ({
    ...x,
    accountDetails,
  }));
}

function getScrapFrom(account: User) {
  if (account.lastImport) {
    return moment(account.lastImport)
      .subtract(7, 'days');
  }

  // Fallback to 5y ago
  return moment()
    .subtract(5, 'years');
}

export function getFlatUsers(useOnlyAccounts: string[] | undefined, state: any, since: any) {
  if (!config.get('banks')) {
    throw new Error('No banks in config');
  }
  return (config.get('banks') as any[])
    .flatMap((bank: any, i: number) => ([toUserOptions(bank), ...(bank.creditCards || [])
      .map((cc: any) => toUserOptions(cc, i))]))
    .filter((x: User) => !useOnlyAccounts || (x.name && useOnlyAccounts.includes(x.name)))
    .map((x: User) => ({
      ...x,
      lastImport: getLastImport(x, state, since),
    }))
    .map((x: any) => ({
      ...x,
      scrapFrom: getScrapFrom(x),
    }));
}

export function parseScrapResult(results: any[], flatUsers: User[]) {
  return results
    .reduce((m, x, i) => ([...m, ...(enrichAccount(x.accounts || [], flatUsers[i]))]), [])
    .map(manipulateScrapResult)
    .filter((x: any) => x);
}

export function getSuccessfulScrappedUsers(results: any[], flatUsers: User[]) {
  return results
    .map((x, i) => (x.success ? flatUsers[i] : null))
    .filter((x) => x);
}

export function logErrorResult(results: any[], flatUsers: User[]) {
  const error = results
    .map((x, i) => (x.success ? null : ({
      ...x,
      options: flatUsers[i],
    })))
    .filter((x) => x)
    .map((x) => `${x.options.type} ${x.options.name ? ` (${x.options.name})` : ''} failed with type ${x.errorType}: ${x.errorMessage}`)
    .join(', ');
  if (error) {
    logger()
      .error({ error }, 'Scrapping failed. Ignoring...');
  }
}

export function getLightResult(results: any[]) {
  return results.map((r) => ({
    ...r,
    accounts: r.accounts
      ?.map((a: any) => ({
        ...a,
        txCount: a.txns.length,
        txns: undefined,
      })),
  }));
}

export async function scrapAccounts(flatUsers: any[]) {
  const scraperConfig = config.get('scraper');
  const actions = flatUsers
    .map((user) => {
      const options = {
        companyId: (CompanyTypes as any)[user.type],
        startDate: user.scrapFrom.toDate(),
        ...scraperConfig.options,
      };

      return () => scrape(options, user.credentials);
    });

  return runActions(actions, scraperConfig.parallel);
}

async function scrape(options: any, credentials: any) {
  const scraper = createScraper(options);
  logger().debug({ options }, 'Scrapping...');
  try {
    return await scraper.scrape(credentials);
  } catch (error: any) {
    logger().error({ error, options }, 'Unexpected error while scrapping');
    return {
      success: false,
      errorType: 'GENERAL_ERROR',
      errorMessage: error.message,
    };
  }
}

function runActions(actions: (() => Promise<any>)[], parallel: boolean) {
  if (parallel) {
    return Promise.all(actions.map((x) => x()));
  }
  return actions.reduce<Promise<any[]>>(
    (m, a) => m.then(async (x) => [...x, await a()]),
    Promise.resolve([]),
  );
}
