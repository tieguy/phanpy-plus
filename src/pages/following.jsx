import { useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import Timeline from '../components/timeline';
import { api } from '../utils/api';
import { getOtherNetworkAccounts } from '../utils/bluesky';
import { filteredItems } from '../utils/filters';
import { createMergedTimelineIterator } from '../utils/merged-timeline';
import states, { getStatus, saveStatus } from '../utils/states';
import supports from '../utils/supports';
import {
  assignFollowedTags,
  clearFollowedTagsState,
  dedupeBoosts,
} from '../utils/timeline-utils';
import useTitle from '../utils/useTitle';

const LIMIT = 20;

function Following({ title, path, id, ...props }) {
  const { t } = useLingui();
  useTitle(
    title ||
      t({
        id: 'following.title',
        message: 'Following',
      }),
    path || '/following',
  );
  const { masto, streaming, instance, client } = api();
  const [streamingClient, setStreamingClient] = useState(streaming);

  const snapStates = useSnapshot(states);
  const homeIterable = useRef();
  const homeIterator = useRef();
  const mergedIterator = useRef();
  const latestItem = useRef();
  const latestItems = useRef({}); // per-instance latest item ID

  // Other-network accounts (e.g. Bluesky accounts when the current account
  // is Mastodon, and vice versa) merged into the home timeline
  const otherSources = useRef(null);
  if (otherSources.current === null) {
    otherSources.current = snapStates.settings.mergedTimeline
      ? getOtherNetworkAccounts().map((account) => {
          const { masto: otherMasto, instance: otherInstance } = api({
            account,
          });
          return { masto: otherMasto, instance: otherInstance };
        })
      : [];
  }

  // Streaming only happens after instance is initialized
  useEffect(() => {
    if (!streaming && client?.onStreamingReady) {
      client.onStreamingReady((streamingClient) => {
        setStreamingClient(streamingClient);
      });
    }
  }, [client]);
  __BENCHMARK.end('time-to-following');

  console.debug('RENDER Following', title, id);
  const supportsPixelfed = supports('@pixelfed/home-include-reblogs');

  async function fetchHome(firstLoad) {
    const merged = otherSources.current?.length > 0;
    if (
      firstLoad ||
      (merged ? !mergedIterator.current : !homeIterator.current)
    ) {
      __BENCHMARK.start('fetch-home-first');
      homeIterable.current = masto.v1.timelines.home.list({ limit: LIMIT });
      homeIterator.current = homeIterable.current.values();
      if (merged) {
        mergedIterator.current = createMergedTimelineIterator([
          {
            instance,
            makeIterator: () => homeIterator.current,
          },
          ...otherSources.current.map(
            ({ masto: otherMasto, instance: otherInstance }) => ({
              instance: otherInstance,
              makeIterator: () =>
                otherMasto.v1.timelines.home.list({ limit: LIMIT }).values(),
            }),
          ),
        ]);
      }
    }
    if (supportsPixelfed && homeIterable.current?.params) {
      if (typeof homeIterable.current.params === 'string') {
        homeIterable.current.params += '&include_reblogs=true';
      } else {
        homeIterable.current.params.include_reblogs = true;
      }
    }
    const results = merged
      ? await mergedIterator.current.next(LIMIT)
      : await homeIterator.current.next();
    let { value } = results;
    if (value?.length) {
      let latestItemChanged = false;
      if (firstLoad) {
        if (value[0].id !== latestItem.current) {
          latestItemChanged = true;
        }
        latestItem.current = value[0].id;
        // Track latest item per source for checkForUpdates
        const seen = {};
        for (const item of value) {
          const itemInstance = item._instance || instance;
          if (!seen[itemInstance]) {
            seen[itemInstance] = true;
            latestItems.current[itemInstance] = item.id;
          }
        }
        console.log('First load', latestItem.current);
      }

      // value = filteredItems(value, 'home');
      value.forEach((item) => {
        saveStatus(item, item._instance || instance);
      });
      value = dedupeBoosts(value, instance);
      if (firstLoad && latestItemChanged) clearFollowedTagsState();
      setTimeout(() => {
        assignFollowedTags(value, instance);
      }, 100);

      // ENFORCE sort by datetime (Latest first)
      value.sort((a, b) => {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
    }
    __BENCHMARK.end('fetch-home-first');
    return {
      ...results,
      value,
    };
  }

  async function checkForUpdates() {
    const sources = [
      { masto, instance, main: true },
      ...(otherSources.current || []),
    ];
    let hasUpdates = false;
    for (const source of sources) {
      try {
        const sourceLatest = source.main
          ? latestItem.current
          : latestItems.current[source.instance];
        const opts = {
          limit: 5,
          since_id: source.main ? sourceLatest : undefined,
        };
        if (source.main && supportsPixelfed) {
          opts.include_reblogs = true;
        }
        const results = await source.masto.v1.timelines.home
          .list(opts)
          .values()
          .next();
        let { value } = results;
        console.log('checkForUpdates', source.instance, sourceLatest, value);
        if (!sourceLatest) {
          // No baseline yet for this source — record one, don't report updates
          if (value?.[0]?.id) {
            latestItems.current[source.instance] = value[0].id;
          }
          continue;
        }
        const valueContainsLatestItem = value[0]?.id === sourceLatest; // since_id might not be supported
        if (value?.length && !valueContainsLatestItem) {
          if (source.main) {
            latestItem.current = value[0].id;
          }
          latestItems.current[source.instance] = value[0].id;
          value = dedupeBoosts(value, source.instance);
          value = filteredItems(value, 'home');
          if (value.some((item) => !item.reblog)) {
            hasUpdates = true;
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
    return hasUpdates;
  }

  useEffect(() => {
    let sub;
    (async () => {
      if (streamingClient) {
        sub = streamingClient.user.subscribe();
        console.log('🎏 Streaming user', sub);
        for await (const entry of sub) {
          if (!sub) break;
          if (entry.event === 'status.update') {
            const status = entry.payload;
            console.log(`🔄 Status ${status.id} updated`);
            saveStatus(status, instance);
          } else if (entry.event === 'delete') {
            const statusID = entry.payload;
            console.log(`❌ Status ${statusID} deleted`);
            // delete states.statuses[statusID];
            const s = getStatus(statusID, instance);
            if (s) s._deleted = true;
          }
        }
        console.log('💥 Streaming user loop STOPPED');
      }
    })();
    return () => {
      sub?.unsubscribe?.();
      sub = null;
    };
  }, [streamingClient]);

  return (
    <Timeline
      title={title || t({ id: 'following.title', message: 'Following' })}
      id={id || 'following'}
      emptyText={t`Nothing to see here.`}
      errorText={t`Unable to load posts.`}
      instance={instance}
      fetchItems={fetchHome}
      checkForUpdates={checkForUpdates}
      useItemID
      boostsCarousel={snapStates.settings.boostsCarousel}
      {...props}
      // allowFilters
      filterContext="home"
      showFollowedTags
      showReplyParent
    />
  );
}

export default Following;
