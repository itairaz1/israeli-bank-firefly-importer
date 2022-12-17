import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';
import config from 'nconf';
import moment from 'moment';
import logger from '../logger.js';
import { getLastImport } from './last-import-helper.js';
import manipulateScrapResult from './scrap-manipulater/index.js';

function toUserOptions(creditCard, index) {
  return {
    type: creditCard.type,
    credentials: creditCard.credentials,
    parentBankIndex: index,
    name: creditCard.name,
  };
}

function enrichAccount(accounts, currentAccount) {
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

function getScrapFrom(account) {
  if (account.lastImport) {
    return moment(account.lastImport)
      .subtract(7, 'days');
  }

  // Fallback to 5y ago
  return moment()
    .subtract('5', 'years');
}

export function getFlatUsers(useOnlyAccounts, state, since) {
  if (!config.get('banks')) {
    throw new Error('No banks in config');
  }
  return config.get('banks')
    .flatMap((bank, i) => ([toUserOptions(bank), ...(bank.creditCards || [])
      .map((cc) => toUserOptions(cc, i))]))
    .filter((x) => !useOnlyAccounts || useOnlyAccounts.includes(x.name))
    .map((x) => ({
      ...x,
      lastImport: getLastImport(x, state, since),
    }))
    .map((x) => ({
      ...x,
      scrapFrom: getScrapFrom(x),
    }));
}

export function parseScrapResult(results, flatUsers) {
  return results
    .reduce((m, x, i) => ([...m, ...(enrichAccount(x.accounts || [], flatUsers[i]))]), [])
    .map(manipulateScrapResult)
    .filter((x) => x);
}

export function getSuccessfulScrappedUsers(results, flatUsers) {
  return results
    .map((x, i) => (x.success ? flatUsers[i] : null))
    .filter((x) => x);
}

export function logErrorResult(results, flatUsers) {
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
      .error(error, 'Scrapping failed. Ignoring...');
  }
}

export async function scrapAccounts(flatUsers) {
  const scraperConfig = config.get('scraper');
  const actions = flatUsers
    .map((user) => {
      const options = {
        companyId: CompanyTypes[user.type],
        startDate: user.scrapFrom.toDate(),
        combineInstallments: false,
        showBrowser: false,
        args: scraperConfig.args,
        defaultTimeout: scraperConfig.timeout,
        outputData: {
          enableTransactionsFilterByDate: false,
        },
      };

      return () => scrape(options, user.credentials);
    });

  return runActions(actions, scraperConfig.parallel);
}

async function scrape(options, credentials) {
  const scraper = createScraper(options);
  return scraper.scrape(credentials);
}

function runActions(actions, parallel) {
  if (parallel) {
    return Promise.all(actions.map((x) => x()));
  }
  return actions.reduce((m, a) => m.then(async (x) => [...x, await a()]), Promise.resolve([]));
}
