/* eslint-disable no-await-in-loop */
import config from 'config';
import axios from 'axios';
import logger from './logger.js';

let fireflyAxios;

export function init() {
  fireflyAxios = axios.create({
    headers: getHeader(),
    baseURL: config.firefly.baseUrl,
  });
}

export async function searchTxs(options) {
  const query = Object.keys(options)
    .reduce((m, x) => `${m} ${x}:${options[x]}`, '')
    .trim();
  let page = 1;
  let totalPages = 1;
  const fireFlyData = [];
  while (page <= totalPages) {
    const res = await fireflyAxios.get('/api/v1/search/transactions', {
      params: {
        query,
        page,
      },
    });

    logger().info({
      currentPage: res.data.meta.pagination.current_page,
      totalPages: res.data.meta.pagination.total_pages,
    }, 'Transaction page fetched');

    fireFlyData.push(...res.data.data);
    totalPages = res.data.meta.pagination.total_pages;
    page += 1;
  }

  return fireFlyData;
}

export async function getAllTxs() {
  let nextPage = '/api/v1/transactions';
  const fireFlyData = [];
  while (nextPage) {
    const res = await fireflyAxios.get(nextPage);

    logger().info({
      currentPage: res.data.meta.pagination.current_page,
      totalPages: res.data.meta.pagination.total_pages,
    }, 'Transaction page fetched');

    fireFlyData.push(...res.data.data);
    nextPage = res.data.links.next;
  }

  return fireFlyData;
}

const getTxsByTagCache = {};

export async function getTxsByTag(tag) {
  if (getTxsByTagCache[tag]) {
    return getTxsByTagCache[tag];
  }
  let nextPage = `/api/v1/tags/${tag}/transactions`;
  const fireFlyData = [];
  while (nextPage) {
    let res;
    try {
      res = await fireflyAxios.get(nextPage);
    } catch (e) {
      if (e.response.status === 404) {
        return [];
      }
    }

    fireFlyData.push(...res.data.data);
    nextPage = res.data.links.next;
  }
  getTxsByTagCache[tag] = fireFlyData;
  return fireFlyData;
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
  return { Authorization: `Bearer ${config.firefly.tokenApi}` };
}
