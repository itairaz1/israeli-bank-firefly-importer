import moment from 'moment';
import config from 'config';
import { getTxsByTag } from './../firefly.js';

const creditCardDescConfig = config.creditCardDesc;

export function manipulateTxs(txs, accountsMap) {
  const ccDesc = getCcDesc(accountsMap);
  return txs.reduce((m, tx) => m.then(async x => [...x, await manipulateTx(tx, ccDesc, accountsMap)]), Promise.resolve([]));
}

async function manipulateTx(tx, ccDesc, accountsMap) {
  let newTx = tx;
  newTx = { ...newTx, tags: ccTag(tx, accountsMap) };
  newTx = await ccTransfer(newTx, ccDesc, accountsMap);
  return newTx;
}

function getCcDesc(accountsMap) {
  const typeToIds = Object.values(accountsMap)
    .filter(x => x.kind === 'credit-card')
    .map(x => ({ type: x.type, id: x.id }))
    .reduce((m, x) => ({
      ...m,
      [x.type]: [...(m[x.type] || []), x.id],
    }), {});

  return creditCardDescConfig.reduce((m, x) => ({ ...m, [x.desc]: { ids: typeToIds[x.creditCard], method: x.method || 'process-date' } }), {});
}

function ccTag(tx, accountsMap) {
  const isCc = Object.values(accountsMap).some(x => x.kind === 'credit-card' && (x.id === tx.source_id || x.id === tx.destination_id));
  if (!isCc) {
    return null;
  }
  const accountId = tx.source_id || tx.destination_id;
  const processDate = tx.process_date;
  return [`${accountId}_${processDate}`];
}

const methods = {
  'process-date': processByProcessDate,
  'reference': processByReference,
};

async function processByReference(tx, ccAccountsIds, accountsMap) {
  const accountNumber = tx.internal_reference;
  return accountsMap[accountNumber].id;
}

async function processByProcessDate(tx, ccAccountsIds) {
  const processDate = tx.process_date;

  let index;
  if (ccAccountsIds.length === 1) {
    const amount = await getTxAmount(processDate, ccAccountsIds[0]);
    if (amount === 0) {
      return null;
    }

    index = 0;
  } else {
    const amountsByIndex = await Promise.all(ccAccountsIds.map(x => getTxAmount(processDate, x)));
    const nonAbsAmount = (tx.type === 'deposit' ? 1 : -1) * tx.amount;
    index = amountsByIndex.indexOf(nonAbsAmount);
    if (index === -1) {
      return null;
    }
  }

  return ccAccountsIds[index];
}

async function ccTransfer(tx, ccDesc, accountsMap) {
  if (tx.type === 'transfer') {
    return tx;
  }
  if (!ccDesc[tx.description]) {
    return tx;
  }

  const ccAccountsIds = ccDesc[tx.description];
  const process = methods[ccAccountsIds.method];
  const accountId = await process(tx, ccAccountsIds.ids, accountsMap);
  if (accountId === null) {
    return tx;
  }
  return {
    ...tx,
    type: 'transfer',
    source_id: tx.source_id || accountId,
    destination_id: tx.destination_id || accountId,
  };
}

async function getTxAmount(processDate, accountId) {
  let res = await getTxsByTag(`${accountId}_${processDate}`);
  if (res.length === 0) {
    const yd = moment(processDate).subtract(1, 'day').toISOString();
    res = await getTxsByTag(`${accountId}_${yd}`);
  }
  const txs = res.map(x => x.attributes.transactions[0]);
  const sum = txs.reduce((m, x) => (x.type === 'deposit' ? 1 : -1) * x.amount + m, 0);
  return Math.round(sum * 100) / 100;
}
