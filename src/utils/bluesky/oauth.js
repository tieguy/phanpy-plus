// AT Protocol OAuth for Bluesky accounts, via @atproto/oauth-client-browser.
//
// - On localhost, a "loopback" client is used (no hosted metadata needed).
// - On a real domain, the authorization server fetches
//   `${origin}/oauth/client-metadata.json`, which is generated at build
//   time (see vite.config.js) and must match the metadata built here.
//
// Tokens are stored and auto-refreshed by the OAuth client itself
// (IndexedDB), so unlike app-password sessions nothing secret is kept in
// the accounts store — only the DID.

// `transition:chat.bsky` grants access to the Bluesky chat (DM) service.
// Changing this scope changes the hosted client metadata, so existing OAuth
// sessions must re-consent before DMs work.
export const BLUESKY_OAUTH_SCOPE =
  'atproto transition:generic transition:chat.bsky';

export function buildClientMetadata(origin) {
  return {
    client_id: `${origin}/oauth/client-metadata.json`,
    client_name: 'Fleeting',
    client_uri: origin,
    redirect_uris: [`${origin}/`],
    scope: BLUESKY_OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  };
}

function isLoopbackHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

// Session events from the OAuth client. Both are also relayed from other
// tabs/windows over the library's BroadcastChannel.
//
// `deleted` is NOT proof that the stored session is gone. The library emits
// it whenever it cannot *read* a stored session — its IndexedDB wrapper keeps
// one connection for the page's lifetime and treats it as closed for good
// once the browser closes it (iPadOS does this to suspended pages), after
// which every read fails, is swallowed as "no session", and is reported as
// "deleted by another process" while the tokens sit intact on disk. It is also
// relayed from another tab that hit the same read failure. Treat it as
// "re-check the session", never as "the session is dead" (see client.js).
//
// `updated` fires on every successful token refresh or (re)store — proof the
// session works.
const sessionDeletedCallbacks = new Set();
const sessionUpdatedCallbacks = new Set();
export function onOAuthSessionDeleted(cb) {
  sessionDeletedCallbacks.add(cb);
  return () => sessionDeletedCallbacks.delete(cb);
}
export function onOAuthSessionUpdated(cb) {
  sessionUpdatedCallbacks.add(cb);
  return () => sessionUpdatedCallbacks.delete(cb);
}
function emit(callbacks, ...args) {
  for (const cb of callbacks) {
    try {
      cb(...args);
    } catch (e) {
      console.error(e);
    }
  }
}

let clientPromise;
export function getOAuthClient() {
  return (clientPromise ||= (async () => {
    const { BrowserOAuthClient } =
      await import('@atproto/oauth-client-browser');
    const loopback = isLoopbackHost(location.hostname);
    return new BrowserOAuthClient({
      handleResolver: 'https://bsky.social',
      responseMode: 'query',
      clientMetadata: loopback
        ? undefined
        : buildClientMetadata(location.origin),
      onDelete: (sub, cause) => emit(sessionDeletedCallbacks, sub, cause),
      onUpdate: (sub) => emit(sessionUpdatedCallbacks, sub),
    });
  })());
}

// Discard the OAuth client so the next getOAuthClient() builds a fresh one,
// with a fresh IndexedDB connection. The only recovery from the closed
// connection described above; the session store itself is untouched, and the
// callbacks registered here survive.
export async function resetOAuthClient() {
  const pending = clientPromise;
  clientPromise = null;
  if (!pending) return;
  try {
    const client = await pending;
    await client.dispose?.();
  } catch (e) {
    // The old client is being thrown away anyway
  }
}

// Returns true if the current URL looks like an AT Protocol OAuth callback
export function isBlueskyOAuthCallback(search = location.search) {
  const params = new URLSearchParams(search);
  return params.has('iss') && params.has('state') && params.has('code');
}

// Process the OAuth callback (or restore the last session).
// Returns { session } or undefined.
export async function initBlueskyOAuth() {
  const client = await getOAuthClient();
  return await client.init();
}

export async function restoreOAuthSession(did) {
  const client = await getOAuthClient();
  return await client.restore(did);
}

// Redirects to the account's PDS for authorization; never resolves
// (the page navigates away)
export async function signInBlueskyOAuth(handle) {
  const client = await getOAuthClient();
  await client.signIn(handle.trim().replace(/^@/, ''));
}

export async function revokeOAuthSession(did) {
  try {
    const client = await getOAuthClient();
    await client.revoke(did);
  } catch (e) {
    console.error(e);
  }
}
