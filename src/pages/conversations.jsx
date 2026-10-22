import './conversations.css';

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import Avatar from '../components/avatar';
import Icon from '../components/icon';
import Loader from '../components/loader';
import RelativeTime from '../components/relative-time';
import { api } from '../utils/api';
import { getOtherNetworkAccounts } from '../utils/bluesky';
import {
  CONVERSATION_DAYS,
  PAGE_CAP,
  groupConversations,
} from '../utils/conversation-group';
import { walkUntilCutoff } from '../utils/engagement-tally';
import getHTMLText from '../utils/getHTMLText';
import states, { saveStatus } from '../utils/states';
import useTitle from '../utils/useTitle';

const LIMIT = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

function names(accounts) {
  const list = accounts.map((a) => a.displayName || a.username || a.acct);
  if (list.length <= 2) return list.join(', ');
  return `${list.slice(0, 2).join(', ')} +${list.length - 2}`;
}

// The conversation list: threads with a reply or mention to the user in the
// last CONVERSATION_DAYS, from every merged source. In conversation mode this
// is the only page, so the header carries no navigation menu and no home link,
// and rows contain no links.
function Conversations() {
  const { t } = useLingui();
  useTitle(t`Conversations`, '/conversations');
  const snapStates = useSnapshot(states);
  const { masto, instance } = api();
  const [uiState, setUIState] = useState('default');
  const [entries, setEntries] = useState(null);
  const [failed, setFailed] = useState([]);
  const [reloadCount, reload] = useReducer((c) => c + 1, 0);

  const sources = useRef(null);
  if (sources.current === null) {
    sources.current = [
      { masto, instance },
      ...(snapStates.settings.mergedTimeline
        ? getOtherNetworkAccounts().map((account) => api({ account }))
        : []),
    ];
  }

  useEffect(() => {
    let cancelled = false;
    setUIState('loading');
    (async () => {
      const cutoff = Date.now() - CONVERSATION_DAYS * DAY_MS;
      const walked = await Promise.allSettled(
        sources.current.map(async ({ masto, instance }) => {
          const iterator = masto.v1.notifications
            .list({ limit: LIMIT, types: ['mention'] })
            .values();
          const { notifications } = await walkUntilCutoff(iterator, {
            cutoff,
            pageCap: PAGE_CAP,
          });
          return {
            instance,
            notifications: notifications.filter(
              (n) => Date.parse(n.createdAt) >= cutoff,
            ),
          };
        }),
      );
      if (cancelled) return;
      const loaded = walked
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);
      const failedInstances = walked
        .map((r, i) => r.status === 'rejected' && sources.current[i].instance)
        .filter(Boolean);
      // A block body: the build's console stripping leaves an empty arrow body
      // otherwise, which does not parse.
      for (const r of walked) {
        if (r.status === 'rejected') console.error(r.reason);
      }
      setFailed(failedInstances);
      if (!loaded.length) {
        setUIState('error');
        return;
      }
      const next = groupConversations(loaded);
      next.forEach(({ latestStatus, instance }) =>
        saveStatus(latestStatus, instance),
      );
      setEntries(next);
      setUIState('default');
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadCount]);

  return (
    <div id="conversations-page" class="deck-container" tabIndex="-1">
      <div class="timeline-deck deck">
        <header>
          <div class="header-grid">
            <div class="header-side" />
            <h1>
              <Trans>Conversations</Trans>
            </h1>
            <div class="header-side">
              <button
                type="button"
                class="plain"
                onClick={reload}
                disabled={uiState === 'loading'}
              >
                <Icon icon="refresh" size="l" alt={t`Refresh`} />
              </button>
            </div>
          </div>
        </header>
        <main>
          {failed.length > 0 && (
            <p class="conversations-notice">
              <Trans>Couldn’t load: {failed.join(', ')}</Trans>
            </p>
          )}
          {!entries ? (
            <p class="ui-state">
              {uiState === 'error' ? (
                t`Unable to load conversations.`
              ) : (
                <Loader />
              )}
            </p>
          ) : entries.length ? (
            <ul class="conversations">
              {entries.map((entry) => {
                const account = entry.accounts[0];
                const bluesky = !!entry.latestStatus._bluesky;
                return (
                  <li key={entry.key} class="conversation-row">
                    <Avatar
                      url={account?.avatar}
                      size="xxl"
                      alt={account?.displayName}
                      squircle={account?.bot}
                    />
                    <div class="conversation-content">
                      <div class="conversation-top">
                        <span class="conversation-name">
                          {names(entry.accounts)}
                        </span>
                        <Icon
                          icon={bluesky ? 'bluesky' : 'mastodon'}
                          size="s"
                          class="network-badge"
                          alt={bluesky ? 'Bluesky' : 'Mastodon'}
                        />
                        <RelativeTime
                          datetime={entry.latestAt}
                          format="micro"
                        />
                      </div>
                      <div class="conversation-snippet">
                        {getHTMLText(entry.latestStatus.content) || <i>…</i>}
                      </div>
                      {entry.responseCount > 1 && (
                        <div class="conversation-count">
                          <Plural
                            value={entry.responseCount}
                            one="# response"
                            other="# responses"
                          />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p class="ui-state insignificant">
              <Plural
                value={CONVERSATION_DAYS}
                one="No replies or mentions in the last day."
                other="No replies or mentions in the last # days."
              />
            </p>
          )}
        </main>
      </div>
    </div>
  );
}

export default Conversations;
