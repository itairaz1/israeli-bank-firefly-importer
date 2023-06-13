import hash from 'object-hash';
import config from 'nconf';
import moment from 'moment';
import manipulateTxs from './credit-cards.js';
import {
  createAccount,
  createTx,
  deleteTx,
  getAccounts,
  getAllTxs,
  getConfig,
  searchTxs,
  updateTx,
  upsertConfig,
} from '../firefly.js';
import {
  getFlatUsers,
  getLightResult,
  getSuccessfulScrappedUsers,
  logErrorResult,
  parseScrapResult,
  scrapAccounts,
} from './scrapper.js';
import logger from '../logger.js';
import { getStateWithLastImport } from './last-import-helper.js';

async function getMappedTransactions(scrapeFormattedTxs) {
  const minimalDate = scrapeFormattedTxs
    .map((x) => moment(x.date))
    .reduce((m, x) => (x.isBefore(m) ? x : m), moment());
  const getTxSince = moment(minimalDate).subtract(1, 'day');
  const since = getTxSince.format('YYYY-MM-DD');
  logger().info({ since }, 'Getting firefly transactions to compare...');
  const workingTxs = await searchTxs({ date_after: since });
  logger()
    .debug({
      numberOfTransactionsFromFirefly: workingTxs.length,
      since,
    }, 'Got transactions from firefly');
  return getExistsTxMap(workingTxs);
}

function getCurrencyCode(x) {
  const currency = x.chargedCurrency || x.originalCurrency;
  if (!currency) {
    return undefined;
  }
  return config.get('currencySymbolMap')[currency] || currency;
}

export default async function doImport(options) {
  const { skipEdit } = options;
  const { onlyAccounts } = options;
  const { cleanup } = options;
  const { since } = options;

  if (cleanup) {
    await drop();
  }

  logger().info('Getting state from firefly...');
  const axiosState = await getConfig();
  const state = JSON.parse(axiosState.data.data.attributes.data);
  const lastImportState = state.lastImport;

  logger().info('Getting scrap data...');
  const flatUsers = getFlatUsers(onlyAccounts, lastImportState, since);
  const scrapResult = await scrapAccounts(flatUsers);
  logErrorResult(scrapResult, flatUsers);
  if (logger().level === 'debug') {
    logger()
      .debug({ results: getLightResult(scrapResult) }, 'Scrap result');
  }
  const accounts = parseScrapResult(scrapResult, flatUsers);

  logger().info('Getting or creating accounts...');
  const accountsMaps = await createAndMapAccounts(accounts);

  const scrapeFormattedTxs = accounts
    .reduce((m, a) => ([...m, ...a.txns
      .map((tx) => ({
        ...tx,
        account: accountsMaps[a.accountNumber],
      }))]), [])
    .filter((x) => x.status === 'completed')
    .filter((x) => x.chargedAmount)
    .map((x) => ({
      type: x.chargedAmount > 0 ? 'deposit' : 'withdrawal',
      date: x.date,
      amount: Math.abs(x.chargedAmount),
      description: x.description,
      notes: x.memo,
      source_id: x.chargedAmount > 0 ? undefined : x.account.id,
      destination_id: x.chargedAmount > 0 ? x.account.id : undefined,
      internal_reference: x.identifier,
      external_id: getExternalId(x),
      currency_code: getCurrencyCode(x),
      process_date: x.processedDate,
      category_name: x.category,
    }));

  logger().info('Manipulating...');
  const preparedFireTxs = await manipulateTxs(scrapeFormattedTxs, accountsMaps);
  const currentTxMap = await getMappedTransactions(scrapeFormattedTxs);

  const toCreate = preparedFireTxs.filter((x) => !currentTxMap[x.external_id]);
  const insertDebugData = logger().level === 'debug' ? { toCreate } : {};
  logger()
    .info({ count: toCreate.length, ...insertDebugData }, 'Creating transactions to firefly...');
  await toCreate.reduce((p, x, i) => p
    .then(() => innerCreateTx(x, i + 1)), Promise.resolve());

  const toTypeUpdate = preparedFireTxs
    .filter((x) => currentTxMap[x.external_id] && currentTxMap[x.external_id].type !== x.type);
  const updateDebugData = logger().level === 'debug' ? { toTypeUpdate } : {};
  logger()
    .info({ count: toTypeUpdate.length, ...updateDebugData }, 'Updating transactions types to firefly...');
  await toTypeUpdate.reduce((p, x, i) => p
    .then(() => innerUpdateTx(currentTxMap[x.external_id], x, i + 1)), Promise.resolve());

  if (!skipEdit) {
    const toUpdate = preparedFireTxs
      .filter((x) => currentTxMap[x.external_id] && currentTxMap[x.external_id].type === x.type);
    logger().info({ count: toUpdate.length }, 'Updating transactions to firefly...');
    await toUpdate.reduce((p, x, i) => p
      .then(() => innerUpdateTx(currentTxMap[x.external_id], x, i + 1)), Promise.resolve());
  }

  const accountsBalance = await getFireflyAccountsBalance();
  logBalanceOutOfSync(accountsBalance, accounts);

  logger().info('Updating last import...');
  const scrappedUsers = getSuccessfulScrappedUsers(scrapResult, flatUsers);
  const updatedState = getStateWithLastImport(scrappedUsers, state);
  await upsertConfig(JSON.stringify(updatedState));

  logger().info('Done.');
}

