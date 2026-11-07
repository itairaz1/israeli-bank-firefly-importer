import moment from 'moment';
import config from 'nconf';
import { getTxsByTag } from '../firefly.js';
import logger from '../logger.js';
import type {
  AccountsMap,
  CreditCardDescConfig,
  CreditCardMethod,
  FireflyTxInput,
} from '../types.js';

interface CcDescEntry {
  ids: string[];
  method: CreditCardMethod;
}

type CcDesc = Record<string, CcDescEntry>;

type ProcessMethod = (
  tx: FireflyTxInput,
  ccAccountsIds: string[],
  accountsMap: AccountsMap,
) => Promise<string | null>;

export default function manipulateTxs(
  txs: FireflyTxInput[],
  accountsMap: AccountsMap,
): Promise<FireflyTxInput[]> {
  const ccDesc = getCcDesc(accountsMap);
  return txs.reduce<Promise<FireflyTxInput[]>>(
    (m, tx) => m.then(async (x) => [...x, await manipulateTx(tx, ccDesc, accountsMap)]),
    Promise.resolve([]),
  );
}

async function manipulateTx(
  tx: FireflyTxInput,
  ccDesc: CcDesc,
  accountsMap: AccountsMap,
): Promise<FireflyTxInput> {
  let newTx = tx;
  newTx = {
    ...newTx,
    tags: ccTag(tx, accountsMap),
  };
  newTx = await ccTransfer(newTx, ccDesc, accountsMap);
  return newTx;
}

function getCcDesc(accountsMap: AccountsMap): CcDesc {
  const typeToIds = Object.values(accountsMap)
    .filter((x) => x.kind === 'credit-card')
    .map((x) => ({
      type: x.type,
      id: x.id,
    }))
    .reduce<Record<string, string[]>>((m, x) => ({
      ...m,
      [x.type]: [...(m[x.type] || []), x.id],
    }), {});

  const creditCardDesc: CreditCardDescConfig[] = config.get('creditCardDesc');
  return creditCardDesc
    .reduce<CcDesc>((m, x) => ({
      ...m,
      [x.desc]: {
        ids: typeToIds[x.creditCard] || [],
        method: x.method || 'process-date',
      },
    }), {});
}

function ccTag(tx: FireflyTxInput, accountsMap: AccountsMap): string[] | null {
  const isCc = Object.values(accountsMap)
    .some((x) => x.kind === 'credit-card' && (x.id === tx.source_id || x.id === tx.destination_id));
  if (!isCc) {
    return null;
  }
  const accountId = tx.source_id || tx.destination_id;
  const processDate = tx.process_date;
  return [`${accountId}_${processDate}`];
}

const methods: Record<CreditCardMethod, ProcessMethod> = {
  'process-date': processByProcessDate,
  reference: processByReference,
};

async function processByReference(
  tx: FireflyTxInput,
  ccAccountsIds: string[],
  accountsMap: AccountsMap,
): Promise<string | null> {
  const accountNumber = String(tx.internal_reference);
  return accountsMap[accountNumber].id;
}

async function processByProcessDate(
  tx: FireflyTxInput,
  ccAccountsIds: string[],
): Promise<string | null> {
  const processDate = tx.process_date;

  let index;
  if (ccAccountsIds.length === 1) {
    const amount = await getTxAmount(processDate, ccAccountsIds[0]);
    if (amount === 0) {
      return null;
    }

    index = 0;
  } else {
    const amountsByIndex = await Promise.all(ccAccountsIds.map((x) => getTxAmount(processDate, x)));
    const nonAbsAmount = (tx.type === 'deposit' ? 1 : -1) * tx.amount;
    index = amountsByIndex.indexOf(nonAbsAmount);
    if (index === -1) {
      return null;
    }
  }

  return ccAccountsIds[index];
}

async function ccTransfer(
  tx: FireflyTxInput,
  ccDesc: CcDesc,
  accountsMap: AccountsMap,
): Promise<FireflyTxInput> {
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

async function getTxAmount(processDate: string, accountId: string): Promise<number> {
  let res = await getTxsByTag(`${accountId}_${processDate}`);
  if (res.length === 0) {
    const yd = moment(processDate)
      .subtract(1, 'day')
      .toISOString();
    res = await getTxsByTag(`${accountId}_${yd}`);
  }
  const txs = res.map((x) => x.attributes.transactions[0]);
  const sum = txs.reduce((m, x) => (x.type === 'deposit' ? 1 : -1) * Number(x.amount) + m, 0);
  return Math.round(sum * 100) / 100;
}
