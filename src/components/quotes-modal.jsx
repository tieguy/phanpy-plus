import './quotes-modal.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'preact/hooks';

import { api } from '../utils/api';

import Icon from './icon';
import Link from './link';
import Loader from './loader';
import Status from './status';

const LIMIT = 20;

export default function QuotesModal({
  statusId,
  instance,
  onClose = () => {},
}) {
  const { t } = useLingui();
  // The post may live on the other network from the active account (a Bluesky
  // post read while a Mastodon account is current, or the reverse), so resolve
  // the client from the post's instance, not from whoever is signed in.
  const { masto } = api({ instance });

  const [posts, setPosts] = useState([]);
  const [uiState, setUIState] = useState('default');
  const [showMore, setShowMore] = useState(false);

  const quotesIterator = useRef();
  const firstLoad = useRef(true);

  const loadQuotes = (isFirstLoad = false) => {
    setUIState('loading');

    (async () => {
      try {
        // Inside the try: building the iterator touches the API client, which
        // throws outright when the network behind it has no quotes endpoint.
        if (isFirstLoad || !quotesIterator.current) {
          quotesIterator.current = masto.v1.statuses
            .$select(statusId)
            .quotes.list({
              limit: LIMIT,
            })
            .values();
        }
        let { done, value } = await quotesIterator.current.next();

        if (Array.isArray(value)) {
          if (isFirstLoad) {
            setPosts(value);
          } else {
            setPosts((prev) => [...prev, ...value]);
          }
          if (value.length < LIMIT) {
            done = true;
          }
          setShowMore(!done);
        } else {
          setShowMore(false);
        }
        setUIState('default');
      } catch (e) {
        console.error('Error loading quotes:', e);
        setUIState('error');
      }
    })();
  };

  useEffect(() => {
    loadQuotes(true);
    firstLoad.current = false;
  }, [statusId]);

  return (
    <div id="quotes-modal" class="sheet" tabindex="-1">
      {onClose && (
        <button type="button" class="sheet-close" onClick={onClose}>
          <Icon icon="x" alt={t`Close`} />
        </button>
      )}
      <header>
        <h2>
          <Trans>Quotes</Trans>
        </h2>
      </header>
      <main>
        {posts.length > 0 ? (
          <>
            <ul class="quoted-posts-list">
              {posts.map((post) => (
                <li key={post.id} class="quoted-post-item">
                  <Link
                    to={
                      instance ? `/${instance}/s/${post.id}` : `/s/${post.id}`
                    }
                    class="status-link"
                    onContextMenu={(e) => {
                      const post = e.target.querySelector('.status');
                      if (post) {
                        // Fire a custom event to open the context menu
                        if (e.metaKey) return;
                        e.preventDefault();
                        post.dispatchEvent(
                          new MouseEvent('contextmenu', {
                            clientX: e.clientX,
                            clientY: e.clientY,
                          }),
                        );
                      }
                    }}
                  >
                    <Status
                      status={post}
                      instance={instance}
                      size="s"
                      readOnly
                      showCommentCount
                      showQuoteCount
                    />
                  </Link>
                </li>
              ))}
            </ul>
            {uiState === 'default' ? (
              showMore ? (
                <button
                  type="button"
                  class="plain block"
                  onClick={() => loadQuotes()}
                >
                  <Trans>Show more…</Trans>
                </button>
              ) : (
                <p class="ui-state insignificant">
                  <Trans>The end.</Trans>
                </p>
              )
            ) : (
              uiState === 'loading' && (
                <p class="ui-state">
                  <Loader abrupt />
                </p>
              )
            )}
          </>
        ) : uiState === 'loading' ? (
          <p class="ui-state">
            <Loader abrupt />
          </p>
        ) : uiState === 'error' ? (
          <p class="ui-state">
            <Trans>Error loading quotes</Trans>
          </p>
        ) : (
          <p class="ui-state insignificant">
            <Trans>No quotes yet</Trans>
          </p>
        )}
      </main>
    </div>
  );
}
