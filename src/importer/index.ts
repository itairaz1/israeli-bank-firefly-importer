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

async function getMappedTransactions(scrapeFormattedTxs: any[]) {
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

function getCurrencyCode(x: any) {
  const currency = x.chargedCurrency || x.originalCurrency;
  if (!currency) {
    return undefined;
  }
  return config.get('currencySymbolMap')[currency] || currency;
}

async function getFireflyState() {
  try {
    const axiosState = await getConfig();
    return JSON.parse(axiosState.data.data.attributes.data);
  } catch (err: any) {
    if (err?.response?.status === 404) {
      logger()
        .debug('Firefly previous state not found (its ok if its first run), using empty object.');
      return {};
    }
    throw err;
  }
}

export default async function doImport(options: any) {
  const { skipEdit } = options;
  const { onlyAccounts } = options;
  const { cleanup } = options;
  const { since } = options;

  if (cleanup) {
    await drop();
  }

  logger().info('Getting state from firefly...');
  const state = await getFireflyState();
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
  const accountsMaps: any = await createAndMapAccounts(accounts);

  const scrapeFormattedTxs = accounts
    .reduce((m: any, a: any) => ([...m, ...a.txns
      .map((tx: any) => ({
        ...tx,
        account: accountsMaps[a.accountNumber],
      }))]), [])
    .filter((x: any) => x.status === 'completed')
    .filter((x: any) => x.chargedAmount)
    .map((x: any) => ({
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
  const currentTxMap: any = await getMappedTransactions(scrapeFormattedTxs);

  const toCreate = preparedFireTxs.filter((x: any) => !currentTxMap[x.external_id]);
  const insertDebugData = logger().level === 'debug' ? { toCreate } : {};
  logger()
    .info({ count: toCreate.length, ...insertDebugData }, 'Creating transactions to firefly...');
  await toCreate.reduce((p: Promise<any>, x: any, i: number) => p
    .then(() => innerCreateTx(x, i + 1)), Promise.resolve());

  const toTypeUpdate = preparedFireTxs
    .filter((x: any) => currentTxMap[x.external_id] && currentTxMap[x.external_id].type !== x.type);
  const updateDebugData = logger().level === 'debug' ? { toTypeUpdate } : {};
  logger()
    .info({ count: toTypeUpdate.length, ...updateDebugData }, 'Updating transactions types to firefly...');
  await toTypeUpdate.reduce((p: Promise<any>, x: any, i: number) => p
    .then(() => innerUpdateTx(currentTxMap[x.external_id], x, i + 1)), Promise.resolve());

  if (!skipEdit) {
    const toUpdate = preparedFireTxs
      .filter((x: any) => currentTxMap[x.external_id]
        && currentTxMap[x.external_id].type === x.type);
    logger().info({ count: toUpdate.length }, 'Updating transactions to firefly...');
    await toUpdate.reduce((p: Promise<any>, x: any, i: number) => p
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

function getExistsTxMap(fireflyData: any[]) {
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

function calcMonthlyPaymentDate(account: any) {
  const sumMap = account.txns
    .map((x: any) => moment(x.processedDate).date())
    .reduce((m: any, x: any) => ({
      ...m,
      [x]: (m[x] || 0) + 1,
    }), {});

  const topDate = Object.keys(sumMap)
    .reduce((m: any, x: any) => (m && sumMap[m] > sumMap[x] ? m : x), 0);

  return moment().set('date', topDate).format('YYYY-MM-DD');
}

async function getFireflyAccountsBalance() {
  const rawAccounts = await getAccounts();
  return rawAccounts.data.data
    .map((x: any) => ({
      accountNumber: x.attributes.account_number,
      balance: parseFloat(x.attributes.current_balance),
    }));
}

function logBalanceOutOfSync(fireflyAccounts: any[], scrapeAccounts: any[]) {
  const fireflyAccountsBalanceMap = fireflyAccounts
    .reduce((m: any, x: any) => ({
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

async function createAndMapAccounts(scrapperAccounts: any[]) {
  const map = scrapperAccounts.reduce((m: any, x: any) => ({
    ...m,
    [x.accountNumber]: x,
  }), {});

  const rawAccounts = await getAccounts();
  const accountsMap = rawAccounts.data.data
    .filter((x: any) => x.attributes.account_number && map[x.attributes.account_number])
    .map((x: any) => ({
      id: x.id,
      accountNumber: x.attributes.account_number,
    }))
    .reduce((m: any, x: any) => ({
      ...m,
      [x.accountNumber]: {
        ...map[x.accountNumber].accountDetails,
        id: x.id,
      },
    }), {});
  const missedAccounts = scrapperAccounts
    .map((x) => x.accountNumber)
    .filter((x) => !accountsMap[x]);

  if (missedAccounts.length === 0) {
    return accountsMap;
  }

  logger().info({ missedAccounts }, 'Accounts are missing from Firefly, creating them...');

  const results = await missedAccounts
    .reduce((m: Promise<any[]>, a: any) => m.then(async (x: any) => [...x, await createAccount({
      name: a,
      account_number: a,
      type: 'asset',
      account_role: map[a].accountDetails.kind === 'bank' ? 'defaultAsset' : 'ccAsset',
      ...(map[a].accountDetails.kind !== 'bank' ? {
        credit_card_type: 'monthlyFull',
        monthly_payment_date: calcMonthlyPaymentDate(map[a]),
      } : {}),
    })]), Promise.resolve([]));

  return results.reduce((m: any, x: any) => ({
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
    .map((x: any) => ({ id: x.id, ...x.attributes.transactions[0] }));

  logger().info({
    count: toDrop.length,
    total: fireflyData.length,
  }, 'Dropping transactions');

  let count = 1;
  await toDrop.reduce((p: Promise<void>, tx: any) => p.then(async () => {
    await deleteTx(tx.id);
    count += 1;
    if (count % 50 === 0) {
      logger().info({ currentAmount: count }, 'Transactions deleted');
    }
  }), Promise.resolve() as Promise<void>); // Promise.resolve(void)
}

async function innerCreateTx(tx: any, count: number) {
  try {
    await createTx([tx]);
    if (count % 50 === 0) {
      logger().info({ currentAmount: count }, 'Transactions created.');
    }
  } catch (e: any) {
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
}: { id: string | number, type: string }, tx: any, count: number) {
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
  } catch (e: any) {
    logger()
      .error({
        message: e?.response?.data?.message,
        error: e,
        tx,
      }, 'Error updating transaction');
  }
}

const getters: Record<string, (x: any) => any> = {
  hash: (x) => hash(omitFields(x)),
  identifier: (x) => x.identifier,
};

function omitFields(tx: any) {
  const copy = { ...tx };
  delete copy.account;
  delete copy.category;
  return copy;
}

function getExternalId(tx: any) {
  const identifyMethod = config.get('identifyMethod')[tx.account.type] || 'identifier';
  const getter = getters[identifyMethod] || getters.identifier;
  return getter(tx);
}
