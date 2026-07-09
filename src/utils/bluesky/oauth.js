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

export const BLUESKY_OAUTH_SCOPE = 'atproto transition:generic';

export function buildClientMetadata(origin) {
  return {
    client_id: `${origin}/oauth/client-metadata.json`,
    client_name: 'Phanpy+',
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

let clientPromise;
export function getOAuthClient() {
  return (clientPromise ||= (async () => {
    const { BrowserOAuthClient } =
      await import('@atproto/oauth-client-browser');
    const loopback = isLoopbackHost(location.hostname);
    return new BrowserOAuthClient({
      handleResolver: 'https://bsky.social',
      responseMode: 'query',
      // undefined → loopback client (dev only); real domains use the
      // hosted client metadata document
      clientMetadata: loopback
        ? undefined
        : buildClientMetadata(location.origin),
    });
  })());
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
