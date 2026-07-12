import './login.css';

import { Trans, useLingui } from '@lingui/react/macro';
import Fuse from 'fuse.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useSearchParams } from 'react-router-dom';

import logo from '../assets/logo.svg';

import Icon from '../components/icon';
import LangSelector from '../components/lang-selector';
import Link from '../components/link';
import Loader from '../components/loader';
import instancesListURL from '../data/instances.json?url';
import {
  getAuthorizationURL,
  getPKCEAuthorizationURL,
  registerApplication,
} from '../utils/auth';
import { openAuthPopup, watchAuthPopup } from '../utils/auth-popup';
import { DEFAULT_BLUESKY_SERVICE, loginBluesky } from '../utils/bluesky';
import { signInBlueskyOAuth } from '../utils/bluesky/oauth';
import { supportsPKCE } from '../utils/oauth-pkce';
import store from '../utils/store';
import {
  getCredentialApplication,
  hasAccountInInstance,
  storeCredentialApplication,
} from '../utils/store-utils';
import useTitle from '../utils/useTitle';

const { FLEETING_DEFAULT_INSTANCE: DEFAULT_INSTANCE } = import.meta.env;

function Login() {
  const { t } = useLingui();
  useTitle(t`Log in`, '/login');
  const instanceURLRef = useRef();
  const cachedInstanceURL = store.local.get('instanceURL');
  const [uiState, setUIState] = useState('default');
  const [searchParams] = useSearchParams();
  const instance = searchParams.get('instance');
  const submit = searchParams.get('submit');
  const [instanceText, setInstanceText] = useState(
    instance || cachedInstanceURL?.toLowerCase() || '',
  );

  const [showBluesky, setShowBluesky] = useState(
    searchParams.get('network') === 'bluesky',
  );
  const [bskyUIState, setBskyUIState] = useState('default');
  const [bskyError, setBskyError] = useState(null);

  // Deep-linked from the landing page's "Log in with Bluesky" peer.
  useEffect(() => {
    if (searchParams.get('network') === 'bluesky') {
      document
        .getElementById('bluesky-login')
        ?.scrollIntoView({ block: 'center' });
    }
  }, []);

  const [instancesList, setInstancesList] = useState([]);
  const searcher = useRef();
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(instancesListURL);
        const data = await res.json();
        setInstancesList(data);
        searcher.current = new Fuse(data);
      } catch (e) {
        // Silently fail
        console.error(e);
      }
    })();
  }, []);

  // useEffect(() => {
  //   if (cachedInstanceURL) {
  //     instanceURLRef.current.value = cachedInstanceURL.toLowerCase();
  //   }
  // }, []);

  const submitInstance = (instanceURL) => {
    if (!instanceURL) return;

    (async () => {
      // WEB_DOMAIN vs LOCAL_DOMAIN negotiation time
      // https://docs.joinmastodon.org/admin/config/#web_domain
      try {
        const res = await fetch(`https://${instanceURL}/.well-known/host-meta`); // returns XML
        const text = await res.text();
        // Parse XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');
        // Get Link[template]
        const link = xmlDoc.getElementsByTagName('Link')[0];
        const template = link.getAttribute('template');
        const url = URL.parse(template);
        const { host } = url; // host includes the port
        if (instanceURL !== host) {
          console.log(`💫 ${instanceURL} -> ${host}`);
          instanceURL = host;
        }
      } catch (e) {
        // Silently fail
        console.error(e);
      }

      store.local.set('instanceURL', instanceURL);

      setUIState('loading');
      try {
        let credentialApplication = getCredentialApplication(instanceURL);
        if (
          !credentialApplication ||
          !credentialApplication.client_id ||
          !credentialApplication.client_secret
        ) {
          credentialApplication = await registerApplication({
            instanceURL,
          });
          storeCredentialApplication(instanceURL, credentialApplication);
        }

        const { client_id, client_secret } = credentialApplication;

        const authPKCE = await supportsPKCE({ instanceURL });
        console.log({ authPKCE });
        const forceLogin = hasAccountInInstance(instanceURL);

        let authUrl;
        if (authPKCE && window.isSecureContext) {
          if (client_id && client_secret) {
            const [url, verifier] = await getPKCEAuthorizationURL({
              instanceURL,
              client_id,
              forceLogin,
            });
            store.sessionCookie.set('codeVerifier', verifier);
            authUrl = url;
          } else {
            alert(t`Failed to register application`);
            setUIState('default');
            return;
          }
        } else {
          if (client_id && client_secret) {
            authUrl = await getAuthorizationURL({
              instanceURL,
              client_id,
              forceLogin,
            });
          } else {
            alert(t`Failed to register application`);
            setUIState('default');
            return;
          }
        }

        const popup = openAuthPopup(authUrl);

        if (popup) {
          watchAuthPopup(
            popup,
            (code) => {
              const callbackUrl = `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
              window.location.href = callbackUrl;
            },
            (error) => {
              console.error('Popup auth error:', error);
              setUIState('error');
            },
          );
        } else {
          // Popup blocked, fallback to redirect
          console.log('Popup blocked, falling back to redirect');
          location.href = authUrl;
        }

        setUIState('default');
      } catch (e) {
        console.error(e);
        setUIState('error');
      }
    })();
  };

  const cleanInstanceText = instanceText
    ? instanceText
        .replace(/^https?:\/\//, '') // Remove protocol from instance URL
        .replace(/\/+$/, '') // Remove trailing slash
        .replace(/^@?[^@]+@/, '') // Remove @?acct@
        .trim()
    : null;
  const instanceTextLooksLikeDomain =
    /[^\s\r\n\t\/\\]+\.[^\s\r\n\t\/\\]+/.test(cleanInstanceText) &&
    !/[\s\/\\@]/.test(cleanInstanceText);

  const instancesSuggestions = cleanInstanceText
    ? searcher.current
        ?.search(cleanInstanceText, {
          limit: 10,
        })
        ?.map((match) => match.item)
    : [];

  const selectedInstanceText = instanceTextLooksLikeDomain
    ? cleanInstanceText
    : instancesSuggestions?.length
      ? instancesSuggestions[0]
      : instanceText
        ? instancesList.find((instance) => instance.includes(instanceText))
        : null;

  // Primary: AT Protocol OAuth — redirects to the account's PDS
  const onBlueskyOAuthSubmit = (e) => {
    e.preventDefault();
    const { elements } = e.target;
    const identifier = elements.bskyIdentifier.value?.trim();
    if (!identifier) return;
    setBskyError(null);
    setBskyUIState('loading');
    (async () => {
      try {
        await signInBlueskyOAuth(identifier);
        // Unreachable: the browser navigates away on success
      } catch (err) {
        console.error(err);
        setBskyError(err?.message || `${err}`);
        setBskyUIState('error');
      }
    })();
  };

  // Fallback: app password
  const onBlueskyPasswordSubmit = (e) => {
    e.preventDefault();
    const { elements } = e.target;
    const identifier = elements.bskyPwIdentifier.value;
    const password = elements.bskyPassword.value;
    const service = elements.bskyService?.value || DEFAULT_BLUESKY_SERVICE;
    if (!identifier || !password) return;
    setBskyError(null);
    setBskyUIState('loading');
    (async () => {
      try {
        await loginBluesky({ service, identifier, password });
        // Hard reload so the app bootstraps with the new current account
        location.hash = '/';
        location.reload();
      } catch (err) {
        console.error(err);
        setBskyError(err?.message || `${err}`);
        setBskyUIState('error');
      }
    })();
  };

  const onSubmit = (e) => {
    e.preventDefault();
    // const { elements } = e.target;
    // let instanceURL = elements.instanceURL.value.toLowerCase();
    // // Remove protocol from instance URL
    // instanceURL = instanceURL.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    // // Remove @acct@ or acct@ from instance URL
    // instanceURL = instanceURL.replace(/^@?[^@]+@/, '');
    // if (!/\./.test(instanceURL)) {
    //   instanceURL = instancesList.find((instance) =>
    //     instance.includes(instanceURL),
    //   );
    // }
    // submitInstance(instanceURL);
    submitInstance(selectedInstanceText);
  };

  if (submit) {
    useEffect(() => {
      submitInstance(instance || selectedInstanceText);
    }, []);
  }

  return (
    <main id="login" style={{ textAlign: 'center' }}>
      <form onSubmit={onSubmit}>
        <h1>
          <img src={logo} alt="" width="80" height="80" />
          <br />
          <Trans>Log in</Trans>
        </h1>
        <label>
          <p>
            <Trans>Server</Trans>
          </p>
          <input
            value={instanceText}
            required
            type="text"
            class="large"
            id="instanceURL"
            ref={instanceURLRef}
            disabled={uiState === 'loading'}
            // list="instances-list"
            autocorrect="off"
            autocapitalize="off"
            autocomplete="off"
            spellCheck={false}
            placeholder={t`server domain`}
            enterKeyHint="go"
            onInput={(e) => {
              setInstanceText(e.target.value);
            }}
            dir="auto"
          />
          {instancesSuggestions?.length > 0 ? (
            <ul id="instances-suggestions">
              {instancesSuggestions.map((instance, i) => (
                <li>
                  <button
                    type="button"
                    class="plain5"
                    onClick={() => {
                      submitInstance(instance);
                    }}
                  >
                    {instance}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div id="instances-eg">
              <Trans>e.g. &ldquo;mastodon.social&rdquo;</Trans>
            </div>
          )}
          {/* <datalist id="instances-list">
            {instancesList.map((instance) => (
              <option value={instance} />
            ))}
          </datalist> */}
        </label>
        {uiState === 'error' && (
          <p class="error">
            <Trans>
              Failed to log in. Please try again or try another server.
            </Trans>
          </p>
        )}
        <div>
          <button
            disabled={
              uiState === 'loading' || !instanceText || !selectedInstanceText
            }
          >
            {selectedInstanceText
              ? t`Continue with ${selectedInstanceText}`
              : t`Continue`}
          </button>{' '}
        </div>
        <Loader hidden={uiState !== 'loading'} />
      </form>
      <hr />
      <div id="bluesky-login">
        {showBluesky ? (
          <>
            <form onSubmit={onBlueskyOAuthSubmit}>
              <h2>
                <Icon icon="bluesky" alt="" /> Bluesky
              </h2>
              <label>
                <p>
                  <Trans>Handle</Trans>
                </p>
                <input
                  type="text"
                  class="large"
                  name="bskyIdentifier"
                  required
                  autocorrect="off"
                  autocapitalize="off"
                  autocomplete="username"
                  spellCheck={false}
                  placeholder="you.bsky.social"
                  disabled={bskyUIState === 'loading'}
                  dir="auto"
                />
              </label>
              {bskyUIState === 'error' && (
                <p class="error">
                  <Trans>Failed to log in to Bluesky.</Trans> {bskyError}
                </p>
              )}
              <div>
                <button disabled={bskyUIState === 'loading'}>
                  <Trans>Continue with Bluesky</Trans>
                </button>
              </div>
              <p style={{ fontSize: '90%' }}>
                <Trans>
                  You'll be sent to your Bluesky server to authorize this app.
                </Trans>
              </p>
              <Loader hidden={bskyUIState !== 'loading'} />
            </form>
            <details class="bluesky-app-password">
              <summary style={{ cursor: 'pointer', fontSize: '90%' }}>
                <Trans>Use an app password instead</Trans>
              </summary>
              <form onSubmit={onBlueskyPasswordSubmit}>
                <label>
                  <p>
                    <Trans>Handle</Trans>
                  </p>
                  <input
                    type="text"
                    class="large"
                    name="bskyPwIdentifier"
                    required
                    autocorrect="off"
                    autocapitalize="off"
                    autocomplete="username"
                    spellCheck={false}
                    placeholder="you.bsky.social"
                    disabled={bskyUIState === 'loading'}
                    dir="auto"
                  />
                </label>
                <label>
                  <p>
                    <Trans>App password</Trans>
                  </p>
                  <input
                    type="password"
                    class="large"
                    name="bskyPassword"
                    required
                    autocomplete="current-password"
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    disabled={bskyUIState === 'loading'}
                  />
                </label>
                <p style={{ fontSize: '90%' }}>
                  <a
                    href="https://bsky.app/settings/app-passwords"
                    target="_blank"
                    rel="noopener"
                  >
                    <Trans>Create an app password on Bluesky</Trans>
                  </a>
                </p>
                <div>
                  <button disabled={bskyUIState === 'loading'}>
                    <Trans>Log in with app password</Trans>
                  </button>
                </div>
              </form>
            </details>
          </>
        ) : (
          <p>
            <button
              type="button"
              class="plain4"
              onClick={() => setShowBluesky(true)}
            >
              <Icon icon="bluesky" alt="" /> <Trans>Log in with Bluesky</Trans>
            </button>
          </p>
        )}
      </div>
      <hr />
      {!DEFAULT_INSTANCE && (
        <p>
          <a href="https://joinmastodon.org/servers" target="_blank">
            <Trans>Don't have an account? Create one!</Trans>
          </a>
        </p>
      )}
      <p>
        <Link to="/">
          <Trans>Go home</Trans>
        </Link>
      </p>
      <LangSelector />
    </main>
  );
}

export default Login;
