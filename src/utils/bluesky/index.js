// Bluesky account management + client registry for phanpy
import store from '../store';
import {
  getAccount,
  getAccounts,
  getCurrentAccountID,
  mutateAccounts,
  saveAccounts,
  setCurrentAccountID,
} from '../store-utils';

import { createBlueskyClient, loadAtproto } from './client';
import { blueskyInstanceInfo, profileToAccount } from './convert';

export { isBlueskyStatusID } from './convert';

export const DEFAULT_BLUESKY_SERVICE = 'https://bsky.social';

// did → client
const blueskyClients = {};

export function isBlueskyAccount(account) {
  return account?.accountType === 'bluesky';
}

// Logged-in check that works for both auth modes: app-password sessions
// keep a refresh JWT in the account; OAuth sessions keep tokens in the
// OAuth client's own store and only mark the account with blueskyAuth.
// `authExpired` marks a terminally-dead session (set below in
// markBlueskyAuthExpired) — treat it as logged out so merged-timeline and
// cross-post fan-outs skip the account instead of erroring on every call.
export function isBlueskyLoggedIn(account) {
  return (
    isBlueskyAccount(account) &&
    !account.authExpired &&
    (account.blueskyAuth === 'oauth' || !!account.blueskySession?.refreshJwt)
  );
}

export function getBlueskyAccounts() {
  return getAccounts().filter(isBlueskyLoggedIn);
}

// Whether the user is logged in to both networks — used to decide when
// per-post network badges are worth showing. Cached per page load
// (account changes trigger a reload anyway).
let multiNetwork = null;
export function hasMultipleNetworks() {
  if (multiNetwork !== null) return multiNetwork;
  const accounts = getAccounts();
  return (multiNetwork =
    accounts.some(isBlueskyLoggedIn) &&
    accounts.some((a) => !isBlueskyAccount(a) && a.accessToken));
}

// Instances (hostnames) that belong to logged-in Bluesky accounts
export function isBlueskyInstance(instance) {
  if (!instance) return false;
  instance = instance.toLowerCase().trim();
  return getAccounts().some(
    (a) => isBlueskyAccount(a) && a.instanceURL === instance,
  );
}

export function getBlueskyAccountForInstance(instance) {
  if (!instance) return null;
  instance = instance.toLowerCase().trim();
  return (
    getAccounts().find(
      (a) => isBlueskyAccount(a) && a.instanceURL === instance,
    ) || null
  );
}

function persistSessionForAccount(did, session) {
  mutateAccounts((accounts) => {
    const acc = accounts.find((a) => a.info.id === did);
    if (!acc) return false;
    acc.blueskySession = {
      did: session.did,
      handle: session.handle,
      accessJwt: session.accessJwt,
      refreshJwt: session.refreshJwt,
      active: session.active !== false,
    };
    acc.accessToken = session.accessJwt;
    // A live token refresh proves the session works again
    delete acc.authExpired;
  });
}

// Terminal session death (refresh token revoked/expired and nothing newer in
// the store): flag the account so the UI can offer "Log back in" and merged
// views stop fanning out to it. Cleared by persistSessionForAccount or a
// fresh login.
function markBlueskyAuthExpired(did) {
  mutateAccounts((accounts) => {
    const acc = accounts.find((a) => a.info.id === did);
    if (!acc || acc.authExpired) return false;
    acc.authExpired = true;
  });
}

export function getBlueskyClient(account) {
  const did = account.info.id;
  if (blueskyClients[did]) return blueskyClients[did];
  const client = createBlueskyClient({
    service: account.blueskyService || DEFAULT_BLUESKY_SERVICE,
    instance: account.instanceURL,
    session: account.blueskySession,
    did,
    authType: account.blueskyAuth || 'password',
    onSessionChange: (session) => persistSessionForAccount(did, session),
    onSessionDeleted: () => {
      delete blueskyClients[did];
    },
    getStoredSession: () =>
      getAccounts().find((a) => a.info.id === did)?.blueskySession || null,
    onAuthExpired: () => markBlueskyAuthExpired(did),
  });
  blueskyClients[did] = client;
  return client;
}

// Other tabs/windows rotate the (single-use) refresh tokens and persist them
// to localStorage; adopt those rotations into any live agents here so this
// context doesn't later refresh with a revoked token. `storage` fires only in
// contexts other than the writer, so this never loops.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== 'accounts' || !e.newValue) return;
    let accounts;
    try {
      accounts = JSON.parse(e.newValue);
    } catch (err) {
      return;
    }
    if (!Array.isArray(accounts)) return;
    for (const did of Object.keys(blueskyClients)) {
      const acc = accounts.find((a) => a?.info?.id === did);
      if (acc?.blueskySession) {
        blueskyClients[did].adoptSession?.(acc.blueskySession);
      }
    }
  });
}

// api()-compatible result for a Bluesky account
export function blueskyApi(account) {
  const client = getBlueskyClient(account);
  return {
    masto: client.masto,
    streaming: undefined,
    client,
    authenticated: isBlueskyLoggedIn(account),
    instance: account.instanceURL,
  };
}

