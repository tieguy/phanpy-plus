// Starts Mastodon OAuth for one server: registers the app if needed, then
// opens the authorization page in a popup, or redirects when the popup is
// blocked. The code comes back to the app root, where app.jsx exchanges it
// and then opens `loginRedirect` from session storage, if set.

import {
  getAuthorizationURL,
  getPKCEAuthorizationURL,
  registerApplication,
} from './auth';
import { openAuthPopup, watchAuthPopup } from './auth-popup';
import { supportsPKCE } from './oauth-pkce';
import store from './store';
import {
  getCredentialApplication,
  hasAccountInInstance,
  storeCredentialApplication,
} from './store-utils';

// WEB_DOMAIN vs LOCAL_DOMAIN negotiation
// https://docs.joinmastodon.org/admin/config/#web_domain
async function resolveHost(instanceURL) {
  try {
    const res = await fetch(`https://${instanceURL}/.well-known/host-meta`); // returns XML
    const text = await res.text();
    const xmlDoc = new DOMParser().parseFromString(text, 'text/xml');
    const template = xmlDoc
      .getElementsByTagName('Link')[0]
      .getAttribute('template');
    const { host } = URL.parse(template); // host includes the port
    if (instanceURL !== host) {
      console.log(`💫 ${instanceURL} -> ${host}`);
      return host;
    }
  } catch (e) {
    // Silently fail
    console.error(e);
  }
  return instanceURL;
}

// Resolves once the authorization page is open. Throws when the app cannot
// be registered. `onError` is called if the popup reports a failure later.
export async function startMastodonLogin(
  instanceURL,
  { redirectPath, onError } = {},
) {
  instanceURL = await resolveHost(instanceURL);
  store.local.set('instanceURL', instanceURL);
  if (redirectPath) store.session.set('loginRedirect', redirectPath);

  let credentialApplication = getCredentialApplication(instanceURL);
  if (
    !credentialApplication ||
    !credentialApplication.client_id ||
    !credentialApplication.client_secret
  ) {
    credentialApplication = await registerApplication({ instanceURL });
    storeCredentialApplication(instanceURL, credentialApplication);
  }
  const { client_id, client_secret } = credentialApplication;
  if (!client_id || !client_secret) {
    throw new Error('Failed to register application');
  }

  const authPKCE = await supportsPKCE({ instanceURL });
  console.log({ authPKCE });
  const forceLogin = hasAccountInInstance(instanceURL);

  let authUrl;
  if (authPKCE && window.isSecureContext) {
    const [url, verifier] = await getPKCEAuthorizationURL({
      instanceURL,
      client_id,
      forceLogin,
    });
    store.sessionCookie.set('codeVerifier', verifier);
    authUrl = url;
  } else {
    authUrl = await getAuthorizationURL({ instanceURL, client_id, forceLogin });
  }

  const popup = openAuthPopup(authUrl);
  if (popup) {
    watchAuthPopup(
      popup,
      (code) => {
        window.location.href = `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
      },
      (error) => {
        console.error('Popup auth error:', error);
        onError?.(error);
      },
    );
  } else {
    // Popup blocked, fallback to redirect
    console.log('Popup blocked, falling back to redirect');
    location.href = authUrl;
  }
}
