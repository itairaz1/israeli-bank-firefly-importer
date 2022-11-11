import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';
import config from 'config';
import logger from '../logger.js';
import moment from 'moment';
import { getLastImport } from './last-import-helper.js';

const banksConfig = config.banks;
const scraperConfig = config.scraper;

function toUserOptions(creditCard, index) {
  return { type: creditCard.type, credentials: creditCard.credentials, parentBankIndex: index, name: creditCard.name };
}

function getParentBankAccountNumber(scrappedAccounts, currentAccount) {
  // TODO support multi accounts
  return scrappedAccounts[currentAccount.parentBankIndex].accounts[0].accountNumber;
}

function enrichAccount(accounts, currentAccount, scrappedAccounts) {
  const accountDetails = currentAccount.parentBankIndex !== undefined ?
    { type: currentAccount.type, parentBankAccountNumber: getParentBankAccountNumber(scrappedAccounts, currentAccount), kind: 'credit-card' } :
    { type: currentAccount.type, kind: 'bank' };
  return accounts.map(x => ({ ...x, accountDetails }));
}

function getScrapFrom(account) {
  if (account.lastImport) {
    return moment(account.lastImport).subtract(7, 'days');
  }

  // Fallback to 5y ago
  return moment().subtract('5', 'years');
}

export function getFlatUsers(useOnlyAccounts, state, since) {
  return banksConfig.flatMap((bank, i) => ([toUserOptions(bank), ...(bank.creditCards || []).map(cc => toUserOptions(cc, i))]))
    .filter(x => !useOnlyAccounts || useOnlyAccounts.includes(x.name))
    .map(x => ({ ...x, lastImport: getLastImport(x, state, since) }))
    .map(x => ({ ...x, scrapFrom: getScrapFrom(x) }));
}

export function parseScrapResult(results, flatUsers) {
  return results.reduce((m, x, i) => ([...m, ...(enrichAccount(x.accounts || [], flatUsers[i], results))]), []);
}

export function getSuccessfulScrappedUsers(results, flatUsers) {
  return results
    .map((x, i) => x.success ? flatUsers[i] : null)
    .filter(x => x);
}

export function logErrorResult(results, flatUsers) {
  const error = results
    .map((x, i) => x.success ? null : ({ ...x, options: flatUsers[i] }))
    .filter(x => x)
    .map(x => `${x.options.type} ${x.options.name ? ` (${x.options.name})` : ''} failed with type ${x.errorType}: ${x.errorMessage}`)
    .join(', ');
  if (error) {
    logger.error(error, 'Scrapping failed. Ignoring...');
  }
}

export async function getScrappedAccounts(flatUsers) {
  const actions = flatUsers
    .map(user => {
      const options = {
        companyId: CompanyTypes[user.type],
        startDate: user.scrapFrom.toDate(),
        combineInstallments: false,
        showBrowser: false,
        args: scraperConfig.args,
        timeout: scraperConfig.timeout,
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
    return Promise.all(actions.map(x => x()));
  } else {
    return actions.reduce((m, a) => m.then(async x => [...x, await a()]), Promise.resolve([]));
  }
}