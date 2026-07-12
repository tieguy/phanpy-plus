import './messages.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import Avatar from '../components/avatar';
import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import RelativeTime from '../components/relative-time';
import { cacheConversation, getDMSources } from '../utils/dm';
import { createMergedTimelineIterator } from '../utils/merged-timeline';
import states from '../utils/states';
import useTitle from '../utils/useTitle';

const LIMIT = 30;

function conversationKey(convo) {
  return `${convo._instance}:${convo.id}`;
}

function conversationTitle(convo) {
  const names = (convo.accounts || []).map(
    (a) => a.displayName || a.username || a.acct,
  );
  if (!names.length) return '(unknown)';
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function Messages() {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  useTitle(t`Messages`, '/messages');

  const iteratorRef = useRef(null);
  const [conversations, setConversations] = useState([]);
  const [uiState, setUIState] = useState('default'); // default | loading | end | error
  const seenRef = useRef(new Set());

  function makeIterator() {
    const sources = getDMSources({
      merged: snapStates.settings.mergedTimeline !== false,
    });
    return createMergedTimelineIterator(
      sources.map((source) => ({
        instance: source.instance,
        makeIterator: () =>
          source.listConversations({ limit: LIMIT }).values(),
      })),
    );
  }

  async function loadMore(firstLoad) {
    if (uiState === 'loading') return;
    setUIState('loading');
    try {
      if (firstLoad || !iteratorRef.current) {
        iteratorRef.current = makeIterator();
        seenRef.current = new Set();
      }
      const { done, value } = await iteratorRef.current.next(LIMIT);
      const fresh = (value || []).filter((convo) => {
        const key = conversationKey(convo);
        if (seenRef.current.has(key)) return false;
        seenRef.current.add(key);
        cacheConversation(convo);
        return true;
      });
      setConversations((prev) => (firstLoad ? fresh : [...prev, ...fresh]));
      setUIState(done ? 'end' : 'default');
    } catch (e) {
      console.error('Failed to load conversations', e);
      setUIState('error');
    }
  }

  useEffect(() => {
    loadMore(true);
  }, []);

  return (
    <div id="messages-page" class="deck-container">
      <div class="timeline-deck deck">
        <header>
          <div class="header-grid">
            <h1>
              <Icon icon="message" size="l" alt="" />{' '}
              <Trans>Messages</Trans>
            </h1>
          </div>
        </header>
        {conversations.length > 0 && (
          <ul class="conversations">
            {conversations.map((convo) => {
              const account = convo.accounts?.[0];
              const last = convo.lastMessage;
              return (
                <li
                  key={conversationKey(convo)}
                  class={convo.unread ? 'unread' : ''}
                >
                  <Link
                    to={`/messages/${convo._instance}/${encodeURIComponent(
                      convo.id,
                    )}`}
                    class="conversation-link"
                  >
                    <Avatar
                      url={account?.avatar}
                      size="xxl"
                      alt={account?.displayName}
                      squircle={account?.bot}
                    />
                    <div class="conversation-content">
                      <div class="conversation-top">
                        <span class="conversation-name">
                          {conversationTitle(convo)}
                        </span>
                        <Icon
                          icon={
                            convo.network === 'bluesky' ? 'bluesky' : 'mastodon'
                          }
                          size="s"
                          class="network-badge"
                          alt={convo.network}
                        />
                        {last?.createdAt && (
                          <RelativeTime
                            datetime={last.createdAt}
                            format="micro"
                          />
                        )}
                      </div>
                      <div class="conversation-snippet">
                        {last ? (
                          <>
                            {last.fromSelf && (
                              <span class="you">
                                <Trans>You:</Trans>{' '}
                              </span>
                            )}
                            {last.text || <i>…</i>}
                          </>
                        ) : (
                          <i>
                            <Trans>No messages yet</Trans>
                          </i>
                        )}
                      </div>
                    </div>
                    {convo.unread && <span class="unread-dot" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div class="messages-footer">
          {uiState === 'loading' && <Loader />}
          {uiState === 'error' && (
            <p class="ui-state">
              <Trans>Couldn’t load messages.</Trans>{' '}
              <button type="button" class="plain" onClick={() => loadMore()}>
                <Trans>Try again</Trans>
              </button>
            </p>
          )}
          {uiState === 'default' && conversations.length > 0 && (
            <button type="button" class="plain block" onClick={() => loadMore()}>
              <Trans>Show more…</Trans>
            </button>
          )}
          {uiState === 'end' && conversations.length === 0 && (
            <p class="ui-state insignificant">
              <Trans>No conversations yet.</Trans>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default Messages;
