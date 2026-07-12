import './ios-install-hint.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'preact/hooks';

import {
  dismissIOSInstallHint,
  isIOSInstallHintVisible,
} from '../utils/pwa-install';

// iOS/iPadOS Safari never shows an install prompt — you install via
// Share → Add to Home Screen. This dismissible banner points the way.
export default function IOSInstallHint() {
  const { t } = useLingui();
  const [visible, setVisible] = useState(isIOSInstallHintVisible);
  if (!visible) return null;
  return (
    <div class="ios-install-hint" role="note">
      <span class="ios-install-hint-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 15V3.5m0 0L8.5 7M12 3.5 15.5 7M7.5 10.5H6A1.5 1.5 0 0 0 4.5 12v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5"
          />
        </svg>
      </span>
      <p class="ios-install-hint-text">
        <Trans>
          Install <b>Fleeting</b>: tap Share, then <b>Add to Home Screen</b>.
        </Trans>
      </p>
      <button
        type="button"
        class="ios-install-hint-close"
        onClick={() => {
          dismissIOSInstallHint();
          setVisible(false);
        }}
        aria-label={t`Dismiss`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            d="M6 6l12 12M18 6 6 18"
          />
        </svg>
      </button>
    </div>
  );
}
