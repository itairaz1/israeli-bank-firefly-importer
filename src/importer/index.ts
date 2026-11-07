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
  getErrorMessage,
  isNotFoundError,
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
import type {
  AccountsMap,
  EnrichedAccount,
  FireflyAccountRead,
  FireflyTxInput,
  FireflyTxRead,
  FireflyTxType,
  ImporterState,
  MappedAccount,
  Transaction,
} from '../types.js';

export interface ImportOptions {
  skipEdit?: boolean;
  onlyAccounts?: string[];
  cleanup?: boolean;
  since?: string;
}

interface ExistingTx {
  id: string;
  type: FireflyTxType;
}

type ExistingTxMap = Record<string, ExistingTx>;

type ScrapedTx = Transaction & { account: MappedAccount };

type CreateAccountResponse = Awaited<ReturnType<typeof createAccount>>;

interface AccountBalance {
  accountNumber: string | null;
  balance: number;
}

async function getMappedTransactions(scrapeFormattedTxs: FireflyTxInput[]): Promise<ExistingTxMap> {
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

function getCurrencyCode(x: Transaction): string | undefined {
  const currency = x.chargedCurrency || x.originalCurrency;
  if (!currency) {
    return undefined;
  }
  const currencySymbolMap: Record<string, string> = config.get('currencySymbolMap');
  return currencySymbolMap[currency] || currency;
}

async function getFireflyState(): Promise<ImporterState> {
  try {
    const axiosState = await getConfig();
    return JSON.parse(axiosState.data.data.attributes.data);
  } catch (err) {
    if (isNotFoundError(err)) {
      logger()
        .debug('Firefly previous state not found (its ok if its first run), using empty object.');
      return {};
    }
    throw err;
  }
}

export default async function doImport(options: ImportOptions): Promise<void> {
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
  const accountsMaps = await createAndMapAccounts(accounts);

  const scrapeFormattedTxs = accounts
    .reduce<ScrapedTx[]>((m, a) => ([...m, ...a.txns
      .map((tx) => ({
        ...tx,
        account: accountsMaps[a.accountNumber],
      }))]), [])
    .filter((x) => x.status === 'completed')
    .filter((x) => x.chargedAmount)
    .map((x): FireflyTxInput => ({
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

function getExistsTxMap(fireflyData: FireflyTxRead[]): ExistingTxMap {
  return fireflyData
    .map((x) => ({
      type: x.attributes.transactions[0].type,
      ext_id: x.attributes.transactions[0].external_id,
      id: x.id,
    }))
    .reduce<ExistingTxMap>((m, {
      id,
      ext_id: extId,
      type,
    }) => ({
      ...m,
      [String(extId)]: {
        id,
        type,
      },
    }), {});
}

function calcMonthlyPaymentDate(account: EnrichedAccount): string {
  const sumMap = account.txns
    .map((x) => moment(x.processedDate).date())
    .reduce<Record<string, number>>((m, x) => ({
      ...m,
      [x]: (m[x] || 0) + 1,
    }), {});

  const topDate = Object.keys(sumMap)
    .reduce<string | number>((m, x) => (m && sumMap[m] > sumMap[x] ? m : x), 0);

  return moment().set('date', Number(topDate)).format('YYYY-MM-DD');
}

async function getFireflyAccountsBalance(): Promise<AccountBalance[]> {
  const rawAccounts = await getAccounts();
  return rawAccounts.data.data
    .map((x) => ({
      accountNumber: x.attributes.account_number,
      balance: parseFloat(x.attributes.current_balance),
    }));
}

function logBalanceOutOfSync(
  fireflyAccounts: AccountBalance[],
  scrapeAccounts: EnrichedAccount[],
): void {
  const fireflyAccountsBalanceMap = fireflyAccounts
    .reduce<Record<string, number>>((m, x) => ({
      ...m,
      [String(x.accountNumber)]: x.balance,
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

async function createAndMapAccounts(scrapperAccounts: EnrichedAccount[]): Promise<AccountsMap> {
  const map = scrapperAccounts.reduce<Record<string, EnrichedAccount>>((m, x) => ({
    ...m,
    [x.accountNumber]: x,
  }), {});

  const rawAccounts = await getAccounts();
  const accountsMap = rawAccounts.data.data
    .filter((x): x is FireflyAccountRead & { attributes: { account_number: string } } => (
      !!x.attributes.account_number && !!map[x.attributes.account_number]
    ))
    .map((x) => ({
      id: x.id,
      accountNumber: x.attributes.account_number,
    }))
    .reduce<AccountsMap>((m, x) => ({
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
    .reduce<Promise<CreateAccountResponse[]>>((m, a) => m.then(async (x) => [
      ...x,
      await createAccount({
        name: a,
        account_number: a,
        type: 'asset',
        account_role: map[a].accountDetails.kind === 'bank' ? 'defaultAsset' : 'ccAsset',
        ...(map[a].accountDetails.kind !== 'bank' ? {
          credit_card_type: 'monthlyFull',
          monthly_payment_date: calcMonthlyPaymentDate(map[a]),
        } : {}),
      }),
    ]), Promise.resolve([]));

  return results.reduce<AccountsMap>((m, x) => ({
    ...m,
    [String(x.data.data.attributes.account_number)]: {
      ...map[String(x.data.data.attributes.account_number)].accountDetails,
      id: x.data.data.id,
    },
  }), accountsMap);
}

async function drop(): Promise<void> {
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
  }), Promise.resolve());
}

async function innerCreateTx(tx: FireflyTxInput, count: number): Promise<void> {
  try {
    await createTx([tx]);
    if (count % 50 === 0) {
      logger().info({ currentAmount: count }, 'Transactions created.');
    }
  } catch (e) {
    logger()
      .error({
        message: getErrorMessage(e),
        error: e,
        tx,
      }, 'Error creating transaction');
  }
}

async function innerUpdateTx(
  { id, type }: ExistingTx,
  tx: FireflyTxInput,
  count: number,
): Promise<void> {
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
        message: getErrorMessage(e),
        error: e,
        tx,
      }, 'Error updating transaction');
  }
}

type IdGetter = (x: ScrapedTx) => string;

const getters: Record<string, IdGetter> = {
  hash: (x) => hash(omitFields(x)),
  identifier: (x) => x.identifier as string,
};

function omitFields(tx: ScrapedTx) {
  const {
    account,
    category,
    ...rest
  } = tx;
  return rest;
}

function getExternalId(tx: ScrapedTx): string {
  const identifyMethods: Record<string, string> = config.get('identifyMethod');
  const identifyMethod = identifyMethods[tx.account.type] || 'identifier';
  const getter = getters[identifyMethod] || getters.identifier;
  return getter(tx);
}
