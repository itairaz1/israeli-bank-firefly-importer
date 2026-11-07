import {
  CompanyTypes,
  createScraper,
  ScraperCredentials,
  ScraperOptions,
} from 'israeli-bank-scrapers';
import type { ScraperErrorTypes } from 'israeli-bank-scrapers/lib/scrapers/errors.js';
import config from 'nconf';
import moment, { Moment } from 'moment';
import logger from '../logger.js';
import { getLastImport } from './last-import-helper.js';
import manipulateScrapResult from './scrap-manipulater/index.js';
import type {
  AccountConfig,
  AccountDetails,
  BankConfig,
  Credentials,
  EnrichedAccount,
  FlatUser,
  ImporterState,
  ScraperConfig,
  ScrapResult,
  TransactionsAccount,
  UserOptions,
} from '../types.js';

function toUserOptions(creditCard: AccountConfig, index?: number): UserOptions {
  return {
    type: creditCard.type,
    credentials: creditCard.credentials,
    parentBankIndex: index,
    name: creditCard.name,
  };
}

function enrichAccount(
  accounts: TransactionsAccount[],
  currentAccount: UserOptions,
): EnrichedAccount[] {
  const accountDetails: AccountDetails = currentAccount.parentBankIndex !== undefined ? {
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

function getScrapFrom(account: { lastImport: Moment | null }): Moment {
  if (account.lastImport) {
    return moment(account.lastImport)
      .subtract(7, 'days');
  }

  // Fallback to 5y ago
  return moment()
    .subtract(5, 'years');
}

export function getFlatUsers(
  useOnlyAccounts: string[] | undefined,
  state: ImporterState['lastImport'],
  since?: string,
): FlatUser[] {
  const banks: BankConfig[] | undefined = config.get('banks');
  if (!banks) {
    throw new Error('No banks in config');
  }
  return banks
    .flatMap((bank, i) => ([toUserOptions(bank), ...(bank.creditCards || [])
      .map((cc) => toUserOptions(cc, i))]))
    .filter((x) => !useOnlyAccounts || (x.name !== undefined && useOnlyAccounts.includes(x.name)))
    .map((x) => ({
      ...x,
      lastImport: getLastImport(x, state, since),
    }))
    .map((x) => ({
      ...x,
      scrapFrom: getScrapFrom(x),
    }));
}

export function parseScrapResult(results: ScrapResult[], flatUsers: FlatUser[]): EnrichedAccount[] {
  return results
    .reduce<EnrichedAccount[]>(
      (m, x, i) => ([...m, ...(enrichAccount(x.accounts || [], flatUsers[i]))]),
      [],
    )
    .map(manipulateScrapResult)
    .filter((x): x is EnrichedAccount => !!x);
}

export function getSuccessfulScrappedUsers(
  results: ScrapResult[],
  flatUsers: FlatUser[],
): FlatUser[] {
  return results
    .map((x, i) => (x.success ? flatUsers[i] : null))
    .filter((x): x is FlatUser => !!x);
}

export function logErrorResult(results: ScrapResult[], flatUsers: FlatUser[]): void {
  const error = results
    .map((x, i) => (x.success ? null : ({
      ...x,
      options: flatUsers[i],
    })))
    .filter((x): x is ScrapResult & { options: FlatUser } => !!x)
    .map((x) => `${x.options.type} ${x.options.name ? ` (${x.options.name})` : ''} failed with type ${x.errorType}: ${x.errorMessage}`)
    .join(', ');
  if (error) {
    logger()
      .error({ error }, 'Scrapping failed. Ignoring...');
  }
}

export function getLightResult(results: ScrapResult[]) {
  return results.map((r) => ({
    ...r,
    accounts: r.accounts
      ?.map((a) => ({
        ...a,
        txCount: a.txns.length,
        txns: undefined,
      })),
  }));
}

export async function scrapAccounts(flatUsers: FlatUser[]): Promise<ScrapResult[]> {
  const scraperConfig: ScraperConfig = config.get('scraper');
  const actions = flatUsers
    .map((user) => {
      const options = {
        companyId: CompanyTypes[user.type],
        startDate: user.scrapFrom.toDate(),
        ...scraperConfig.options,
      } as ScraperOptions;

      return () => scrape(options, user.credentials);
    });

  return runActions(actions, scraperConfig.parallel);
}

async function scrape(options: ScraperOptions, credentials: Credentials): Promise<ScrapResult> {
  const scraper = createScraper(options);
  logger().debug({ options }, 'Scrapping...');
  try {
    return await scraper.scrape(credentials as ScraperCredentials);
  } catch (error) {
    logger().error({ error, options }, 'Unexpected error while scrapping');
    return {
      success: false,
      errorType: 'GENERAL_ERROR' as ScraperErrorTypes.General,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function runActions<T>(actions: (() => Promise<T>)[], parallel?: boolean): Promise<T[]> {
  if (parallel) {
    return Promise.all(actions.map((x) => x()));
  }
  return actions.reduce<Promise<T[]>>(
    (m, a) => m.then(async (x) => [...x, await a()]),
    Promise.resolve([]),
  );
}