function seedInstanceInfo(instance) {
  const instances = store.local.getJSON('instances') || {};
  instances[instance] = blueskyInstanceInfo(instance);
  store.local.setJSON('instances', instances);
  const nodeInfos = store.local.getJSON('nodeInfos') || {};
  nodeInfos[instance] = {
    software: { name: 'bluesky', version: '1.0.0' },
  };
  store.local.setJSON('nodeInfos', nodeInfos);
}

// Log in with handle + app password, save the account and make it current
export async function loginBluesky({ service, identifier, password }) {
  service = (service || DEFAULT_BLUESKY_SERVICE).trim();
  if (!/^https?:\/\//.test(service)) {
    service = `https://${service}`;
  }
  service = service.replace(/\/+$/, '');
  const instance = new URL(service).host.toLowerCase();

  const { AtpAgent } = await loadAtproto();
  const agent = new AtpAgent({ service });
  await agent.login({
    identifier: identifier.trim().replace(/^@/, ''),
    password: password.trim(),
  });
  const session = agent.session;
  let profile;
  try {
    const res = await agent.getProfile({ actor: session.did });
    profile = res.data;
  } catch (e) {
    profile = { did: session.did, handle: session.handle };
  }

  seedInstanceInfo(instance);

  const accounts = getAccounts();
  const existing = accounts.find((a) => a.info.id === session.did);
  const accountData = {
    info: profileToAccount(profile, instance),
    instanceURL: instance,
    accessToken: session.accessJwt,
    accountType: 'bluesky',
    blueskyService: service,
    blueskySession: {
      did: session.did,
      handle: session.handle,
      accessJwt: session.accessJwt,
      refreshJwt: session.refreshJwt,
      active: session.active !== false,
    },
    vapidKey: null,
  };
  if (existing) {
    Object.assign(existing, accountData, { updatedAt: Date.now() });
    delete existing.authExpired;
  } else {
    accounts.push({ ...accountData, createdAt: Date.now() });
  }
  saveAccounts(accounts);
  setCurrentAccountID(session.did);
  // Invalidate any cached client for this account
  delete blueskyClients[session.did];
  return session.did;
}

// Complete an AT Protocol OAuth callback (or restore the pending flow),
// save the account, and make it current. Returns the DID, or null if
// there was nothing to complete.
export async function completeBlueskyOAuth() {
  const { initBlueskyOAuth } = await import('./oauth');
  const result = await initBlueskyOAuth();
  if (!result?.session) return null;
  const { session } = result;
  const did = session.did || session.sub;

  const { Agent } = await loadAtproto();
  const agent = new Agent(session);
  let profile;
  try {
    const res = await agent.getProfile({ actor: did });
    profile = res.data;
  } catch (e) {
    profile = { did, handle: '' };
  }

  // Best-effort: label the account with its auth server's host
  let instance = 'bsky.social';
  let service = DEFAULT_BLUESKY_SERVICE;
  try {
    const issuer = session.serverMetadata?.issuer;
    if (issuer) {
      instance = new URL(issuer).host.toLowerCase();
      service = issuer.replace(/\/+$/, '');
    }
  } catch (e) {}

  seedInstanceInfo(instance);

  const accounts = getAccounts();
  const existing = accounts.find((a) => a.info.id === did);
  const accountData = {
    info: profileToAccount(profile, instance),
    instanceURL: instance,
    // Marker value: real tokens live in the OAuth client's own store.
    // Must be truthy so "logged out" checks (!account.accessToken) pass.
    accessToken: 'oauth',
    accountType: 'bluesky',
    blueskyAuth: 'oauth',
    blueskyService: service,
    blueskySession: null,
    vapidKey: null,
  };
  if (existing) {
    Object.assign(existing, accountData, { updatedAt: Date.now() });
    delete existing.authExpired;
  } else {
    accounts.push({ ...accountData, createdAt: Date.now() });
  }
  saveAccounts(accounts);
  setCurrentAccountID(did);
  delete blueskyClients[did];
  return did;
}

export function logoutBluesky(accountID) {
  const account = getAccounts().find((a) => a.info.id === accountID);
  if (account?.blueskyAuth === 'oauth') {
    // Fire-and-forget token revocation via the OAuth client
    import('./oauth')
      .then(({ revokeOAuthSession }) => revokeOAuthSession(accountID))
      .catch(() => {});
  }
  delete blueskyClients[accountID];
}

// Sources for the merged home timeline: all logged-in accounts of the
// *other* network than the current account
export function getOtherNetworkAccounts() {
  const currentID = getCurrentAccountID();
  const current = getAccount(currentID);
  if (!current) return [];
  const accounts = getAccounts();
  if (isBlueskyAccount(current)) {
    // Current is Bluesky → other Mastodon-ish accounts
    return accounts.filter((a) => !isBlueskyAccount(a) && a.accessToken);
  }
  // Current is Mastodon → Bluesky accounts
  return accounts.filter(
    (a) => isBlueskyLoggedIn(a) && a.info.id !== currentID,
  );
}

// The home-feed view preferences (hide reposts/replies/quote posts) from
// the first logged-in Bluesky account — one preference set governs the
// whole home timeline, both networks
export async function getHomeFeedViewPrefs() {
  const account = getBlueskyAccounts()[0];
  if (!account) return {};
  try {
    return await blueskyApi(account).client.getFeedViewPrefs();
  } catch (e) {
    console.error(e);
    return {};
  }
}
