import { useLingui } from '@lingui/react/macro';
import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useHotkeys } from 'react-hotkeys-hook';

import { api } from '../utils/api';
import { useAuth } from '../utils/auth-context';
import {
  hasNewDirectResponse,
  isDirectResponse,
} from '../utils/notification-filter';
import showToast from '../utils/show-toast';
import states, { saveStatus } from '../utils/states';
import useInterval from '../utils/useInterval';
import usePageVisibility from '../utils/usePageVisibility';

const STREAMING_TIMEOUT = 1000 * 3; // 3 seconds
const POLL_INTERVAL = 20_000; // 20 seconds
// When "only direct responses" is on we must look past non-response
// notifications (likes/reposts/follows) that may sit atop the list, so fetch a
// batch instead of just the latest one before deciding whether to light the bell.
const NOTIFICATIONS_BADGE_LIMIT = 30;

export default memo(function BackgroundService() {
  const isLoggedIn = useAuth();
  const { t } = useLingui();

  // Notifications service
  // - WebSocket to receive notifications when page is visible
  const [visible, setVisible] = useState(true);
  const visibleTimeout = useRef();
  usePageVisibility((visible) => {
    clearTimeout(visibleTimeout.current);
    if (visible) {
      setVisible(true);
    } else {
      visibleTimeout.current = setTimeout(() => {
        setVisible(false);
      }, POLL_INTERVAL);
    }
  });

  const checkLatestNotification = async (masto, instance, skipCheckMarkers) => {
    if (!states.notificationsLast) return;

    // "Only direct responses" path: the bell must light only for a reply/mention
    // that is genuinely newer than what the user last saw. We can't rely on a
    // server sinceId cursor here — the Bluesky facade ignores it — so fetch a
    // batch and compare createdAt against states.notificationsLast client-side.
    // (A per-subtype timestamp check, not a whole-stream read marker, so
    // likes/reposts/follows never light the bell.)
    if (states.settings.notificationsResponsesOnly) {
      const notificationsIterator = masto.v1.notifications
        .list({ limit: NOTIFICATIONS_BADGE_LIMIT })
        .values();
      const { value: notifications } = await notificationsIterator.next();
      if (
        hasNewDirectResponse(notifications, states.notificationsLast.createdAt)
      ) {
        states.notificationsShowNew = true;
      }
      return;
    }

    // Default path (all notification types): unchanged — rely on server sinceId.
    const notificationsIterator = masto.v1.notifications
      .list({
        limit: 1,
        sinceId: states.notificationsLast.id,
      })
      .values();
    const { value: notifications } = await notificationsIterator.next();
    if (notifications?.length) {
      if (skipCheckMarkers) {
        states.notificationsShowNew = true;
      } else {
        let lastReadId;
        try {
          const markers = await masto.v1.markers.fetch({
            timeline: 'notifications',
          });
          lastReadId = markers?.notifications?.lastReadId;
        } catch (e) {}
        if (lastReadId) {
          states.notificationsShowNew = notifications[0].id !== lastReadId;
        } else {
          states.notificationsShowNew = true;
        }
      }
    }
  };

  useEffect(() => {
    let sub;
    let streamTimeout;
    let pollNotifications;
    let cancelled = false;
    if (isLoggedIn && visible) {
      const { masto, streaming, instance } = api();
      (async () => {
        // 1. Get the latest notification
        await checkLatestNotification(masto, instance);

        const startPolling = () => {
          if (cancelled) return;
          console.log('🎏 Fallback to polling');
          pollNotifications = setInterval(() => {
            checkLatestNotification(masto, instance, true);
          }, POLL_INTERVAL);
        };

        // 2. Start streaming or fall back to polling
        if (streaming) {
          streamTimeout = setTimeout(() => {
            (async () => {
              try {
                sub = streaming.user.notification.subscribe();
                console.log('🎏 Streaming notification', sub);
                for await (const entry of sub) {
                  if (cancelled || !sub) break;
                  console.log('🔔🔔 Notification entry', entry);
                  if (entry.event === 'notification') {
                    console.log('🔔🔔 Notification', entry);
                    saveStatus(entry.payload, instance, {
                      skipThreading: true,
                    });
                    // Only replies/mentions light the bell when "only direct
                    // responses" is on.
                    if (
                      !states.settings.notificationsResponsesOnly ||
                      isDirectResponse(entry.payload)
                    ) {
                      states.notificationsShowNew = true;
                    }
                  } else {
                    states.notificationsShowNew = true;
                  }
                }
                console.log('💥 Streaming notification loop STOPPED');
              } catch (e) {
                console.error('💥 Streaming error', e);
              }

              startPolling();
            })();
          }, STREAMING_TIMEOUT);
        } else {
          console.log('🎏 No streaming available, polling directly');
          startPolling();
        }
      })();
    }
    return () => {
      cancelled = true;
      sub?.unsubscribe?.();
      sub = null;
      clearTimeout(streamTimeout);
      clearInterval(pollNotifications);
    };
  }, [visible, isLoggedIn]);

  // Check for updates service
  const lastCheckDate = useRef();
  const checkForUpdates = () => {
    lastCheckDate.current = Date.now();
    console.log('✨ Check app update');
    fetch('./version.json')
      .then((r) => r.json())
      .then((info) => {
        if (info) states.appVersion = info;
      })
      .catch((e) => {
        console.error(e);
      });
  };
  useInterval(checkForUpdates, visible && 1000 * 60 * 30); // 30 minutes
  usePageVisibility((visible) => {
    if (visible) {
      if (!lastCheckDate.current) {
        checkForUpdates();
      } else {
        const diff = Date.now() - lastCheckDate.current;
        if (diff > 1000 * 60 * 60) {
          // 1 hour
          checkForUpdates();
        }
      }
    }
  });

  // Global keyboard shortcuts "service"
  useHotkeys(
    'shift+alt+k',
    (e) => {
      // Need modifers check due to useKey: true
      if (!e.shiftKey || !e.altKey) return;

      const currentCloakMode = states.settings.cloakMode;
      states.settings.cloakMode = !currentCloakMode;
      showToast({
        text: currentCloakMode ? t`Cloak mode disabled` : t`Cloak mode enabled`,
      });
    },
    {
      ignoreEventWhen: (e) => e.metaKey || e.ctrlKey,
    },
  );

  return null;
});
