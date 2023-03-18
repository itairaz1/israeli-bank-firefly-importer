/* eslint-disable no-await-in-loop */
import config from 'nconf';
import axios from 'axios';

let fireflyAxios;

export function init() {
  fireflyAxios = axios.create({
    headers: getHeader(),
    baseURL: config.get('firefly:baseUrl'),
  });
}

export async function searchTxs(options) {
  const query = Object.keys(options)
    .reduce((m, x) => `${m} ${x}:${options[x]}`, '')
    .trim();
  return paginate('/api/v1/search/transactions', query);
}

async function paginate(url, query) {
  const fireFlyData = [];
  const urlSearchParams = new URLSearchParams({
    limit: config.get('firefly:limit'),
    ...query ? { query } : {},
  });
  let nextPage = `${url}?${urlSearchParams}`;
  while (nextPage) {
    let res;
    try {
      res = await fireflyAxios.get(nextPage);
    } catch (e) {
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

const getTxsByTagCache = {};

export async function getTxsByTag(tag) {
  if (!getTxsByTagCache[tag]) {
    getTxsByTagCache[tag] = paginate(`/api/v1/tags/${tag}/transactions`);
  }
  return getTxsByTagCache[tag];
}

export function createTx(transactions) {
  return fireflyAxios.post('/api/v1/transactions', { transactions });
}

export function updateTx(id, transactions) {
  return fireflyAxios.put(`/api/v1/transactions/${id}`, { transactions });
}

export function deleteTx(id) {
  return fireflyAxios.delete(`/api/v1/transactions/${id}`);
}

export function getAccounts() {
  return fireflyAxios.get('/api/v1/accounts');
}

export function createAccount(data) {
  return fireflyAxios.post('/api/v1/accounts', data);
}

export function upsertConfig(state) {
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
