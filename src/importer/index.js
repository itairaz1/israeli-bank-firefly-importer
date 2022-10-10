import hash from 'object-hash';
import { manipulateTxs } from './credit-cards.js';
import { createAccount, createTx, deleteTx, getAccounts, getAllTxs, getConfig, searchTxs, updateTx } from './../firefly.js';
import { getScrappedAccounts } from './scrapper.js';
import config from 'config';
import moment from 'moment';

export async function doImport(options) {
  const skipEdit = options.skipEdit;
  const onlyAccounts = options.onlyAccounts;
  const since = options.since;
  const cleanup = options.cleanup;

  if (cleanup) {
    await drop();
  }

  console.log('Getting scrap data...');
  const accounts = await getScrappedAccounts(since, onlyAccounts);

  console.log('Getting or creating accounts...');
  const accountsMaps = await createAndMapAccounts(accounts);

  const fireTxs = accounts
    .reduce((m, a) => ([...m, ...a.txns.map(tx => ({ ...tx, account: accountsMaps[a.accountNumber] }))]), [])
    .filter(x => x.status === 'completed')
    .filter(x => x.chargedAmount)
    .map(x => ({
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

  console.log('Manipulating...');
  const preparedFireTxs = await manipulateTxs(fireTxs, accountsMaps);

  console.log('Getting map...');
  const minimalDate = fireTxs
    .map(x => moment(x.date))
    .reduce((m, x) => x.isBefore(m) ? x : m, moment());
  const getTxSince = moment(minimalDate).subtract(1, 'day');
  const workingTxs = await searchTxs({ date_after: getTxSince.format('YYYY-MM-DD') });
  const currentTxMap = await getExistsTxMap(workingTxs);

  const toCreate = preparedFireTxs.filter(x => !currentTxMap[x.external_id]);
  console.log(`Creating ${toCreate.length} txs to firefly...`);
  await toCreate.reduce((p, x, i) => p.then(() => innerCreateTx(x, i + 1)), Promise.resolve());

  const toTypeUpdate = preparedFireTxs.filter(x => currentTxMap[x.external_id] && currentTxMap[x.external_id].type !== x.type);
  console.log(`Type updating ${toTypeUpdate.length} txs to firefly...`);
  await toTypeUpdate.reduce((p, x, i) => p.then(() => innerUpdateTx(currentTxMap[x.external_id], x, i + 1)), Promise.resolve());

  if (!skipEdit) {
    const toUpdate = preparedFireTxs.filter(x => currentTxMap[x.external_id] && currentTxMap[x.external_id].type === x.type);
    console.log(`Updating ${toUpdate.length} txs to firefly...`);
    await toUpdate.reduce((p, x, i) => p.then(() => innerUpdateTx(currentTxMap[x.external_id], x, i + 1)), Promise.resolve());
  }

  console.log('Done.');
}

async function getExistsTxMap(fireFlyData) {
  return fireFlyData
    .map(x => ({
      type: x.attributes.transactions[0].type,
      ext_id: x.attributes.transactions[0].external_id,
      id: x.id,
    }))
    .reduce((m, { id, ext_id, type }) => ({ ...m, [ext_id]: { id, type } }), {});
}

function calcMonthlyPaymentDate(account) {
  const sumMap = account.txns
    .map(x => moment(x.processedDate).date())
    .reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {});

  const topDate = Object.keys(sumMap).reduce((m, x) => m && sumMap[m] > sumMap[x] ? m : x, 0);

  return moment().set('date', topDate).format('YYYY-MM-DD');
}

async function createAndMapAccounts(scrapperAccounts) {
  const map = scrapperAccounts.reduce((m, x) => ({ ...m, [x.accountNumber]: x }), {});

  const rawAccounts = await getAccounts();
  const accountsMap = rawAccounts.data.data
    .filter(x => x.attributes.account_number && map[x.attributes.account_number])
    .map(x => ({ id: x.id, accountNumber: x.attributes.account_number }))
    .reduce((m, x) => ({ ...m, [x.accountNumber]: { ...map[x.accountNumber].accountDetails, id: x.id } }), {});
  const missedAccounts = scrapperAccounts
    .map(x => x.accountNumber)
    .filter(x => !accountsMap[x]);

  const results = await missedAccounts.reduce((m, a) => m.then(async x => [...x, await createAccount({
    name: a,
    account_number: a,
    type: 'asset',
    account_role: map[a].accountDetails.kind === 'bank' ? 'defaultAsset' : 'ccAsset',
    ...(map[a].accountDetails.kind !== 'bank' ? { credit_card_type: 'monthlyFull', monthly_payment_date: calcMonthlyPaymentDate(map[a]) } : {}),
  })]), Promise.resolve([]));

  return results.reduce((m, x) => ({
    ...m,
    [x.data.data.attributes.account_number]: { ...map[x.data.data.attributes.account_number].accountDetails, id: x.data.data.id },
  }), accountsMap);
}

async function drop() {
  console.log('Getting data for drop');
  const fireFlyData = await getAllTxs();
  const toDrop = fireFlyData
    .map(x => ({ id: x.id, ...x.attributes.transactions[0] }))
    .filter(x => x.source_id === '1' || x.destination_id === '1')
  ;

  console.log(`Dropping ${toDrop.length} txs (out of ${fireFlyData.length})...`);

  let count = 1;
  for (let tx of toDrop) {
    await deleteTx(tx.id);
    count++;
    if (count % 50 === 0) {
      console.log(`Deleted ${count}`);
    }
  }
}

async function innerCreateTx(tx, count) {
  try {
    await createTx([tx]);
    if (count % 50 === 0) {
      console.log(`Created ${count} txs.`);
    }
  } catch (e) {
    console.log(`error ${tx} with ${e.message}`);
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
      console.log(`Updated ${count} txs.`);
    }

  } catch (e) {
    console.log(`error ${tx} with ${e.message}`);
  }
}

const getters = {
  hash: x => hash(omitAccount(x)),
  identifier: x => x.identifier,
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
