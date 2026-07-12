// iOS/iPadOS Safari has no install prompt or install button — the only way to
// install a PWA there is Share → Add to Home Screen. This drives a small in-app
// hint so that's discoverable. Everything else (Android/desktop Chromium) gets
// the browser's own install affordance, so no hint is needed.

const DISMISS_KEY = 'iosInstallHintDismissed';

// Pure + testable: given the environment, should we show the iOS install hint?
export function shouldShowIOSInstallHint({
  userAgent = '',
  platform = '',
  maxTouchPoints = 0,
  standalone = false,
  dismissed = false,
} = {}) {
  if (standalone || dismissed) return false;
  const isIOSPhone = /iPad|iPhone|iPod/.test(userAgent);
  // iPadOS 13+ Safari reports as desktop Mac; distinguish by touch support.
  const isIPadOS = platform === 'MacIntel' && maxTouchPoints > 1;
  return isIOSPhone || isIPadOS;
}

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  );
}

// Runtime wrapper reading real globals + persisted dismissal.
export function isIOSInstallHintVisible() {
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(DISMISS_KEY) === '1';
  } catch {}
  return shouldShowIOSInstallHint({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: isStandalone(),
    dismissed,
  });
}

export function dismissIOSInstallHint() {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {}
}
