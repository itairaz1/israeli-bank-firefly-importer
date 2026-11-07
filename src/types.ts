import type { Moment } from 'moment';
import type {
  CompanyTypes,
  ScraperOptions,
  ScraperScrapingResult,
} from 'israeli-bank-scrapers';
import type { Transaction, TransactionsAccount } from 'israeli-bank-scrapers/lib/transactions.js';

export type { Transaction, TransactionsAccount };

// ---------- Configuration ----------

export type CompanyType = keyof typeof CompanyTypes;

export type Credentials = Record<string, string>;

export interface AccountConfig {
  type: CompanyType;
  credentials: Credentials;
  name?: string;
}

export interface BankConfig extends AccountConfig {
  creditCards?: AccountConfig[];
}

export type CreditCardMethod = 'process-date' | 'reference';

export interface CreditCardDescConfig {
  desc: string;
  creditCard: string;
  method?: CreditCardMethod;
}

export interface ScraperConfig {
  parallel?: boolean;
  options?: Partial<ScraperOptions>;
}

// ---------- Scraping ----------

export interface UserOptions extends AccountConfig {
  parentBankIndex?: number;
}

export interface FlatUser extends UserOptions {
  lastImport: Moment | null;
  scrapFrom: Moment;
}

export type AccountKind = 'bank' | 'credit-card';

export interface AccountDetails {
  type: CompanyType;
  kind: AccountKind;
}

export interface EnrichedAccount extends TransactionsAccount {
  accountDetails: AccountDetails;
}

export type ScrapResult = ScraperScrapingResult;

// ---------- Import state ----------

export type LastImportState = Record<string, string>;

export interface ImporterState {
  lastImport?: LastImportState | string;
  [key: string]: unknown;
}

// ---------- Firefly ----------

export type FireflyTxType = 'deposit' | 'withdrawal' | 'transfer';

/** A transaction split as sent to Firefly when creating/updating. */
export interface FireflyTxInput {
  type: FireflyTxType;
  date: string;
  amount: number;
  description: string;
  notes?: string;
  source_id?: string;
  destination_id?: string;
  internal_reference?: string | number;
  external_id: string;
  currency_code?: string;
  process_date: string;
  category_name?: string;
  tags?: string[] | null;
}

/** A transaction split as returned by the Firefly API. */
export interface FireflyTxSplit {
  type: FireflyTxType;
  amount: string;
  external_id: string | null;
  [key: string]: unknown;
}

export interface FireflyTxRead {
  id: string;
  attributes: {
    transactions: FireflyTxSplit[];
  };
}

export interface FireflyAccountRead {
  id: string;
  attributes: {
    account_number: string | null;
    current_balance: string;
    [key: string]: unknown;
  };
}

export interface FireflyAccountInput {
  name: string;
  account_number: string;
  type: 'asset';
  account_role: 'defaultAsset' | 'ccAsset';
  credit_card_type?: 'monthlyFull';
  monthly_payment_date?: string;
}

export interface FireflyListResponse<T> {
  data: T[];
  links: { next?: string };
}

export interface FireflySingleResponse<T> {
  data: T;
}

export interface FireflyPreference {
  id: string;
  attributes: {
    name: string;
    data: string;
  };
}

/** A Firefly account mapped to the scraped account details. */
export interface MappedAccount extends AccountDetails {
  id: string;
}

export type AccountsMap = Record<string, MappedAccount>;
