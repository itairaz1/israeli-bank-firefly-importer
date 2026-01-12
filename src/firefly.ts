/* eslint-disable no-await-in-loop */
import config from 'nconf';
import axios, { AxiosInstance } from 'axios';

let fireflyAxios: AxiosInstance;

export function init() {
  fireflyAxios = axios.create({
    headers: getHeader(),
    baseURL: config.get('firefly:baseUrl'),
  });
}

export async function searchTxs(options: Record<string, string | number>) {
  const query = Object.keys(options)
    .reduce((m, x) => `${m} ${x}:${options[x]}`, '')
    .trim();
  return paginate('/api/v1/search/transactions', query);
}

async function paginate(url: string, query?: string) {
  const fireFlyData: any[] = [];
  const urlSearchParams = new URLSearchParams({
    limit: config.get('firefly:limit'),
    ...(query ? { query } : {}),
  });
  let nextPage: string | null = `${url}?${urlSearchParams}`;
  while (nextPage) {
    let res;
    try {
      res = await fireflyAxios.get(nextPage);
    } catch (e: any) {
      if (e?.response?.status === 404) {
        return [];
      }
      throw e;
    }

    fireFlyData.push(...res.data.data);
    nextPage = res.data.links.next;
  }

  return fireFlyData;
}

export async function getAllTxs() {
  return paginate('/api/v1/search/transactions');
}

const getTxsByTagCache: Record<string, Promise<any[]>> = {};

export async function getTxsByTag(tag: string) {
  if (!getTxsByTagCache[tag]) {
    getTxsByTagCache[tag] = paginate(`/api/v1/tags/${tag}/transactions`);
  }
  return getTxsByTagCache[tag];
}

export function createTx(transactions: any[]) {
  return fireflyAxios.post('/api/v1/transactions', { transactions });
}

export function updateTx(id: string | number, transactions: any[]) {
  return fireflyAxios.put(`/api/v1/transactions/${id}`, { transactions });
}

export function deleteTx(id: string | number) {
  return fireflyAxios.delete(`/api/v1/transactions/${id}`);
}

export function getAccounts() {
  return fireflyAxios.get('/api/v1/accounts');
}

export function createAccount(data: any) {
  return fireflyAxios.post('/api/v1/accounts', data);
}

export function upsertConfig(state: any) {
  return fireflyAxios.post('/api/v1/preferences', {
    name: 'israeli-bank-importer',
    data: state,
  });
}

export function getConfig() {
  return fireflyAxios.get('/api/v1/preferences/israeli-bank-importer');
}

function getHeader() {
  return { Authorization: `Bearer ${config.get('firefly:tokenApi')}` };
}
