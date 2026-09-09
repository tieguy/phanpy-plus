// Self-repair for a stale cached app shell (service worker only).
//
// The failure this recovers from:
//
// 1. The `pages` cache is NetworkFirst with a short network timeout, so a slow
//    navigation is answered with a cached `index.html` — the app shell.
// 2. The host serves only the newest deploy, so a hashed bundle referenced by
//    an older shell returns 404, with the content type `text/html`.
// 3. A browser rejects a `type="module"` script that arrives as `text/html`,
//    and does so silently. `<div id="app">` stays empty: a blank page, which on
//    an installed home-screen web app reads as an indefinite hang.
//
// Nothing on the page can repair this, because the page's own JavaScript is
// exactly what failed to load — and the strict CSP forbids an inline bootstrap
// script. So the repair lives here, in the worker that served the stale shell.
//
// The repair is: drop the `pages` cache and reload the window clients. The next
// navigation misses the cache, reaches the network, and gets an `index.html`
// that names bundles the server still has.

// The cache that pageCache() writes the app shell into (workbox's default).
export const PAGES_CACHE_NAME = 'pages';

// Where the last repair's timestamp is kept. A service worker has no
// localStorage, and it can be terminated between events, so the loop guard has
// to survive in storage the worker can reach: the Cache API.
export const REPAIR_MARKER_CACHE_NAME = 'sw-shell-repair';
export const REPAIR_MARKER_KEY = '/__sw-shell-repair';

// Two repairs closer together than this are treated as a loop, and the second
// one is refused. A repair triggers a reload, so an unguarded repair that does
// not fix the page would reload forever.
export const REPAIR_COOLDOWN_MS = 60 * 1000;

// Whether a response proves the requested bundle is gone from the server.
//
// Only a definite "this file does not exist" counts. A network error must NOT,
// because being offline is the case the cache exists to serve: deleting the app
// shell every time a request fails would break offline use entirely.
export function isMissingBundleResponse(response) {
  const status = response?.status;
  return status === 404 || status === 410;
}

// Whether to run a repair now.
export function shouldRepairStaleShell({
  hasCachedShell,
  lastRepairAt,
  now,
  cooldownMs = REPAIR_COOLDOWN_MS,
}) {
  // No cached shell means no stale shell to blame. The 404 has some other
  // cause, and deleting an empty cache and reloading would not help.
  if (!hasCachedShell) return false;
  if (typeof lastRepairAt !== 'number' || Number.isNaN(lastRepairAt)) {
    return true;
  }
  return now - lastRepairAt >= cooldownMs;
}

export async function readLastRepairAt(caches) {
  try {
    if (!(await caches.has(REPAIR_MARKER_CACHE_NAME))) return null;
    const cache = await caches.open(REPAIR_MARKER_CACHE_NAME);
    const response = await cache.match(REPAIR_MARKER_KEY);
    if (!response) return null;
    const timestamp = Number(await response.text());
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch (e) {
    // A cache read must never be the reason the repair does not run; treat an
    // unreadable marker as "no repair recorded".
    return null;
  }
}

export async function writeLastRepairAt(caches, timestamp) {
  try {
    const cache = await caches.open(REPAIR_MARKER_CACHE_NAME);
    await cache.put(REPAIR_MARKER_KEY, new Response(String(timestamp)));
  } catch (e) {
    // Ignore: failing to record the marker only weakens the loop guard.
  }
}

async function hasCachedShell(caches) {
  if (!(await caches.has(PAGES_CACHE_NAME))) return false;
  const cache = await caches.open(PAGES_CACHE_NAME);
  const keys = await cache.keys();
  return keys.length > 0;
}

// Delete the stale app shell and reload the window clients.
//
// `caches` and `clients` are passed in rather than read off the global scope so
// this can be tested outside a service worker. Returns whether a repair ran.
export async function repairStaleShell({
  caches,
  clients,
  now = Date.now(),
  cooldownMs = REPAIR_COOLDOWN_MS,
}) {
  const shellCached = await hasCachedShell(caches);
  const lastRepairAt = await readLastRepairAt(caches);
  if (
    !shouldRepairStaleShell({
      hasCachedShell: shellCached,
      lastRepairAt,
      now,
      cooldownMs,
    })
  ) {
    return false;
  }

  // Record the repair before reloading. The reload can terminate this worker,
  // and a marker written after the reload might never be written at all —
  // which would leave the loop guard disarmed.
  await writeLastRepairAt(caches, now);
  await caches.delete(PAGES_CACHE_NAME);

  const windowClients = await clients.matchAll({ type: 'window' });
  for (const client of windowClients) {
    // navigate() is the only way to reload a page whose own scripts never ran.
    client.navigate?.(client.url);
  }
  return true;
}
