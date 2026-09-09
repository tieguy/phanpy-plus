// Browser verification for the service worker's stale-app-shell recovery.
//
// The failure it reproduces lives in service worker state, so unit tests cannot
// reach it: a cached index.html from an older deploy asks for a hashed bundle
// the server no longer has. This drives the real built worker through that
// sequence against a static server whose behavior it flips between phases.
//
//   npm run build && node scripts/verify-sw-recovery.mjs
//
// Not part of `npm test` — it needs a production build and takes ~40s. Run it
// after any change to public/sw.js or src/utils/sw-shell-recovery.js.
//
// Both failure modes it guards against have been confirmed by reverting the
// fix: without the recovery, phase 3 leaves the page blank; without the
// cache-miss guard, phase 2 reloads a page that was working fine.
//
// Chromium, not WebKit — WebKit needs Debian-soname libraries that a Fedora
// atomic host does not ship.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = 5199;
const ORIGIN = `http://localhost:${PORT}`;

// The bundle name the "old deploy" shell asks for. It exists while we prime the
// cache, then disappears — exactly what a host that serves only the newest
// deploy does to an older deploy's assets.
const STALE_MAIN = 'main-STALE001.js';

const realIndex = readFileSync(join(DIST, 'index.html'), 'utf8');
// The build's hash changes run to run, so read it out of the shell we serve.
const REAL_MAIN = realIndex.match(/main-[A-Za-z0-9_-]+\.js/)?.[0];
if (!REAL_MAIN) throw new Error('no main bundle found in dist/index.html');
console.log(`(entry bundle: ${REAL_MAIN})`);
const staleIndex = realIndex.replaceAll(REAL_MAIN, STALE_MAIN);
const realMainJs = readFileSync(join(DIST, 'assets', REAL_MAIN));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// Server state, flipped between phases.
const server = {
  serveStaleShell: true, // `/` returns the old deploy's index.html
  staleBundleExists: true, // the old bundle is still on the server
  navDelayMs: 0, // slow the navigation so NetworkFirst falls back to cache
};

const requests = [];

const http = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const path = url.pathname;
  requests.push(path);

  if (path === '/' || path === '/index.html') {
    if (server.navDelayMs) {
      await new Promise((r) => setTimeout(r, server.navDelayMs));
    }
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    res.end(server.serveStaleShell ? staleIndex : realIndex);
    return;
  }

  if (path === `/assets/${STALE_MAIN}`) {
    if (!server.staleBundleExists) {
      // How Netlify and Cloudflare Pages answer for an absent asset: 404 with
      // an HTML content type, which is what silently kills a module script.
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      res.end('<!doctype html><title>Not Found</title>');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES['.js'] });
    res.end(realMainJs);
    return;
  }

  try {
    const body = readFileSync(join(DIST, path.slice(1)));
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] || 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    res.end('<!doctype html><title>Not Found</title>');
  }
});

const check = (label, ok, detail = '') => {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) process.exitCode = 1;
};

const swState = (page) =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      active: !!reg?.active,
      waiting: !!reg?.waiting,
      caches: await caches.keys(),
      pages: (await caches.has('pages'))
        ? (await (await caches.open('pages')).keys()).map((r) => r.url)
        : null,
    };
  });

const appRendered = (page) =>
  page.evaluate(
    () => (document.querySelector('#app')?.childElementCount ?? 0) > 0,
  );

async function main() {
  await new Promise((r) => http.listen(PORT, r));
  const browser = await chromium.launch();

  try {
    // ---- Phase 1: prime. The old deploy is current; everything works. -------
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(ORIGIN, { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Let pageCache warm and the assets route fill.
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);

    let state = await swState(page);
    check('phase 1: service worker is active', state.active);
    check(
      'phase 1: the old shell is in the pages cache',
      !!state.pages?.length,
      `pages: ${JSON.stringify(state.pages)}`,
    );
    check('phase 1: the app renders', await appRendered(page));

    // ---- Phase 2: the guard. Bundle 404s but is still cached. --------------
    // A new deploy has landed, so the old bundle is gone from the server — but
    // maxHashes still holds it locally. The page must keep working and must NOT
    // be reloaded out from under the user.
    server.staleBundleExists = false;
    const navsBefore = requests.filter((p) => p === '/').length;
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(3000);

    check(
      'phase 2: a cached bundle keeps the page working despite the 404',
      await appRendered(page),
    );
    // The discriminating assertion: count navigations. Checking that the pages
    // cache is non-empty proves nothing, because a repair-triggered reload
    // refills it immediately. Only the reload this script asked for should
    // appear here — a second one means the worker interrupted a working page.
    const navs2 = requests.filter((p) => p === '/').length - navsBefore;
    check(
      'phase 2: no repair — the page was not reloaded underneath the user',
      navs2 === 1,
      `${navs2} navigation(s); >1 would discard an in-progress compose draft`,
    );
    await ctx.close();

    // ---- Phase 3: the failure. Bundle gone from server AND from cache. -----
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    server.staleBundleExists = true;
    server.serveStaleShell = true;
    server.navDelayMs = 0;
    await page2.goto(ORIGIN, { waitUntil: 'load' });
    await page2.evaluate(() => navigator.serviceWorker.ready);
    await page2.waitForTimeout(2500);
    await page2.reload({ waitUntil: 'load' });
    await page2.waitForTimeout(1500);
    check(
      'phase 3 setup: old shell cached',
      !!(await swState(page2)).pages?.length,
    );

    // The new deploy lands. The old bundle leaves the server, and maxHashes
    // eviction drops it from the local cache too.
    server.staleBundleExists = false;
    server.serveStaleShell = false;
    await page2.evaluate(() => caches.delete('assets'));
    // Navigation now takes longer than the 6s NetworkFirst timeout, so the
    // worker answers from cache with the stale shell — the failure's trigger.
    server.navDelayMs = 8000;

    const navsBefore3 = requests.filter((p) => p === '/').length;
    await page2.goto(ORIGIN).catch(() => {});
    // Allow: cache fallback → 404 → repair → navigate → slow network fetch.
    await page2.waitForTimeout(20000);

    const after = await swState(page2);
    const navs = requests.filter((p) => p === '/').length - navsBefore3;
    const stale404s = requests.filter(
      (p) => p === `/assets/${STALE_MAIN}`,
    ).length;

    check(
      'phase 3: the stale bundle was requested and 404d',
      stale404s > 0,
      `${stale404s} request(s) for the missing bundle`,
    );
    check(
      'phase 3: the repair re-navigated the client',
      navs >= 2,
      `${navs} navigations after the stale shell was served`,
    );
    check(
      'phase 3: the page recovered and rendered',
      await appRendered(page2),
      `pages cache now: ${JSON.stringify(after.pages)}`,
    );

    await ctx2.close();
  } finally {
    await browser.close();
    http.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  http.close();
});
