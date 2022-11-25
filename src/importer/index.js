import hash from 'object-hash';
import config from 'config';
import moment from 'moment';
import manipulateTxs from './credit-cards.js';
import {
  createAccount,
  upsertConfig,
  createTx, deleteTx,
  getAccounts, getAllTxs, getConfig, searchTxs, updateTx,
} from '../firefly.js';
import {
  getFlatUsers, getScrappedAccounts, getSuccessfulScrappedUsers, logErrorResult, parseScrapResult,
} from './scrapper.js';
import logger from '../logger.js';
import { getStateWithLastImport } from './last-import-helper.js';

export default async function doImport(options) {
  const { skipEdit } = options;
  const { onlyAccounts } = options;
  const { cleanup } = options;
  const { since } = options;

  if (cleanup) {
    await drop();
  }

  logger.info('Getting state from firefly...');
  const axiosState = await getConfig();
  const state = JSON.parse(axiosState.data.data.attributes.data);
  const lastImportState = state.lastImport;

  logger.info('Getting scrap data...');
  const flatUsers = getFlatUsers(onlyAccounts, lastImportState, since);
  const scrapResult = await getScrappedAccounts(flatUsers);
  logErrorResult(scrapResult, flatUsers);
  const accounts = parseScrapResult(scrapResult, flatUsers);

  logger.info('Getting or creating accounts...');
  const accountsMaps = await createAndMapAccounts(accounts);

  const fireTxs = accounts
    .reduce((m, a) => ([...m, ...a.txns
      .map((tx) => ({ ...tx, account: accountsMaps[a.accountNumber] }))]), [])
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
      currency_code: x.chargedCurrency,
      process_date: x.processedDate,
    }));

  logger.info('Manipulating...');
  const preparedFireTxs = await manipulateTxs(fireTxs, accountsMaps);

  logger.info('Getting map...');
  const minimalDate = fireTxs
    .map((x) => moment(x.date))
    .reduce((m, x) => (x.isBefore(m) ? x : m), moment());
  const getTxSince = moment(minimalDate).subtract(1, 'day');
  const workingTxs = await searchTxs({ date_after: getTxSince.format('YYYY-MM-DD') });
  const currentTxMap = await getExistsTxMap(workingTxs);

  const toCreate = preparedFireTxs.filter((x) => !currentTxMap[x.external_id]);
  logger.info({ count: toCreate.length }, 'Creating transactions to firefly...');
  await toCreate.reduce((p, x, i) => p
    .then(() => innerCreateTx(x, i + 1)), Promise.resolve());

  const toTypeUpdate = preparedFireTxs
    .filter((x) => currentTxMap[x.external_id] && currentTxMap[x.external_id].type !== x.type);
  logger.info({ count: toTypeUpdate.length }, 'Updating transactions types to firefly...');
  await toTypeUpdate.reduce((p, x, i) => p
    .then(() => innerUpdateTx(currentTxMap[x.external_id], x, i + 1)), Promise.resolve());

  if (!skipEdit) {
    const toUpdate = preparedFireTxs
      .filter((x) => currentTxMap[x.external_id] && currentTxMap[x.external_id].type === x.type);
    logger.info({ count: toUpdate.length }, 'Updating transactions to firefly...');
    await toUpdate.reduce((p, x, i) => p
      .then(() => innerUpdateTx(currentTxMap[x.external_id], x, i + 1)), Promise.resolve());
  }

  logger.info('Updating last import...');
  const scrappedUsers = getSuccessfulScrappedUsers(scrapResult, flatUsers);
  const updatedState = getStateWithLastImport(scrappedUsers, state);
  await upsertConfig(JSON.stringify(updatedState));

  logger.info('Done.');
}

async function getExistsTxMap(fireFlyData) {
  return fireFlyData
    .map((x) => ({
      type: x.attributes.transactions[0].type,
      ext_id: x.attributes.transactions[0].external_id,
      id: x.id,
    }))
    .reduce((m, { id, ext_id: extId, type }) => ({ ...m, [extId]: { id, type } }), {});
}

function calcMonthlyPaymentDate(account) {
  const sumMap = account.txns
    .map((x) => moment(x.processedDate).date())
    .reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {});

  const topDate = Object.keys(sumMap).reduce((m, x) => (m && sumMap[m] > sumMap[x] ? m : x), 0);

  return moment().set('date', topDate).format('YYYY-MM-DD');
}

async function createAndMapAccounts(scrapperAccounts) {
  const map = scrapperAccounts.reduce((m, x) => ({ ...m, [x.accountNumber]: x }), {});

  const rawAccounts = await getAccounts();
  const accountsMap = rawAccounts.data.data
    .filter((x) => x.attributes.account_number && map[x.attributes.account_number])
    .map((x) => ({ id: x.id, accountNumber: x.attributes.account_number }))
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
      ...(map[a].accountDetails.kind !== 'bank' ? { credit_card_type: 'monthlyFull', monthly_payment_date: calcMonthlyPaymentDate(map[a]) } : {}),
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
  logger.info('Getting data for drop');
  const fireFlyData = await getAllTxs();
  const toDrop = fireFlyData
    .map((x) => ({ id: x.id, ...x.attributes.transactions[0] }));

  logger.info({
    count: toDrop.length,
    total: fireFlyData.length,
  }, 'Dropping transactions');

  let count = 1;
  await toDrop.reduce((p, tx) => p.then(async () => {
    await deleteTx(tx.id);
    count += 1;
    if (count % 50 === 0) {
      logger.info({ currentAmount: count }, 'Transactions deleted');
    }
  }, Promise.resolve()));
}

async function innerCreateTx(tx, count) {
  try {
    await createTx([tx]);
    if (count % 50 === 0) {
      logger.info({ currentAmount: count }, 'Transactions created.');
    }
  } catch (e) {
    logger.error({ error: e, tx }, 'Error creating transaction');
  }
}

async function innerUpdateTx({ id, type }, tx, count) {
  try {
    if (type !== tx.type) {
      await deleteTx(id);
      await createTx([tx]);
    } else {
      await updateTx(id, [tx]);
    }
    if (count % 50 === 0) {
      logger.info({ currentAmount: count }, 'Transactions updated.');
    }
  } catch (e) {
    logger.error({ error: e, tx }, 'Error updating transaction');
  }
}

const getters = {
  hash: (x) => hash(omitAccount(x)),
  identifier: (x) => x.identifier,
};

function omitAccount(tx) {
  const { account, ...rest } = tx;
  return rest;
}

function getExternalId(tx) {
  const identifyMethod = config.identifyMethod[tx.account.type] || 'identifier';
  const getter = getters[identifyMethod] || getters.identifier;
  return getter(tx);
}
