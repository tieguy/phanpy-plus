import './welcome.css';

import { Trans } from '@lingui/react/macro';

import logo from '../assets/logo.svg';

import Icon from '../components/icon';
import LangSelector from '../components/lang-selector';
import Link from '../components/link';
import states from '../utils/states';
import useTitle from '../utils/useTitle';

const {
  FLEETING_DEFAULT_INSTANCE: DEFAULT_INSTANCE,
  FLEETING_WEBSITE: WEBSITE,
  FLEETING_PRIVACY_POLICY_URL: PRIVACY_POLICY_URL,
  FLEETING_DEFAULT_INSTANCE_REGISTRATION_URL: DEFAULT_INSTANCE_REGISTRATION_URL,
} = import.meta.env;
const appSite = WEBSITE
  ? WEBSITE.replace(/https?:\/\//g, '').replace(/\/$/, '')
  : null;
const sameSite = WEBSITE
  ? WEBSITE.toLowerCase().includes(location.hostname)
  : false;
const appVersion = __COMMIT_TIME__
  ? `${__COMMIT_TIME__.slice(0, 10).replace(/-/g, '.')}${
      __COMMIT_HASH__ ? `.${__COMMIT_HASH__}` : ''
    }`
  : null;

function Welcome() {
  useTitle(null, ['/', '/welcome']);
  return (
    <main id="welcome">
      <div class="hero-container">
        <div class="hero-content">
          <h1>
            <img src={logo} alt="" width="100" height="100" />
            <span class="wordmark">Fleeting</span>
          </h1>
          <p class="desc">
            <Trans>
              One home for Mastodon <em>and</em> Bluesky — two accounts,
              interwoven.
            </Trans>
          </p>
          <div class="login-options">
            <Link
              to={
                DEFAULT_INSTANCE
                  ? `/login?instance=${DEFAULT_INSTANCE}&submit=1`
                  : '/login'
              }
              class="button plain6"
            >
              <Icon icon="mastodon" alt="" />
              <Trans>Log in with Mastodon</Trans>
            </Link>
            <Link to="/login?network=bluesky" class="button plain6">
              <Icon icon="bluesky" alt="" />
              <Trans>Log in with Bluesky</Trans>
            </Link>
          </div>
          {DEFAULT_INSTANCE && DEFAULT_INSTANCE_REGISTRATION_URL && (
            <p>
              <a href={DEFAULT_INSTANCE_REGISTRATION_URL} class="button plain5">
                <Trans>Sign up</Trans>
              </a>
            </p>
          )}
          <p class="insignificant">
            <small>
              <Trans>Your credentials are not stored on this server.</Trans>
            </small>
          </p>
        </div>
      </div>
      <div class="interweave">
        <ul>
          <li>
            <Trans>
              <b>One timeline.</b> Your Mastodon and Bluesky home feeds, merged
              in time order.
            </Trans>
          </li>
          <li>
            <Trans>
              <b>One bell.</b> Notifications from both networks gather in the
              same inbox.
            </Trans>
          </li>
          <li>
            <Trans>
              <b>One app.</b> Read, reply, and boost as either account — no
              separate tabs.
            </Trans>
          </li>
        </ul>
      </div>
      <footer>
        <p>
          <Trans>
            A personal fork of{' '}
            <a
              href="https://github.com/cheeaun/phanpy"
              target="_blank"
              rel="noopener"
            >
              Phanpy
            </a>{' '}
            by{' '}
            <a
              href="https://mastodon.social/@cheeaun"
              target="_blank"
              onClick={(e) => {
                e.preventDefault();
                states.showAccount = 'cheeaun@mastodon.social';
              }}
            >
              @cheeaun
            </a>
            .
          </Trans>{' '}
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener">
            <Trans>Privacy</Trans>
          </a>
        </p>
        {(appSite || appVersion) && (
          <p class="app-site-version">
            <small>
              {sameSite ? appSite : ''} {appVersion}
            </small>
          </p>
        )}
        <LangSelector />
      </footer>
    </main>
  );
}

export default Welcome;
