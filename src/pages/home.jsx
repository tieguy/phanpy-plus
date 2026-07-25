import './notifications-menu.css';

import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { ControlledMenu } from '@szhsin/react-menu';
import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import Columns from '../components/columns';
import Icon from '../components/icon';
import Link from '../components/link';
import Loader from '../components/loader';
import Notification from '../components/notification';
import { api } from '../utils/api';
import { getOtherNetworkAccounts } from '../utils/bluesky';
import db from '../utils/db';
import FilterContext from '../utils/filter-context';
import groupNotifications, {
  massageNotifications2,
} from '../utils/group-notifications';
import { createMergedTimelineIterator } from '../utils/merged-timeline';
import { isDirectResponse } from '../utils/notification-filter';
import states, { saveStatus } from '../utils/states';
import { getCurrentAccountNS } from '../utils/store-utils';

import Following from './following';
import Following2 from './following2';
import {
  getGroupedNotifications,
  mastoFetchNotifications,
} from './notifications';

function Home() {
  const { _ } = useLingui();
  const snapStates = useSnapshot(states);
  __BENCHMARK.end('time-to-home');
  useEffect(() => {
    (async () => {
      const keys = await db.drafts.keys();
      if (keys.length) {
        const ns = getCurrentAccountNS();
        const ownKeys = keys.filter((key) => key.startsWith(ns));
        if (ownKeys.length) {
          states.showDrafts = true;
        }
      }
    })();
  }, []);

  return (
    <>
      {(snapStates.settings.shortcutsViewMode === 'multi-column' ||
        (!snapStates.settings.shortcutsViewMode &&
          snapStates.settings.shortcutsColumnsMode)) &&
      !!snapStates.shortcuts?.length ? (
        <Columns />
      ) : snapStates.settings.paginatedTimeline ? (
        <Following2
          title={_(msg`Home`)}
          path="/"
          id="home"
          headerStart={false}
          headerEnd={<NotificationsLink />}
        />
      ) : (
        <Following
          title={_(msg`Home`)}
          path="/"
          id="home"
          headerStart={false}
          headerEnd={<NotificationsLink />}
        />
      )}
    </>
  );
}

