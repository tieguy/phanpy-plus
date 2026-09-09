import { describe, expect, it } from 'vitest';

import {
  isMissingBundleResponse,
  PAGES_CACHE_NAME,
  readLastRepairAt,
  REPAIR_COOLDOWN_MS,
  REPAIR_MARKER_CACHE_NAME,
  repairStaleShell,
  shouldRepairStaleShell,
} from './sw-shell-recovery';

// A minimal stand-in for the Cache API. Real CacheStorage is unavailable in
// jsdom/node, and the repair's whole job is manipulating it.
function fakeCaches(initial = {}) {
  const store = new Map(
    Object.entries(initial).map(([name, entries]) => [
      name,
      new Map(Object.entries(entries)),
    ]),
  );
  return {
    store,
    has: async (name) => store.has(name),
    open: async (name) => {
      if (!store.has(name)) store.set(name, new Map());
      const entries = store.get(name);
      return {
        keys: async () => [...entries.keys()],
        match: async (key) => entries.get(key),
        put: async (key, response) => void entries.set(key, response),
      };
    },
    delete: async (name) => store.delete(name),
  };
}

function fakeClients(urls = []) {
  const navigated = [];
  return {
    navigated,
    matchAll: async () =>
      urls.map((url) => ({
        url,
        navigate: (to) => void navigated.push(to),
      })),
  };
}

const SHELL = { [PAGES_CACHE_NAME]: { 'https://example.test/': 'html' } };

describe('isMissingBundleResponse', () => {
  it('treats 404 and 410 as proof the bundle is gone from the server', () => {
    expect(isMissingBundleResponse({ status: 404 })).toBe(true);
    expect(isMissingBundleResponse({ status: 410 })).toBe(true);
  });

  it('does not treat a successful response as missing', () => {
    expect(isMissingBundleResponse({ status: 200 })).toBe(false);
    expect(isMissingBundleResponse({ status: 304 })).toBe(false);
  });

  it('does not treat a server error as missing', () => {
    // A 500 or 503 is transient. Deleting the app shell would turn a passing
    // outage into a reload during that outage.
    expect(isMissingBundleResponse({ status: 500 })).toBe(false);
    expect(isMissingBundleResponse({ status: 503 })).toBe(false);
  });

  it('does not treat an absent response (network failure) as missing', () => {
    // This is the offline case: the cache exists precisely to serve it.
    expect(isMissingBundleResponse(undefined)).toBe(false);
    expect(isMissingBundleResponse(null)).toBe(false);
  });
});

describe('shouldRepairStaleShell', () => {
  it('repairs when a shell is cached and nothing was repaired before', () => {
    expect(
      shouldRepairStaleShell({
        hasCachedShell: true,
        lastRepairAt: null,
        now: 1000,
      }),
    ).toBe(true);
  });

  it('refuses when the bundle was served from cache, so the page is fine', () => {
    // StaleWhileRevalidate served a cached copy and only the background
    // revalidation saw the 404. Reloading here would interrupt a working page
    // and discard an in-progress compose draft.
    expect(
      shouldRepairStaleShell({
        hasCachedShell: true,
        assetServedFromCache: true,
        lastRepairAt: null,
        now: 1000,
      }),
    ).toBe(false);
  });

  it('refuses when no shell is cached, so the 404 has another cause', () => {
    expect(
      shouldRepairStaleShell({
        hasCachedShell: false,
        lastRepairAt: null,
        now: 1000,
      }),
    ).toBe(false);
  });

  it('refuses a second repair inside the cooldown, breaking a reload loop', () => {
    expect(
      shouldRepairStaleShell({
        hasCachedShell: true,
        lastRepairAt: 1000,
        now: 1000 + REPAIR_COOLDOWN_MS - 1,
      }),
    ).toBe(false);
  });

  it('allows another repair once the cooldown has elapsed', () => {
    expect(
      shouldRepairStaleShell({
        hasCachedShell: true,
        lastRepairAt: 1000,
        now: 1000 + REPAIR_COOLDOWN_MS,
      }),
    ).toBe(true);
  });

  it('repairs when the stored marker is unusable', () => {
    expect(
      shouldRepairStaleShell({
        hasCachedShell: true,
        lastRepairAt: Number.NaN,
        now: 1000,
      }),
    ).toBe(true);
  });
});

describe('repairStaleShell', () => {
  it('deletes the pages cache and reloads every window client', async () => {
    const caches = fakeCaches(SHELL);
    const clients = fakeClients([
      'https://example.test/',
      'https://example.test/#/x',
    ]);

    expect(await repairStaleShell({ caches, clients, now: 5000 })).toBe(true);
    expect(caches.store.has(PAGES_CACHE_NAME)).toBe(false);
    expect(clients.navigated).toEqual([
      'https://example.test/',
      'https://example.test/#/x',
    ]);
  });

  it('records the repair timestamp so a later call is guarded', async () => {
    const caches = fakeCaches(SHELL);

    await repairStaleShell({ caches, clients: fakeClients(['/']), now: 5000 });
    expect(await readLastRepairAt(caches)).toBe(5000);
  });

  it('does nothing when no app shell is cached', async () => {
    const caches = fakeCaches({});
    const clients = fakeClients(['https://example.test/']);

    expect(await repairStaleShell({ caches, clients, now: 5000 })).toBe(false);
    expect(clients.navigated).toEqual([]);
    expect(caches.store.has(REPAIR_MARKER_CACHE_NAME)).toBe(false);
  });

  it('refuses a repeat repair inside the cooldown', async () => {
    const caches = fakeCaches(SHELL);
    const first = fakeClients(['https://example.test/']);
    expect(await repairStaleShell({ caches, clients: first, now: 5000 })).toBe(
      true,
    );

    // The reload re-populates the shell cache, and the bundle 404s again.
    (await caches.open(PAGES_CACHE_NAME)).put('https://example.test/', 'html');
    const second = fakeClients(['https://example.test/']);
    expect(
      await repairStaleShell({
        caches,
        clients: second,
        now: 5000 + REPAIR_COOLDOWN_MS - 1,
      }),
    ).toBe(false);
    expect(second.navigated).toEqual([]);
    expect(caches.store.has(PAGES_CACHE_NAME)).toBe(true);
  });

  it('does not reload when the bundle came from cache', async () => {
    const caches = fakeCaches(SHELL);
    const clients = fakeClients(['https://example.test/']);

    expect(
      await repairStaleShell({
        caches,
        clients,
        assetServedFromCache: true,
        now: 5000,
      }),
    ).toBe(false);
    expect(clients.navigated).toEqual([]);
    expect(caches.store.has(PAGES_CACHE_NAME)).toBe(true);
  });

  it('survives a client that cannot be navigated', async () => {
    const caches = fakeCaches(SHELL);
    const clients = {
      matchAll: async () => [{ url: 'https://example.test/' }],
    };

    expect(await repairStaleShell({ caches, clients, now: 5000 })).toBe(true);
    expect(caches.store.has(PAGES_CACHE_NAME)).toBe(false);
  });
});

describe('readLastRepairAt', () => {
  it('returns null when no repair has been recorded', async () => {
    expect(await readLastRepairAt(fakeCaches({}))).toBe(null);
  });

  it('returns null when the stored marker is not a number', async () => {
    const caches = fakeCaches({
      [REPAIR_MARKER_CACHE_NAME]: {
        '/__sw-shell-repair': { text: async () => 'not-a-number' },
      },
    });
    expect(await readLastRepairAt(caches)).toBe(null);
  });
});
