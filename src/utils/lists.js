import { api } from './api';
import { getOtherNetworkAccounts } from './bluesky';
import pmem from './pmem';
import store from './store';
import { getAccount, getCurrentAccount } from './store-utils';

const FETCH_MAX_AGE = 1000 * 60; // 1 minute
const MAX_AGE = 24 * 60 * 60 * 1000; // 1 day

async function fetchAccountLists(account) {
  try {
    const { masto, instance } = api({ account });
    const lists = await masto.v1.lists.list();
    // Tag each list with its owning account so the merged index knows which
    // client to route the list's timeline and membership edits through.
    return (lists || []).map((list) => ({
      ...list,
      _instance: list._instance || instance,
      _accountId: account?.info?.id,
    }));
  } catch (e) {
    console.error('Failed to fetch lists for account', account?.info?.id, e);
    return [];
  }
}

export const fetchLists = pmem(
  async () => {
    // Merge the current account's lists with other-network accounts', so a
    // Mastodon user also sees their Bluesky lists and vice versa — matching the
    // merged timeline / notifications / DMs.
    const accounts = [getCurrentAccount(), ...getOtherNetworkAccounts()]
      .filter(Boolean)
      .filter(
        (a, i, arr) => arr.findIndex((b) => b.info?.id === a.info?.id) === i,
      );
    const results = await Promise.all(accounts.map(fetchAccountLists));
    const lists = results.flat();
    lists.sort((a, b) => a.title.localeCompare(b.title));

    if (lists.length) {
      setTimeout(() => {
        // Save to local storage, with saved timestamp
        store.account.set('lists', {
          lists,
          updatedAt: Date.now(),
        });
      }, 1);
    }

    return lists;
  },
  {
    expires: FETCH_MAX_AGE,
  },
);

// Which account owns a given list (from the cached merged index), so list
// views can route to the right network. Null when unknown (e.g. a deep link
// before the Lists index has loaded) — callers fall back to the current account.
export function getListAccountId(id) {
  try {
    const { lists } = store.account.get('lists') || {};
    return lists?.find((l) => l.id === id)?._accountId || null;
  } catch (e) {
    return null;
  }
}

export async function getLists() {
  try {
    const { lists, updatedAt } = store.account.get('lists') || {};
    if (!lists?.length) return await fetchLists();
    if (Date.now() - updatedAt > MAX_AGE) {
      // Stale-while-revalidate
      fetchLists();
      return lists;
    }
    return lists;
  } catch (e) {
    return [];
  }
}

export const fetchList = pmem(
  (id) => {
    const accountId = getListAccountId(id);
    const account = accountId ? getAccount(accountId) : null;
    const { masto } = api(account ? { account } : undefined);
    return masto.v1.lists.$select(id).fetch();
  },
  {
    expires: FETCH_MAX_AGE,
  },
);

export async function getList(id) {
  const { lists } = store.account.get('lists') || {};
  console.log({ lists });
  if (lists?.length) {
    const theList = lists.find((l) => l.id === id);
    if (theList) return theList;
  }
  try {
    return fetchList(id);
  } catch (e) {
    return null;
  }
}

export async function getListTitle(id) {
  const list = await getList(id);
  return list?.title || '';
}

export function addListStore(list) {
  const { lists } = store.account.get('lists') || {};
  if (lists?.length) {
    lists.push(list);
    lists.sort((a, b) => a.title.localeCompare(b.title));
    store.account.set('lists', {
      lists,
      updatedAt: Date.now(),
    });
  }
}

export function updateListStore(list) {
  const { lists } = store.account.get('lists') || {};
  if (lists?.length) {
    const index = lists.findIndex((l) => l.id === list.id);
    if (index !== -1) {
      lists[index] = list;
      lists.sort((a, b) => a.title.localeCompare(b.title));
      store.account.set('lists', {
        lists,
        updatedAt: Date.now(),
      });
    }
  }
}

export function deleteListStore(listID) {
  const { lists } = store.account.get('lists') || {};
  if (lists?.length) {
    const index = lists.findIndex((l) => l.id === listID);
    if (index !== -1) {
      lists.splice(index, 1);
      store.account.set('lists', {
        lists,
        updatedAt: Date.now(),
      });
    }
  }
}
