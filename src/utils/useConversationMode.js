import { useEffect, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import { isFullAppOpen, nextChange } from './conversation-schedule';
import states from './states';
import store from './store';

// Dev builds show the full app at any time of day, so that local work and the
// Playwright specs do not depend on the clock. localStorage
// `conversationModeOverride` changes that: 'on' forces conversation mode and
// 'schedule' follows FULL_APP_WINDOWS. Production builds ignore it.
function devOverride() {
  if (!import.meta.env.DEV) return null;
  const value = store.local.get('conversationModeOverride');
  if (value === 'on') return false;
  if (value === 'schedule') return null;
  return true;
}

function fullAppOpenNow() {
  return devOverride() ?? isFullAppOpen(new Date());
}

// True while the app is in conversation mode. Re-evaluates at the next
// schedule edge and whenever the page becomes visible again (timers do not
// fire on a sleeping device). Entering conversation mode waits until the
// composer is closed, so a window that closes mid-draft does not pull the
// page out from under it.
export default function useConversationMode() {
  const [fullAppOpen, setFullAppOpen] = useState(fullAppOpenNow);
  const { showCompose } = useSnapshot(states);
  const [conversationMode, setConversationMode] = useState(!fullAppOpen);

  useEffect(() => {
    let timer;
    function update() {
      clearTimeout(timer);
      setFullAppOpen(fullAppOpenNow());
      const next = nextChange(new Date());
      if (next) timer = setTimeout(update, next - Date.now() + 1000);
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') update();
    }
    update();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (fullAppOpen) setConversationMode(false);
    else if (!showCompose) setConversationMode(true);
  }, [fullAppOpen, showCompose]);

  return conversationMode;
}
