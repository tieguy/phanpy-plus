import './engagement.css';

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import NavMenu from '../components/nav-menu';
import Status from '../components/status';
import { api } from '../utils/api';
import { getOtherNetworkAccounts } from '../utils/bluesky';
import {
  PAGE_CAP,
  WINDOW_MS,
  tallyEngagement,
  walkUntilCutoff,
} from '../utils/engagement-tally';
import shortenNumber from '../utils/shorten-number';
import states, { saveStatus } from '../utils/states';
import useTitle from '../utils/useTitle';

const LIMIT = 80;

// Likes and boosts as numbers, not events: a stateless 24-hour tally over
// like/boost notifications from every merged source. Never shows who engaged.
function Engagement({ columnMode }) {
  const { t } = useLingui();
  useTitle(t`Engagement`, '/engagement');
  const snapStates = useSnapshot(states);
  const { masto, instance } = api();
  const [uiState, setUIState] = useState('default');
  const [tally, setTally] = useState(null);
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
      const cutoff = Date.now() - WINDOW_MS;
      try {
        const walked = await Promise.all(
          sources.current.map(async ({ masto, instance }) => {
            const iterator = masto.v1.notifications
              .list({ limit: LIMIT, types: ['favourite', 'reblog'] })
              .values();
            const result = await walkUntilCutoff(iterator, {
              cutoff,
              pageCap: PAGE_CAP,
            });
            return { instance, ...result };
          }),
        );
        if (cancelled) return;
        const next = tallyEngagement(walked, { cutoff });
        next.rows.forEach(({ status, instance }) =>
          saveStatus(status, instance),
        );
        setTally(next);
        setUIState('default');
      } catch (e) {
        console.error(e);
        if (!cancelled) setUIState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadCount]);

  return (
    <div id="engagement-page" class="deck-container" tabIndex="-1">
      <div class="timeline-deck deck">
        <header>
          <div class="header-grid">
            <div class="header-side">
              <NavMenu />
              {!columnMode && (
                <Link to="/" class="button plain">
                  <Icon icon="home" size="l" alt={t`Home`} />
                </Link>
              )}
            </div>
            <h1>
              <Trans>Engagement</Trans>
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
          {!tally ? (
            <p class="ui-state">
              {uiState === 'error' ? (
                t`Unable to load engagement.`
              ) : (
                <Loader />
              )}
            </p>
          ) : (
            <>
              {uiState === 'error' && (
                <p class="ui-state insignificant">
                  <Trans>Unable to refresh engagement.</Trans>
                </p>
              )}
              <ul class="engagement-summary">
                {tally.networks.map(({ instance, likes, boosts, capped }) => (
                  <li key={instance}>
                    <span class="engagement-instance">{instance}</span>{' '}
                    <span>
                      {capped ? (
                        <Trans>
                          at least{' '}
                          <Plural
                            value={likes}
                            one="# like"
                            other="# likes"
                          />{' '}
                          ·{' '}
                          <Plural
                            value={boosts}
                            one="# boost"
                            other="# boosts"
                          />{' '}
                          in the last 24h
                        </Trans>
                      ) : (
                        <Trans>
                          <Plural
                            value={likes}
                            one="# like"
                            other="# likes"
                          />{' '}
                          ·{' '}
                          <Plural
                            value={boosts}
                            one="# boost"
                            other="# boosts"
                          />{' '}
                          in the last 24h
                        </Trans>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {tally.rows.length ? (
                <ul class="engagement-rows">
                  {tally.rows.map(
                    ({ key, instance, status, windowLikes, windowBoosts }) => (
                      <li key={key}>
                        <Link
                          class="engagement-row"
                          to={`/${instance}/s/${status.id}`}
                        >
                          <div class="engagement-window">
                            <span title={t`Likes in the last 24h`}>
                              <Icon icon="heart" alt={t`Likes`} />{' '}
                              {shortenNumber(windowLikes)}
                            </span>
                            <span title={t`Boosts in the last 24h`}>
                              <Icon icon="rocket" alt={t`Boosts`} />{' '}
                              {shortenNumber(windowBoosts)}
                            </span>
                          </div>
                          <Status
                            status={status}
                            instance={instance}
                            size="s"
                            previewMode
                            readOnly
                          />
                          <div class="engagement-totals insignificant">
                            <Trans>
                              Total: {shortenNumber(status.favouritesCount || 0)}{' '}
                              likes · {shortenNumber(status.reblogsCount || 0)}{' '}
                              boosts · {shortenNumber(status.repliesCount || 0)}{' '}
                              replies · {shortenNumber(status.quotesCount || 0)}{' '}
                              quotes
                            </Trans>
                          </div>
                        </Link>
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                <p class="ui-state insignificant">
                  <Trans>No likes or boosts in the last 24 hours.</Trans>
                </p>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default Engagement;
