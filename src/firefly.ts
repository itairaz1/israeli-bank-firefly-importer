/* eslint-disable no-await-in-loop */
import config from 'nconf';
import axios, { AxiosInstance, isAxiosError } from 'axios';
import type {
  FireflyAccountInput,
  FireflyAccountRead,
  FireflyListResponse,
  FireflyPreference,
  FireflySingleResponse,
  FireflyTxInput,
  FireflyTxRead,
} from './types.js';

let fireflyAxios: AxiosInstance;

export function init(): void {
  fireflyAxios = axios.create({
    headers: getHeader(),
    baseURL: config.get('firefly:baseUrl'),
  });
}

export function isNotFoundError(e: unknown): boolean {
  return isAxiosError(e) && e.response?.status === 404;
}

export function getErrorMessage(e: unknown): string | undefined {
  return isAxiosError(e) ? e.response?.data?.message : undefined;
}

export async function searchTxs(options: Record<string, string>): Promise<FireflyTxRead[]> {
  const query = Object.keys(options)
    .reduce((m, x) => `${m} ${x}:${options[x]}`, '')
    .trim();
  return paginate<FireflyTxRead>('/api/v1/search/transactions', query);
}

async function paginate<T>(url: string, query?: string): Promise<T[]> {
  const fireFlyData: T[] = [];
  const urlSearchParams = new URLSearchParams({
    limit: config.get('firefly:limit'),
    ...query ? { query } : {},
  });
  let nextPage: string | undefined = `${url}?${urlSearchParams}`;
  while (nextPage) {
    let res;
    try {
      res = await fireflyAxios.get<FireflyListResponse<T>>(nextPage);
    } catch (e) {
      if (isNotFoundError(e)) {
        return [];
      }
      throw e;
    }

    fireFlyData.push(...res.data.data);
    nextPage = res.data.links.next;
  }

  return fireFlyData;
}

export async function getAllTxs(): Promise<FireflyTxRead[]> {
  return paginate<FireflyTxRead>('/api/v1/search/transactions');
}

const getTxsByTagCache: Record<string, Promise<FireflyTxRead[]>> = {};

export async function getTxsByTag(tag: string): Promise<FireflyTxRead[]> {
  if (!getTxsByTagCache[tag]) {
    getTxsByTagCache[tag] = paginate<FireflyTxRead>(`/api/v1/tags/${tag}/transactions`);
  }
  return getTxsByTagCache[tag];
}

export function createTx(transactions: FireflyTxInput[]) {
  return fireflyAxios.post('/api/v1/transactions', { transactions });
}

export function updateTx(id: string, transactions: FireflyTxInput[]) {
  return fireflyAxios.put(`/api/v1/transactions/${id}`, { transactions });
}

export function deleteTx(id: string) {
  return fireflyAxios.delete(`/api/v1/transactions/${id}`);
}

export async function getAccounts(): Promise<{ data: { data: FireflyAccountRead[] } }> {
  const data = await paginate<FireflyAccountRead>('/api/v1/accounts');
  return { data: { data } };
}

export function createAccount(data: FireflyAccountInput) {
  return fireflyAxios.post<FireflySingleResponse<FireflyAccountRead>>('/api/v1/accounts', data);
}

export function upsertConfig(state: string) {
  return fireflyAxios.post('/api/v1/preferences', {
    name: 'israeli-bank-importer',
    data: state,
  });
}

export function getConfig() {
  return fireflyAxios.get<FireflySingleResponse<FireflyPreference>>('/api/v1/preferences/israeli-bank-importer');
}

function getHeader(): Record<string, string> {
  return { Authorization: `Bearer ${config.get('firefly:tokenApi')}` };
}
