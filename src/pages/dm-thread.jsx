import './dm-thread.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useNavigate, useParams } from 'react-router-dom';

import Avatar from '../components/avatar';
import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import RelativeTime from '../components/relative-time';
import {
  getCachedConversation,
  getDMClientForInstance,
} from '../utils/dm';
import sanitizeHTML from '../utils/sanitize-html';
import useTitle from '../utils/useTitle';

function DMThread() {
  const { t } = useLingui();
  const params = useParams();
  const instance = params.instance;
  const id = decodeURIComponent(params.id || '');
  const navigate = useNavigate();

  const source = useMemo(() => getDMClientForInstance(instance), [instance]);
  const [conversation, setConversation] = useState(() =>
    getCachedConversation(instance, id),
  );
  const [messages, setMessages] = useState([]);
  const [uiState, setUIState] = useState('loading'); // loading | default | error
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const account = conversation?.accounts?.[0];
  useTitle(
    account
      ? t`Messages with ${account.displayName || account.acct}`
      : t`Messages`,
    '/messages/:instance/:id',
  );

  function scrollToBottom() {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    });
  }

  async function resolveConversation() {
    let convo = conversation || getCachedConversation(instance, id);
    if (!convo && source?.getConversation) {
      try {
        convo = await source.getConversation(id);
      } catch (e) {
        convo = null;
      }
    }
    return convo;
  }

  async function load() {
    setUIState('loading');
    const convo = await resolveConversation();
    if (!convo) {
      // No way to reconstruct (e.g. a Mastodon thread after a hard reload).
      navigate('/messages', { replace: true });
      return;
    }
    setConversation(convo);
    try {
      const thread = await source.getThread(convo);
      setMessages(thread || []);
      setUIState('default');
      scrollToBottom();
      source.markRead(convo).catch(() => {});
    } catch (e) {
      console.error('Failed to load messages', e);
      setUIState('error');
    }
  }

  useEffect(() => {
    if (!source) {
      navigate('/messages', { replace: true });
      return;
    }
    load();
  }, [instance, id]);

  async function send(e) {
    e?.preventDefault?.();
    const value = text.trim();
    if (!value || sending || !conversation) return;
    setSending(true);
    try {
      const message = await source.sendMessage(conversation, value);
      if (message) {
        setMessages((prev) => [...prev, message]);
      }
      setText('');
      scrollToBottom();
    } catch (err) {
      console.error('Failed to send message', err);
      alert(t`Your message couldn’t be sent. Try again.`);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div id="dm-thread-page" class="deck-container">
      <div class="deck">
        <header>
          <div class="header-grid">
            <Link to="/messages" class="button plain" title={t`Back`}>
              <Icon icon="arrow-left" alt={t`Back`} />
            </Link>
            {account && (
              <Link
                to={`/${instance}/a/${account.id}`}
                class="thread-peer"
                title={account.acct}
              >
                <Avatar
                  url={account.avatar}
                  size="l"
                  alt={account.displayName}
                />
                <b>{account.displayName || account.acct}</b>
                <Icon
                  icon={
                    conversation.network === 'bluesky' ? 'bluesky' : 'mastodon'
                  }
                  size="s"
                  alt={conversation.network}
                />
              </Link>
            )}
          </div>
        </header>
        <ul class="messages">
          {messages.map((message) => (
            <li
              key={message.id}
              class={message.fromSelf ? 'from-self' : 'from-peer'}
            >
              <div class="bubble">
                <div
                  class="message-body"
                  dangerouslySetInnerHTML={{ __html: sanitizeHTML(message.html) }}
                />
                <RelativeTime
                  datetime={message.createdAt}
                  format="micro"
                />
              </div>
            </li>
          ))}
          <li ref={bottomRef} class="scroll-anchor" />
        </ul>
        <div class="thread-footer">
          {uiState === 'loading' && <Loader />}
          {uiState === 'error' && (
            <p class="ui-state">
              <Trans>Couldn’t load this conversation.</Trans>{' '}
              <button type="button" class="plain" onClick={load}>
                <Trans>Try again</Trans>
              </button>
            </p>
          )}
          {uiState === 'default' && !messages.length && (
            <p class="ui-state insignificant">
              <Trans>No messages yet. Say hello.</Trans>
            </p>
          )}
        </div>
        <form class="compose-bar" onSubmit={send}>
          <textarea
            value={text}
            placeholder={t`Message…`}
            rows={1}
            disabled={sending || uiState === 'loading'}
            onInput={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="submit"
            class="button plain2"
            disabled={sending || !text.trim()}
            title={t`Send`}
          >
            <Icon icon="arrow-up-circle" size="l" alt={t`Send`} />
          </button>
        </form>
      </div>
    </div>
  );
}

export default DMThread;
