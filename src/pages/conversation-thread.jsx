import './conversation-thread.css';

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';

import Icon from '../components/icon';
import InertLinks from '../components/inert-links';
import Link from '../components/link';
import Loader from '../components/loader';
import Status, { quoteMessages } from '../components/status';
import { api } from '../utils/api';
import { threadRows } from '../utils/conversation-tree';
import { getQuotePolicy, supportsNativeQuote } from '../utils/quote-utils';
import shortenNumber from '../utils/shorten-number';
import showCompose from '../utils/show-compose';
import showToast from '../utils/show-toast';
import states, { saveStatus, statusKey } from '../utils/states';
import { isSelfAccountID } from '../utils/store-utils';
import useTitle from '../utils/useTitle';

// One post of the thread, with the only actions conversation mode offers:
// reply, quote, like and share link.
function ThreadPost({ statusID, instance, depth, focused, masto }) {
  const { t, _ } = useLingui();
  const snapStates = useSnapshot(states);
  const status = snapStates.statuses[statusKey(statusID, instance)];
  const [liking, setLiking] = useState(false);
  if (!status) return null;
  const { favourited, favouritesCount, repliesCount, quotesCount } = status;

  // Native quotes follow the post's quote policy. An instance without them
  // gets the post's link in a new post, as the full app's "Quote with link".
  const nativeQuote = supportsNativeQuote(instance);
  const quotePolicy = nativeQuote
    ? getQuotePolicy({
        visibility: status.visibility,
        isSelf: isSelfAccountID(status.account?.id, instance),
        quoteApproval: status.quoteApproval,
      })
    : { disabled: !status.url, reason: null };
  const quoteLabel =
    quotePolicy.reason === 'requestQuote'
      ? _(quoteMessages.requestQuote)
      : quotePolicy.reason
        ? _(quoteMessages[quotePolicy.reason])
        : t`Quote`;

  function quote() {
    if (nativeQuote) {
      showCompose({ quoteStatus: { ...status, _instance: instance } });
    } else {
      showCompose({
        draftStatus: { status: `\n${status.url}`, _instance: instance },
      });
    }
  }

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
      class={`thread-post ${depth ? 'nested' : ''} ${focused ? 'focused' : ''}`}
      data-focused={focused}
      style={{ '--depth': depth }}
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
          class="plain"
          onClick={quote}
          disabled={quotePolicy.disabled}
          title={quoteLabel}
        >
          <Icon icon="quote" alt={quoteLabel} />
          {quotesCount > 0 && <span>{shortenNumber(quotesCount)}</span>}
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

// A thread in conversation mode: the whole thread from its root, replies
// nested under the post they answer (see threadRows). Nothing in it navigates
// except the back link to the list.
function ConversationThread() {
  const { t } = useLingui();
  useTitle(t`Conversation`, '/conversations/:instance/:id');
  const { instance, id } = useParams();
  const snapStates = useSnapshot(states);
  const { masto } = api({ instance });
  const [uiState, setUIState] = useState('loading');
  const [thread, setThread] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
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
        let all = [...context.ancestors, status, ...context.descendants];
        // The context of a reply holds only its own line of ancestors, so
        // read the root's context too for the other branches.
        const rootId = context.ancestors[0]?.id || status.id;
        if (rootId !== status.id) {
          try {
            const rootContext = await masto.v1.statuses
              .$select(rootId)
              .context.fetch();
            all = [...all, ...rootContext.descendants];
          } catch (e) {
            console.error(e);
          }
        }
        if (cancelled) return;
        all.forEach((s) => saveStatus(s, instance));
        setThread({ rootId, statuses: all });
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

  const rows = useMemo(
    () =>
      thread
        ? threadRows(thread.statuses, {
            rootId: thread.rootId,
            focusedId: id,
            expanded,
          })
        : [],
    [thread, id, expanded],
  );

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
          {uiState === 'error' && !thread ? (
            <p class="ui-state">
              <Trans>Unable to load this conversation.</Trans>
            </p>
          ) : !thread ? (
            <p class="ui-state">
              <Loader />
            </p>
          ) : (
            <ul class="thread-posts">
              {rows.map((row) =>
                row.type === 'post' ? (
                  <ThreadPost
                    key={row.id}
                    statusID={row.id}
                    instance={instance}
                    depth={row.depth}
                    focused={row.id === id}
                    masto={masto}
                  />
                ) : (
                  <li
                    key={`more-${row.id}`}
                    class="thread-more"
                    style={{ '--depth': row.depth }}
                  >
                    <button
                      type="button"
                      class="plain"
                      onClick={() =>
                        setExpanded((prev) => new Set(prev).add(row.id))
                      }
                    >
                      <Plural
                        value={row.count}
                        one="# more reply"
                        other="# more replies"
                      />
                    </button>
                  </li>
                ),
              )}
            </ul>
          )}
        </main>
      </div>
    </div>
  );
}

export default ConversationThread;
