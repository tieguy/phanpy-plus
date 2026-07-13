import './search.css';

import { useAutoAnimate } from '@formkit/auto-animate/preact';
import { Trans, useLingui } from '@lingui/react/macro';
import { Fragment } from 'preact';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useHotkeys } from 'react-hotkeys-hook';
import { InView } from 'react-intersection-observer';
import { useParams, useSearchParams } from 'react-router-dom';

import AccountBlock from '../components/account-block';
import CollectionCard from '../components/collection-card';
import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import NavMenu from '../components/nav-menu';
import RecentSearches from '../components/recent-searches';
import SearchForm from '../components/search-form';
import Status from '../components/status';
import { api } from '../utils/api';
import { getOtherNetworkAccounts } from '../utils/bluesky';
import { fetchRelationships } from '../utils/relationships';
import shortenNumber from '../utils/shorten-number';
import { getCurrentAccount } from '../utils/store-utils';
import usePageVisibility from '../utils/usePageVisibility';
import useTitle from '../utils/useTitle';

const SHORT_LIMIT = 5;
const LIMIT = 40;
const emptySearchParams = new URLSearchParams();

const scrollIntoViewOptions = {
  block: 'start',
  inline: 'center',
  behavior: 'instant',
};

function Search({ columnMode, ...props }) {
  const { t } = useLingui();
  const params = columnMode ? {} : useParams();
  const { masto, instance, authenticated } = api({
    instance: params.instance,
  });
  // Only the default search (no explicit instance in the URL) merges across
  // networks; an instance-scoped search stays on that instance.
  const searchInstance = params.instance;
  const [uiState, setUIState] = useState('default');
  const [searchParams] = columnMode ? [emptySearchParams] : useSearchParams();
  const searchFormRef = useRef();
  const q = props?.query || searchParams.get('q');
  const type = columnMode
    ? 'statuses'
    : props?.type || searchParams.get('type');
  let title = t`Search`;
  if (q) {
    switch (type) {
      case 'statuses':
        title = t`Search: ${q} (Posts)`;
        break;
      case 'accounts':
        title = t`Search: ${q} (Accounts)`;
        break;
      case 'hashtags':
        title = t`Search: ${q} (Hashtags)`;
        break;
      default:
        title = t`Search: ${q}`;
    }
  }
  useTitle(title, `/search`);

  const [showMore, setShowMore] = useState(false);
  const offsetRef = useRef(0);
  const searchIdRef = useRef(0);
  useEffect(() => {
    offsetRef.current = 0;
  }, [q, type]);

  const scrollableRef = useRef();
  useLayoutEffect(() => {
    scrollableRef.current?.scrollTo?.(0, 0);
  }, [q, type]);

  const [statusResults, setStatusResults] = useState([]);
  const [accountResults, setAccountResults] = useState([]);
  const [hashtagResults, setHashtagResults] = useState([]);
  const [collectionResults, setCollectionResults] = useState([]);
  useEffect(() => {
    setStatusResults([]);
    setAccountResults([]);
    setHashtagResults([]);
    setCollectionResults([]);
  }, [q]);
  const typeResults = {
    statuses: statusResults,
    accounts: accountResults,
    hashtags: hashtagResults,
    collections: collectionResults,
  };
  const setTypeResultsFunc = {
    statuses: setStatusResults,
    accounts: setAccountResults,
    hashtags: setHashtagResults,
    collections: setCollectionResults,
  };

  const [relationshipsMap, setRelationshipsMap] = useState({});
  const loadRelationships = async (accounts) => {
    if (!accounts?.length) return;
    const relationships = await fetchRelationships(accounts, relationshipsMap);
    if (relationships) {
      setRelationshipsMap((prev) => ({
        ...prev,
        ...relationships,
      }));
    }
  };

  const sortedSections = useMemo(() => {
    const sections = [
      {
        key: 'accounts',
        label: t`Accounts`,
        seeMoreLabel: t`See more accounts`,
        emptyLabel: t`No accounts found.`,
        listClass: 'timeline flat accounts-list',
        results: accountResults,
        renderItem: (item) => (
          <li key={item.id}>
            <AccountBlock
              account={item}
              instance={item._instance || instance}
              showStats
              relationship={relationshipsMap[item.id]}
            />
          </li>
        ),
      },
      {
        key: 'hashtags',
        label: t`Hashtags`,
        seeMoreLabel: t`See more hashtags`,
        emptyLabel: t`No hashtags found.`,
        listClass: 'link-list hashtag-list',
        results: hashtagResults,
        renderItem: (item) => {
          const { name, history } = item;
          const itemInstance = item._instance || instance;
          const total = history?.reduce?.((acc, cur) => acc + +cur.uses, 0);
          return (
            <li key={name}>
              <Link
                to={itemInstance ? `/${itemInstance}/t/${name}` : `/t/${name}`}
              >
                <Icon icon="hashtag" alt="#" />
                <span>{name}</span>
                {!!total && <span class="count">{shortenNumber(total)}</span>}
              </Link>
            </li>
          );
        },
      },
      {
        key: 'collections',
        label: t`Collections`,
        emptyLabel: null,
        listClass: 'collections-list',
        results: collectionResults,
        renderItem: (item) => (
          <li key={item.id}>
            <CollectionCard
              collection={item}
              instance={item._instance || instance}
              size="l"
            />
          </li>
        ),
      },
      {
        key: 'statuses',
        label: t`Posts`,
        seeMoreLabel: t`See more posts`,
        emptyLabel: t`No posts found.`,
        listClass: 'timeline',
        results: statusResults,
        renderItem: (item) => {
          const itemInstance = item._instance || instance;
          return (
            <li key={item.id}>
              <Link
                class="status-link"
                to={
                  itemInstance ? `/${itemInstance}/s/${item.id}` : `/s/${item.id}`
                }
              >
                <Status status={item} instance={itemInstance} />
              </Link>
            </li>
          );
        },
      },
    ];

    return [...sections]
      .filter((s) => !type || s.key === type)
      .filter((s) => s.key !== 'collections' || s.results.length > 0)
      .sort((a, b) => {
        if (type) return 0;
        if (a.results.length > 0 && b.results.length === 0) return -1;
        if (a.results.length === 0 && b.results.length > 0) return 1;
        return 0;
      });
  }, [
    type,
    accountResults,
    hashtagResults,
    collectionResults,
    statusResults,
    instance,
    relationshipsMap,
  ]);

  // Merge the combined search view across the current + other-network
  // accounts, tagging each result with its source instance so it routes to the
  // right network. Round-robin interleave preserves each network's own ranking
  // while giving both visibility near the top.
  async function fetchMergedSearch(searchParams) {
    const accounts = [getCurrentAccount(), ...getOtherNetworkAccounts()]
      .filter(Boolean)
      .filter(
        (a, i, arr) => arr.findIndex((b) => b.info?.id === a.info?.id) === i,
      );
    const per = await Promise.all(
      accounts.map(async (account) => {
        try {
          const { masto: m, instance: inst } = api({ account });
          const res = await m.v2.search.list(searchParams);
          const stamp = (arr) =>
            (arr || []).map((it) => ({ ...it, _instance: it._instance || inst }));
          return {
            accounts: stamp(res.accounts),
            statuses: stamp(res.statuses),
            hashtags: stamp(res.hashtags),
            collections: res.collections || [],
          };
        } catch (e) {
          console.error('Search failed for account', account?.info?.id, e);
          return { accounts: [], statuses: [], hashtags: [], collections: [] };
        }
      }),
    );
    const interleave = (lists) => {
      const out = [];
      const max = Math.max(0, ...lists.map((l) => l.length));
      for (let i = 0; i < max; i++) {
        for (const l of lists) if (l[i]) out.push(l[i]);
      }
      return out;
    };
    const dedupe = (arr, keyFn) => {
      const seen = new Set();
      return arr.filter((x) => {
        const k = keyFn(x);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };
    return {
      accounts: dedupe(
        interleave(per.map((r) => r.accounts)),
        (a) => `${a._instance}:${a.id}`,
      ),
      statuses: dedupe(
        interleave(per.map((r) => r.statuses)),
        (s) => `${s._instance}:${s.id}`,
      ),
      hashtags: dedupe(interleave(per.map((r) => r.hashtags)), (h) => h.name),
      collections: per.flatMap((r) => r.collections),
    };
  }

  function loadResults(firstLoad) {
    if (firstLoad) {
      offsetRef.current = 0;
    }

    if (!firstLoad && !authenticated) {
      // Search results pagination is only available to authenticated users
      return;
    }

    setUIState('loading');
    if (firstLoad && !type) {
      setStatusResults(statusResults.slice(0, SHORT_LIMIT));
      setAccountResults(accountResults.slice(0, SHORT_LIMIT));
      setHashtagResults(hashtagResults.slice(0, SHORT_LIMIT));
      setCollectionResults(collectionResults.slice(0, SHORT_LIMIT));
    }

    const searchId = ++searchIdRef.current;

    (async () => {
      const params = {
        q,
        resolve: authenticated,
        limit: SHORT_LIMIT,
      };
      if (type) {
        params.limit = LIMIT;
        params.type = type;
        if (authenticated) params.offset = offsetRef.current;
      }

      try {
        // Combined view (no type filter) on the default search merges both
        // networks; the per-type "See more" paging stays on the current account
        // because cross-network offsets don't combine reliably.
        const merged = !type && !searchInstance;
        const results = merged
          ? await fetchMergedSearch(params)
          : await masto.v2.search.list(params);

        if (searchIdRef.current !== searchId) return;

        if (type) {
          if (firstLoad) {
            setTypeResultsFunc[type](results[type]);
            const length = results[type]?.length;
            offsetRef.current = LIMIT;
            setShowMore(!!length);
          } else {
            // If first item is the same, it means API doesn't support offset
            // I know this is a very basic check, but it works for now
            if (results[type]?.[0]?.id === typeResults[type]?.[0]?.id) {
              setShowMore(false);
            } else {
              setTypeResultsFunc[type]((prev) => [...prev, ...results[type]]);
              const length = results[type]?.length;
              offsetRef.current = offsetRef.current + LIMIT;
              setShowMore(!!length);
            }
          }
        } else {
          setStatusResults(results.statuses || []);
          setAccountResults(results.accounts || []);
          setHashtagResults(results.hashtags || []);
          setCollectionResults(results.collections || []);
          offsetRef.current = 0;
          setShowMore(false);
        }
        loadRelationships(results.accounts);

        setUIState('default');
      } catch (err) {
        if (searchIdRef.current !== searchId) return;
        console.error(err);
        setUIState('error');
      }
    })();
  }

  const lastHiddenTime = useRef();
  usePageVisibility((visible) => {
    const reachStart = scrollableRef.current?.scrollTop === 0;
    if (visible && reachStart) {
      const timeDiff = Date.now() - lastHiddenTime.current;
      if (!lastHiddenTime.current || timeDiff > 1000 * 3) {
        // 3 seconds
        loadResults(true);
      } else {
        lastHiddenTime.current = Date.now();
      }
    }
  });

  useEffect(() => {
    let timer;
    searchFormRef.current?.setValue?.(q || '');
    if (q) {
      loadResults(true);
    } else {
      timer = setTimeout(() => {
        searchFormRef.current?.focus?.();
      }, 150); // Right after focusDeck runs
    }
    return () => clearTimeout(timer);
  }, [q, type, instance]);

  useHotkeys(
    ['Slash', '/'],
    (e) => {
      searchFormRef.current?.focus?.();
      searchFormRef.current?.select?.();
    },
    {
      useKey: true,
      preventDefault: true,
      ignoreEventWhen: (e) => {
        // Allow '/' even with Shift (e.g. German keyboards)
        if (e.key === '/') return false;
        return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;
      },
    },
  );

  const itemsSelector =
    '.timeline > li > a, .hashtag-list > li > a, .collections-list > li > a';
  const jRef = useHotkeys(
    'j',
    () => {
      const activeItem = document.activeElement.closest(itemsSelector);
      const activeItemRect = activeItem?.getBoundingClientRect();
      const allItems = Array.from(
        scrollableRef.current.querySelectorAll(itemsSelector),
      );
      if (
        activeItem &&
        activeItemRect.top < scrollableRef.current.clientHeight &&
        activeItemRect.bottom > 0
      ) {
        const activeItemIndex = allItems.indexOf(activeItem);
        let nextItem = allItems[activeItemIndex + 1];
        if (nextItem) {
          nextItem.focus();
          nextItem.scrollIntoView(scrollIntoViewOptions);
        }
      } else {
        const topmostItem = allItems.find((item) => {
          const itemRect = item.getBoundingClientRect();
          return itemRect.top >= 44 && itemRect.left >= 0;
        });
        if (topmostItem) {
          topmostItem.focus();
          topmostItem.scrollIntoView(scrollIntoViewOptions);
        }
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'j',
    },
  );

  const kRef = useHotkeys(
    'k',
    () => {
      // focus on previous status after active item
      const activeItem = document.activeElement.closest(itemsSelector);
      const activeItemRect = activeItem?.getBoundingClientRect();
      const allItems = Array.from(
        scrollableRef.current.querySelectorAll(itemsSelector),
      );
      if (
        activeItem &&
        activeItemRect.top < scrollableRef.current.clientHeight &&
        activeItemRect.bottom > 0
      ) {
        const activeItemIndex = allItems.indexOf(activeItem);
        let prevItem = allItems[activeItemIndex - 1];
        if (prevItem) {
          prevItem.focus();
          prevItem.scrollIntoView(scrollIntoViewOptions);
        }
      } else {
        const topmostItem = allItems.find((item) => {
          const itemRect = item.getBoundingClientRect();
          return itemRect.top >= 44 && itemRect.left >= 0;
        });
        if (topmostItem) {
          topmostItem.focus();
          topmostItem.scrollIntoView(scrollIntoViewOptions);
        }
      }
    },
    {
      useKey: true,
      ignoreEventWhen: (e) =>
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== 'k',
    },
  );

  const [filterBarParent] = useAutoAnimate();

  return (
    <div
      id="search-page"
      class="deck-container"
      tabIndex="-1"
      ref={(node) => {
        scrollableRef.current = node;
        jRef.current = node;
        kRef.current = node;
      }}
    >
      <div class="timeline-deck deck">
        <header class={uiState === 'loading' ? 'loading' : ''}>
          <div class="header-grid">
            <div class="header-side">
              <NavMenu />
            </div>
            <SearchForm ref={searchFormRef} />
            <div class="header-side">
              <button
                type="button"
                class="plain"
                onClick={() => {
                  loadResults(true);
                }}
                disabled={uiState === 'loading'}
              >
                <Icon icon="search" size="l" alt={t`Search`} />
              </button>
            </div>
          </div>
        </header>
        <main>
          {!!q && !columnMode && (
            <div
              ref={filterBarParent}
              class={`filter-bar ${uiState === 'loading' ? 'loading' : ''}`}
            >
              {!!type && (
                <Link to={`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`}>
                  <Icon icon="chevron-left" /> <Trans>All</Trans>
                </Link>
              )}
              {[
                {
                  label: t`Accounts`,
                  type: 'accounts',
                  to: `/search?q=${encodeURIComponent(q)}&type=accounts`,
                },
                {
                  label: t`Hashtags`,
                  type: 'hashtags',
                  to: `/search?q=${encodeURIComponent(q)}&type=hashtags`,
                },
                {
                  label: t`Posts`,
                  type: 'statuses',
                  to: `/search?q=${encodeURIComponent(q)}&type=statuses`,
                },
              ]
                .sort((a, b) => {
                  if (a.type === type) return -1;
                  if (b.type === type) return 1;
                  return 0;
                })
                .map((link) => (
                  <Link to={link.to} key={link.type}>
                    {link.label}
                  </Link>
                ))}
            </div>
          )}
          {!!q ? (
            <>
              {sortedSections.map((section) => (
                <Fragment key={section.key}>
                  {!type && (
                    <h2 class="timeline-header">
                      {section.label}{' '}
                      {section.seeMoreLabel && (
                        <Link
                          to={`/search?q=${encodeURIComponent(q)}&type=${section.key}`}
                        >
                          <Icon icon="arrow-right" size="l" alt={t`See more`} />
                        </Link>
                      )}
                    </h2>
                  )}
                  {section.results.length > 0 ? (
                    <>
                      <ul class={section.listClass}>
                        {section.results.map(section.renderItem)}
                      </ul>
                      {!type && section.seeMoreLabel && (
                        <div class="ui-state">
                          <Link
                            class="plain button"
                            to={`/search?q=${encodeURIComponent(q)}&type=${section.key}`}
                          >
                            {section.seeMoreLabel} <Icon icon="arrow-right" />
                          </Link>
                        </div>
                      )}
                    </>
                  ) : (
                    !type &&
                    section.emptyLabel &&
                    (uiState === 'loading' ? (
                      <p class="ui-state">
                        <Loader abrupt />
                      </p>
                    ) : (
                      <p class="ui-state">{section.emptyLabel}</p>
                    ))
                  )}
                </Fragment>
              ))}
              {!!type &&
                (uiState === 'default' ? (
                  showMore ? (
                    <InView
                      onChange={(inView) => {
                        if (inView) {
                          loadResults();
                        }
                      }}
                    >
                      <button
                        type="button"
                        class="plain block"
                        onClick={() => loadResults()}
                        style={{ marginBlockEnd: '6em' }}
                      >
                        <Trans>Show more…</Trans>
                      </button>
                    </InView>
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
                ))}
            </>
          ) : uiState === 'loading' ? (
            <p class="ui-state">
              <Loader abrupt />
            </p>
          ) : (
            <>
              <p class="ui-state insignificant">
                <Trans>
                  Enter your search term or paste a URL above to get started.
                </Trans>
              </p>
              <RecentSearches />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default Search;
