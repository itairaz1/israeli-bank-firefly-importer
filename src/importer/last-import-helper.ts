import moment, { Moment } from 'moment';
import type {
  Credentials,
  ImporterState,
  LastImportState,
  UserOptions,
} from '../types.js';

type Identifier = (c: Credentials) => string;

const identifyAccountByType: Record<string, Identifier> = {
  leumi: (c) => c.username,
  visaCal: (c) => c.username,
  beinleumi: (c) => c.username,
  mizrahi: (c) => c.username,
  massad: (c) => c.username,
  max: (c) => c.username,
  amex: (c) => c.username,
  yahav: (c) => c.username,
  'otsar-hahayal': (c) => c.username,
  isracard: (c) => c.id,
  discount: (c) => c.id,
  'beyahad-bishvilha': (c) => c.id,
  hapoalim: (c) => c.userCode,
};

function getAccountIdentification(user: UserOptions): string {
  return `${user.type}_${identifyAccountByType[user.type](user.credentials)}`;
}

export function getLastImport(
  account: UserOptions,
  state: ImporterState['lastImport'],
  since?: string,
): Moment | null {
  // When override
  if (since) {
    return moment(since);
  }

  // First run, when no state
  if (!state) {
    return null;
  }

  const accountIdentification = getAccountIdentification(account);
  if (typeof state === 'object' && state[accountIdentification]) {
    return moment(state[accountIdentification]);
  }

  return null;
}

export function getStateWithLastImport(users: UserOptions[], state: ImporterState): ImporterState {
  const now = moment().toISOString();
  const lastState: LastImportState = typeof state.lastImport === 'string' ? {} : state.lastImport ?? {};
  const newLastImport = users.reduce<LastImportState>((m, u) => ({
    ...m,
    [getAccountIdentification(u)]: now,
  }), lastState);
  return { ...state, lastImport: newLastImport };
}
