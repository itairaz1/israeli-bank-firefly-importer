import moment from 'moment';

const identifyAccountByType = {
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

function getAccountIdentification(user) {
  return `${user.type}_${identifyAccountByType[user.type](user.credentials)}`;
}

export function getLastImport(account, state, since) {
  // When override
  if (since) {
    return moment(since);
  }

  // This is for backward compatibility, we can remove it later.
  if (typeof state === 'string') {
    return moment(state);
  }

  const accountIdentification = getAccountIdentification(account);
  if (state[accountIdentification]) {
    return moment(state[accountIdentification]);
  }

  return null;
}

export function getStateWithLastImport(users, state) {
  const now = moment().toISOString();
  const lastState = typeof state.lastImport === 'string' ? {} : state.lastImport;
  const newLastImport = users.reduce((m, u) => ({
    ...m,
    [getAccountIdentification(u)]: now,
  }), lastState);
  return { ...state, lastImport: newLastImport };
}
