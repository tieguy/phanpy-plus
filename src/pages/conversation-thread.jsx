import './conversation-thread.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';

import Icon from '../components/icon';
import InertLinks from '../components/inert-links';
import Link from '../components/link';
import Loader from '../components/loader';
import Status from '../components/status';
import { api } from '../utils/api';
import shortenNumber from '../utils/shorten-number';
import showCompose from '../utils/show-compose';
import showToast from '../utils/show-toast';
import states, { saveStatus, statusKey } from '../utils/states';
import useTitle from '../utils/useTitle';

// One post of the thread, with the only three actions conversation mode
// offers: reply, like and share link.
function ThreadPost({ statusID, instance, focused, masto }) {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const status = snapStates.statuses[statusKey(statusID, instance)];
  const [liking, setLiking] = useState(false);
  if (!status) return null;
  const { favourited, favouritesCount, repliesCount } = status;

  async function like() {
    setLiking(true);
    try {
      const select = masto.v1.statuses.$select(statusID);
      const next = favourited
        ? await select.unfavourite()
        : await select.favourite();
      saveStatus(next, instance);
    } catch (e) {
      showToast(t`Unable to like: ${e?.message || e}`);
    } finally {
      setLiking(false);
    }
  }

  async function share() {
    const url = status.url || status.uri;
    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share({ url });
      } catch (e) {
        // The user closed the share sheet.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(t`Link copied`);
    } catch (e) {
      showToast(t`Unable to copy link`);
    }
  }

  return (
    <li
      class={`thread-post ${focused ? 'focused' : ''}`}
      data-focused={focused}
    >
      <InertLinks>
        <Status statusID={statusID} instance={instance} previewMode readOnly />
      </InertLinks>
      <div class="thread-actions">
        <button
          type="button"
          class="plain"
          onClick={() =>
            showCompose({ replyToStatus: { ...status, _instance: instance } })
          }
        >
          <Icon icon="comment" alt={t`Reply`} />
          {repliesCount > 0 && <span>{shortenNumber(repliesCount)}</span>}
        </button>
        <button
          type="button"
          class={`plain ${favourited ? 'liked' : ''}`}
          onClick={like}
          disabled={liking}
          aria-pressed={!!favourited}
        >
          <Icon icon="heart" alt={favourited ? t`Unlike` : t`Like`} />
          {favouritesCount > 0 && <span>{shortenNumber(favouritesCount)}</span>}
        </button>
        <button type="button" class="plain" onClick={share}>
          <Icon icon="share" alt={t`Share link`} />
        </button>
      </div>
    </li>
  );
}

// A thread in conversation mode: ancestors, the post the row pointed at, and
// its replies, in the order the server returns them. Nothing in it navigates
// except the back link to the list.
function ConversationThread() {
  const { t } = useLingui();
  useTitle(t`Conversation`, '/conversations/:instance/:id');
  const { instance, id } = useParams();
  const snapStates = useSnapshot(states);
  const { masto } = api({ instance });
  const [uiState, setUIState] = useState('loading');
  const [ids, setIds] = useState([]);
  const focusedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const select = masto.v1.statuses.$select(id);
        const [status, context] = await Promise.all([
          select.fetch(),
          select.context.fetch(),
        ]);
        if (cancelled) return;
        const all = [...context.ancestors, status, ...context.descendants];
        all.forEach((s) => saveStatus(s, instance));
        setIds(all.map((s) => s.id));
        setUIState('default');
      } catch (e) {
        console.error(e);
        if (!cancelled) setUIState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [instance, id, snapStates.reloadStatusPage]);

  // Bring the post the row pointed at into view once, on first load.
  useEffect(() => {
    if (uiState !== 'default' || focusedRef.current) return;
    focusedRef.current = true;
    document
      .querySelector('#conversation-thread-page [data-focused="true"]')
      ?.scrollIntoView({ block: 'center' });
  }, [uiState]);

  return (
    <div id="conversation-thread-page" class="deck-container" tabIndex="-1">
      <div class="timeline-deck deck">
        <header>
          <div class="header-grid">
            <div class="header-side">
              <Link to="/conversations" class="button plain">
                <Icon icon="chevron-left" size="xl" alt={t`Back`} />
              </Link>
            </div>
            <h1>
              <Trans>Conversation</Trans>
            </h1>
            <div class="header-side" />
          </div>
        </header>
        <main>
          {uiState === 'error' && !ids.length ? (
            <p class="ui-state">
              <Trans>Unable to load this conversation.</Trans>
            </p>
          ) : !ids.length ? (
            <p class="ui-state">
              <Loader />
            </p>
          ) : (
            <ul class="thread-posts">
              {ids.map((statusID) => (
                <ThreadPost
                  key={statusID}
                  statusID={statusID}
                  instance={instance}
                  focused={statusID === id}
                  masto={masto}
                />
              ))}
            </ul>
          )}
        </main>
      </div>
    </div>
  );
}

export default ConversationThread;
