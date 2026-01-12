import moment from 'moment';

const identifyAccountByType: Record<string, (c: any) => string> = {
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

function getAccountIdentification(user: any) {
  return `${user.type}_${identifyAccountByType[user.type](user.credentials)}`;
}

export function getLastImport(account: any, state: any, since: any) {
  // When override
  if (since) {
    return moment(since);
  }

  // First run, when no state
  if (!state) {
    return null;
  }

  const accountIdentification = getAccountIdentification(account);
  if (state[accountIdentification]) {
    return moment(state[accountIdentification]);
  }

  return null;
}

export function getStateWithLastImport(users: any[], state: any) {
  const now = moment().toISOString();
  const lastState = typeof state.lastImport === 'string' ? {} : state.lastImport;
  const newLastImport = users.reduce((m: any, u: any) => ({
    ...m,
    [getAccountIdentification(u)]: now,
  }), lastState);
  return { ...state, lastImport: newLastImport };
}