function getExistsTxMap(fireflyData) {
  return fireflyData
    .map((x) => ({
      type: x.attributes.transactions[0].type,
      ext_id: x.attributes.transactions[0].external_id,
      id: x.id,
    }))
    .reduce((m, {
      id,
      ext_id: extId,
      type,
    }) => ({
      ...m,
      [extId]: {
        id,
        type,
      },
    }), {});
}

function calcMonthlyPaymentDate(account) {
  const sumMap = account.txns
    .map((x) => moment(x.processedDate).date())
    .reduce((m, x) => ({
      ...m,
      [x]: (m[x] || 0) + 1,
    }), {});

  const topDate = Object.keys(sumMap).reduce((m, x) => (m && sumMap[m] > sumMap[x] ? m : x), 0);

  return moment().set('date', topDate).format('YYYY-MM-DD');
}

async function getFireflyAccountsBalance() {
  const rawAccounts = await getAccounts();
  return rawAccounts.data.data
    .map((x) => ({
      accountNumber: x.attributes.account_number,
      balance: parseFloat(x.attributes.current_balance),
    }));
}

function logBalanceOutOfSync(fireflyAccounts, scrapeAccounts) {
  const fireflyAccountsBalanceMap = fireflyAccounts
    .reduce((m, x) => ({
      ...m,
      [x.accountNumber]: x.balance,
    }), {});
  scrapeAccounts
    .map((x) => ({
      accountNumber: x.accountNumber,
      scrapeBalance: x.balance,
      fireflyBalance: fireflyAccountsBalanceMap[x.accountNumber],
    }))
    .filter((x) => x.scrapeBalance && x.scrapeBalance !== x.fireflyBalance)
    .forEach((x) => logger().warn(x, 'Non synced balance'));
}

async function createAndMapAccounts(scrapperAccounts) {
  const map = scrapperAccounts.reduce((m, x) => ({
    ...m,
    [x.accountNumber]: x,
  }), {});

  const rawAccounts = await getAccounts();
  const accountsMap = rawAccounts.data.data
    .filter((x) => x.attributes.account_number && map[x.attributes.account_number])
    .map((x) => ({
      id: x.id,
      accountNumber: x.attributes.account_number,
    }))
    .reduce((m, x) => ({
      ...m,
      [x.accountNumber]: {
        ...map[x.accountNumber].accountDetails,
        id: x.id,
      },
    }), {});
  const missedAccounts = scrapperAccounts
    .map((x) => x.accountNumber)
    .filter((x) => !accountsMap[x]);

  const results = await missedAccounts
    .reduce((m, a) => m.then(async (x) => [...x, await createAccount({
      name: a,
      account_number: a,
      type: 'asset',
      account_role: map[a].accountDetails.kind === 'bank' ? 'defaultAsset' : 'ccAsset',
      ...(map[a].accountDetails.kind !== 'bank' ? {
        credit_card_type: 'monthlyFull',
        monthly_payment_date: calcMonthlyPaymentDate(map[a]),
      } : {}),
    })]), Promise.resolve([]));

  return results.reduce((m, x) => ({
    ...m,
    [x.data.data.attributes.account_number]: {
      ...map[x.data.data.attributes.account_number].accountDetails,
      id: x.data.data.id,
    },
  }), accountsMap);
}

async function drop() {
  logger().info('Getting data for drop');
  const fireflyData = await getAllTxs();
  const toDrop = fireflyData
    .map((x) => ({ id: x.id, ...x.attributes.transactions[0] }));

  logger().info({
    count: toDrop.length,
    total: fireflyData.length,
  }, 'Dropping transactions');

  let count = 1;
  await toDrop.reduce((p, tx) => p.then(async () => {
    await deleteTx(tx.id);
    count += 1;
    if (count % 50 === 0) {
      logger().info({ currentAmount: count }, 'Transactions deleted');
    }
  }, Promise.resolve()));
}

async function innerCreateTx(tx, count) {
  try {
    await createTx([tx]);
    if (count % 50 === 0) {
      logger().info({ currentAmount: count }, 'Transactions created.');
    }
  } catch (e) {
    logger()
      .error({
        message: e?.response?.data?.message,
        error: e,
        tx,
      }, 'Error creating transaction');
  }
}

async function innerUpdateTx({
  id,
  type,
}, tx, count) {
  try {
    if (type !== tx.type) {
      await deleteTx(id);
      await createTx([tx]);
    } else {
      await updateTx(id, [tx]);
    }
    if (count % 50 === 0) {
      logger().info({ currentAmount: count }, 'Transactions updated.');
    }
  } catch (e) {
    logger()
      .error({
        message: e?.response?.data?.message,
        error: e,
        tx,
      }, 'Error updating transaction');
  }
}

const getters = {
  hash: (x) => hash(omitFields(x)),
  identifier: (x) => x.identifier,
};

function omitFields(tx) {
  const {
    account,
    category,
    ...rest
  } = tx;
  return rest;
}

function getExternalId(tx) {
  const identifyMethod = config.get('identifyMethod')[tx.account.type] || 'identifier';
  const getter = getters[identifyMethod] || getters.identifier;
  return getter(tx);
}
