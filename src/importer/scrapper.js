import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';
import config from 'config';
import logger from '../logger.js';

const banksConfig = config.banks;
const scraperConfig = config.scraper;

function toAccountOptions(x, i) {
  return { type: x.type, credentials: x.credentials, parentBankIndex: i, name: x.name };
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

export async function getScrappedAccounts(since, useOnlyAccounts) {
  const flatAccounts = banksConfig.flatMap((x, i) => ([toAccountOptions(x), ...(x.creditCards || []).map(y => toAccountOptions(y, i))]))
    .filter(x => !useOnlyAccounts || useOnlyAccounts.includes(x.name));

  const actions = flatAccounts
    .map(account => {
      const options = {
        companyId: CompanyTypes[account.type],
        startDate: new Date(since),
        combineInstallments: false,
        showBrowser: false,
        noFilter: true,
        args: scraperConfig.args,
      };

      return () => scrape(options, account.credentials);
    });

  const results = await runActions(actions, scraperConfig.parallel);
  const error = results
    .map((x, i) => x.success ? null : ({ ...x, options: flatAccounts[i] }))
    .filter(x => x)
    .map(x => `${x.options.type} ${x.options.name ? ` (${x.options.name})` : ''} failed with type ${x.errorType}: ${x.errorMessage}`)
    .join(', ');
  if (error) {
    logger.error(error, 'Scrapping failed');
    throw error;
  }

  return results.reduce((m, x, i) => ([...m, ...(enrichAccount(x.accounts, flatAccounts[i], results))]), []);
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