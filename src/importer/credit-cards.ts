import moment from 'moment';
import config from 'nconf';
import { getTxsByTag } from '../firefly.js';
import logger from '../logger.js';

export default function manipulateTxs(txs: any[], accountsMap: any) {
  const ccDesc = getCcDesc(accountsMap);
  return txs.reduce(
    (m, tx) => m.then(async (x: any) => [...x, await manipulateTx(tx, ccDesc, accountsMap)]),
    Promise.resolve([]),
  );
}

async function manipulateTx(tx: any, ccDesc: any, accountsMap: any) {
  let newTx = tx;
  newTx = {
    ...newTx,
    tags: ccTag(tx, accountsMap),
  };
  newTx = await ccTransfer(newTx, ccDesc, accountsMap);
  return newTx;
}

function getCcDesc(accountsMap: any) {
  const typeToIds = Object.values(accountsMap)
    .filter((x: any) => x.kind === 'credit-card')
    .map((x: any) => ({
      type: x.type,
      id: x.id,
    }))
    .reduce((m: any, x: any) => ({
      ...m,
      [x.type]: [...(m[x.type] || []), x.id],
    }), {});

  return config.get('creditCardDesc')
    .reduce((m: any, x: any) => ({
      ...m,
      [x.desc]: {
        ids: typeToIds[x.creditCard] || [],
        method: x.method || 'process-date',
      },
    }), {});
}

function ccTag(tx: any, accountsMap: any) {
  const isCc = Object.values(accountsMap)
    .some((x: any) => x.kind === 'credit-card' && (x.id === tx.source_id || x.id === tx.destination_id));
  if (!isCc) {
    return null;
  }
  const accountId = tx.source_id || tx.destination_id;
  const processDate = tx.process_date;
  return [`${accountId}_${processDate}`];
}

const methods: Record<string, (...args: any[]) => any> = {
  'process-date': processByProcessDate,
  reference: processByReference,
};

async function processByReference(tx: any, ccAccountsIds: any, accountsMap: any) {
  const accountNumber = tx.internal_reference;
  return accountsMap[accountNumber].id;
}

async function processByProcessDate(tx: any, ccAccountsIds: any) {
  const processDate = tx.process_date;

  let index;
  if (ccAccountsIds.length === 1) {
    const amount = await getTxAmount(processDate, ccAccountsIds[0]);
    if (amount === 0) {
      return null;
    }

    index = 0;
  } else {
    const amountsByIndex = await Promise.all(
      ccAccountsIds.map((x: any) => getTxAmount(processDate, x)),
    );
    const nonAbsAmount = (tx.type === 'deposit' ? 1 : -1) * tx.amount;
    index = amountsByIndex.indexOf(nonAbsAmount);
    if (index === -1) {
      return null;
    }
  }

  return ccAccountsIds[index];
}

async function ccTransfer(tx: any, ccDesc: any, accountsMap: any) {
  if (tx.type === 'transfer') {
    return tx;
  }
  if (!ccDesc[tx.description]) {
    return tx;
  }

  logger().debug({ tx: tx.description }, 'Found credit card transaction');
  const ccAccountsIds = ccDesc[tx.description];
  const process = methods[ccAccountsIds.method];
  const accountId = await process(tx, ccAccountsIds.ids, accountsMap);
  if (accountId === null) {
    logger()
      .warn({ tx: tx.description, ccAccountsIds }, 'Couldn\'t find credit card billing period for transaction');
    return tx;
  }
  return {
    ...tx,
    type: 'transfer',
    source_id: tx.source_id || accountId,
    destination_id: tx.destination_id || accountId,
  };
}

async function getTxAmount(processDate: string, accountId: number) {
  let res = await getTxsByTag(`${accountId}_${processDate}`);
  if (res.length === 0) {
    const yd = moment(processDate)
      .subtract(1, 'day')
      .toISOString();
    res = await getTxsByTag(`${accountId}_${yd}`);
  }
  const txs = res.map((x: any) => x.attributes.transactions[0]);
  const sum = txs.reduce((m: number, x: any) => (x.type === 'deposit' ? 1 : -1) * x.amount + m, 0);
  return Math.round(sum * 100) / 100;
}
