import { Trans } from '@lingui/react/macro';
import { useState } from 'preact/hooks';

import { DEFAULT_BLUESKY_SERVICE, loginBluesky } from '../utils/bluesky';

import Icon from './icon';
import Loader from './loader';

// Bluesky handle + app password form. With `fixedHandle` the handle field is
// read-only but still submitted, so password managers can pair the saved app
// password with the handle. `onLoggedIn` runs after the account is saved and
// made current; the app needs a reload to pick it up.
function BlueskyLoginForm({ fixedHandle, defaultHandle = '', onLoggedIn }) {
  const [uiState, setUIState] = useState('default');
  const [error, setError] = useState(null);

  const onSubmit = (e) => {
    e.preventDefault();
    const { elements } = e.target;
    const identifier = elements.bskyPwIdentifier.value;
    const password = elements.bskyPassword.value;
    const service = elements.bskyService?.value || DEFAULT_BLUESKY_SERVICE;
    if (!identifier || !password) return;
    setError(null);
    setUIState('loading');
    (async () => {
      try {
        await loginBluesky({ service, identifier, password });
        onLoggedIn();
      } catch (err) {
        console.error(err);
        setError(err?.message || `${err}`);
        setUIState('error');
      }
    })();
  };

  return (
    <form onSubmit={onSubmit}>
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
          name="bskyPwIdentifier"
          defaultValue={fixedHandle || defaultHandle}
          readOnly={!!fixedHandle}
          required
          autocorrect="off"
          autocapitalize="off"
          autocomplete="username"
          spellCheck={false}
          placeholder="you.bsky.social"
          disabled={uiState === 'loading'}
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
          disabled={uiState === 'loading'}
        />
      </label>
      {uiState === 'error' && (
        <p class="error">
          <Trans>Failed to log in to Bluesky.</Trans> {error}
        </p>
      )}
      <div>
        <button disabled={uiState === 'loading'}>
          <Trans>Log in with app password</Trans>
        </button>
      </div>
      <p style={{ fontSize: '90%' }}>
        <a
          href="https://bsky.app/settings/app-passwords"
          target="_blank"
          rel="noopener"
        >
          <Trans>Create an app password on Bluesky</Trans>
        </a>{' '}
        <Trans>
          — tick "Allow access to your direct messages" if you want DMs.
        </Trans>
      </p>
      <Loader hidden={uiState !== 'loading'} />
    </form>
  );
}

export default BlueskyLoginForm;