function NotificationsLink() {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const notificationLinkRef = useRef();
  const [menuState, setMenuState] = useState(undefined);
  return (
    <>
      <Link
        ref={notificationLinkRef}
        to="/notifications"
        class={`button plain notifications-button ${
          snapStates.notificationsShowNew ? 'has-badge' : ''
        } ${menuState || ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (window.matchMedia('(min-width: calc(40em))').matches) {
            e.preventDefault();
            setMenuState((state) => (!state ? 'open' : undefined));
          }
        }}
      >
        <Icon icon="notification" size="l" alt={t`Notifications`} />
      </Link>
      <NotificationsMenu
        state={menuState}
        anchorRef={notificationLinkRef}
        onClose={() => setMenuState(undefined)}
      />
    </>
  );
}

const NOTIFICATIONS_DISPLAY_LIMIT = 5;
const NOTIFICATIONS_MENU_LIMIT = 80;
function NotificationsMenu({ anchorRef, state, onClose }) {
  const { masto, instance } = api();
  const snapStates = useSnapshot(states);
  const [uiState, setUIState] = useState('default');

  // Other-network accounts' notifications merged in, same setting and pattern
  // as the notifications page and merged home timeline
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

  async function fetchNotifications() {
    const merged = otherSources.current?.length > 0;
    let allNotifications;
    if (merged) {
      // Merged mode uses v1 notifications on every source so the shapes
      // interleave; grouping happens client-side
      const notificationsIterator = createMergedTimelineIterator([
        {
          instance,
          makeIterator: () =>
            masto.v1.notifications
              .list({ limit: NOTIFICATIONS_MENU_LIMIT })
              .values(),
        },
        ...otherSources.current.map(
          ({ masto: otherMasto, instance: otherInstance }) => ({
            instance: otherInstance,
            makeIterator: () =>
              otherMasto.v1.notifications
                .list({ limit: NOTIFICATIONS_MENU_LIMIT })
                .values(),
          }),
        ),
      ]);
      allNotifications = await notificationsIterator.next(
        NOTIFICATIONS_MENU_LIMIT,
      );
    } else {
      allNotifications = await mastoFetchNotifications().next();
    }
    const notifications = massageNotifications2(allNotifications.value);

    if (notifications?.length) {
      notifications.forEach((notification) => {
        saveStatus(notification.status, notification._instance || instance, {
          skipThreading: true,
        });
      });

      const groupedNotifications = merged
        ? groupNotifications(notifications)
        : getGroupedNotifications(notifications);

      // Must be an ID from the current account's own notifications, not
      // another network's — used both for the read marker below and for
      // notificationsLast, which the background badge check polls the current
      // account with as `sinceId`. A foreign id there makes that poll misfire
      // and light the bell with nothing new to show.
      const currentInstanceFirst = merged
        ? notifications.find((n) => !n._instance || n._instance === instance)
        : groupedNotifications[0];

      states.notificationsLast = currentInstanceFirst || groupedNotifications[0];
      states.notifications = groupedNotifications;

      if (currentInstanceFirst?.id) {
        masto.v1.markers
          .create({
            notifications: {
              lastReadId: currentInstanceFirst.id,
            },
          })
          .catch(() => {});
      }
    }

    states.notificationsShowNew = false;
    states.notificationsLastFetchTime = Date.now();
    return allNotifications;
  }

  const [hasFollowRequests, setHasFollowRequests] = useState(false);
  function fetchFollowRequests() {
    return masto.v1.followRequests.list({
      limit: 1,
    });
  }

  function loadNotifications({ skipFollowRequests = false } = {}) {
    setUIState('loading');
    (async () => {
      try {
        await fetchNotifications();
        if (!skipFollowRequests) {
          const followRequests = await fetchFollowRequests();
          setHasFollowRequests(!!followRequests?.length);
        }
        setUIState('default');
      } catch (e) {
        setUIState('error');
      }
    })();
  }

  const menuRef = useRef();
  const headerHeight = 52;
  useEffect(() => {
    if (state !== 'open') return;
    if (snapStates.notificationsShowNew) {
      const menuElement = menuRef.current;
      if (menuElement?.scrollTop <= headerHeight) {
        loadNotifications({
          skipFollowRequests: true,
        });
      }
    } else {
      loadNotifications();
    }
  }, [state, snapStates.notificationsShowNew]);

  return (
    <ControlledMenu
      ref={menuRef}
      menuClassName="notifications-menu"
      state={state}
      anchorRef={anchorRef}
      onClose={onClose}
      portal={{
        target: document.body,
      }}
      containerProps={{
        onClick: () => {
          menuRef.current?.closeMenu?.();
        },
      }}
      overflow="auto"
      viewScroll="close"
      position="anchor"
      align="center"
      boundingBoxPadding="8 8 8 8"
    >
      <header>
        <h2>
          <Trans>Notifications</Trans>
        </h2>
      </header>
      <FilterContext.Provider value="notifications">
        <main>
          {snapStates.notifications.length ? (
            <>
              {snapStates.notifications
                // "Only direct responses" preference: keep replies/mentions,
                // drop quotes/reposts/likes/follows (both networks).
                .filter(
                  (n) =>
                    !snapStates.settings.notificationsResponsesOnly ||
                    isDirectResponse(n),
                )
                .slice(0, NOTIFICATIONS_DISPLAY_LIMIT)
                .map((notification) => (
                  <Notification
                    key={notification._ids || notification.id}
                    instance={notification._instance || instance}
                    notification={notification}
                    disableContextMenu
                  />
                ))}
            </>
          ) : uiState === 'loading' ? (
            <div class="ui-state">
              <Loader abrupt />
            </div>
          ) : (
            uiState === 'error' && (
              <div class="ui-state">
                <p>
                  <Trans>Unable to fetch notifications.</Trans>
                </p>
                <p>
                  <button type="button" onClick={loadNotifications}>
                    <Trans>Try again</Trans>
                  </button>
                </p>
              </div>
            )
          )}
        </main>
      </FilterContext.Provider>
      <footer>
        <Link to="/mentions" class="button plain">
          <Icon icon="at" />{' '}
          <span>
            <Trans>Mentions</Trans>
          </span>
        </Link>
        <Link to="/messages" class="button plain">
          <Icon icon="message" />{' '}
          <span>
            <Trans>Messages</Trans>
          </span>
        </Link>
        <Link to="/notifications" class="button plain2">
          {hasFollowRequests ? (
            <Trans>
              <span class="tag collapsed">New</span>{' '}
              <span>Follow Requests</span>
            </Trans>
          ) : (
            <b>
              <Trans>See all</Trans>
            </b>
          )}{' '}
          <Icon icon="arrow-right" />
        </Link>
      </footer>
    </ControlledMenu>
  );
}

export default memo(Home);
