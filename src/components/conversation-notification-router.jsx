import { useEffect } from 'preact/hooks';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useSnapshot } from 'valtio';

import { api } from '../utils/api';
import states from '../utils/states';

import Loader from './loader';

// Conversation mode's stand-in for NotificationService. A tapped push notice
// reaches the app in one of two ways: the service worker opens
// `/notifications?id=…&access_token=…` (no window was open), or it posts a
// message that sets `states.routeNotification` (a window was open). Either way
// the notice knows only the notification ID, so this fetches the notification
// and opens the thread of its post.
export function ConversationNotificationRouter() {
  const { routeNotification } = useSnapshot(states);
  const navigate = useNavigate();

  useEffect(() => {
    const { id, accessToken } = routeNotification || {};
    if (!id || !accessToken) return;
    states.routeNotification = null;
    (async () => {
      let to = '/conversations';
      try {
        const { masto, instance } = api({ accessToken });
        const notification = await masto.v1.notifications.$select(id).fetch();
        const status = notification?.status;
        if (status?.id && status.visibility !== 'direct') {
          to = `/conversations/${instance}/${status.id}`;
        }
      } catch (e) {
        console.error(e);
      }
      navigate(to, { replace: true });
    })();
  }, [routeNotification]);

  return null;
}

// The `/notifications` route in conversation mode: hands a notice's ID to the
// router above, or goes to the list when there is none.
export function ConversationNotificationRoute() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = searchParams.get('id');
  const token = searchParams.get('access_token');

  useEffect(() => {
    if (!id || !token) return;
    try {
      states.routeNotification = { id, accessToken: atob(token) };
    } catch (e) {
      console.error(e);
      navigate('/conversations', { replace: true });
    }
  }, [id, token]);

  if (!id || !token) return <Navigate to="/conversations" replace />;
  return <Loader id="loader-root" />;
}
