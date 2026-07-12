import { describe, expect, it } from 'vitest';

import { shouldShowIOSInstallHint } from './pwa-install';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

describe('shouldShowIOSInstallHint', () => {
  it('shows on iPhone Safari when not installed and not dismissed', () => {
    expect(
      shouldShowIOSInstallHint({
        userAgent: IPHONE_SAFARI,
        standalone: false,
        dismissed: false,
      }),
    ).toBe(true);
  });

  it('shows on iPadOS (reports as MacIntel with touch points)', () => {
    expect(
      shouldShowIOSInstallHint({
        userAgent: MAC_SAFARI,
        platform: 'MacIntel',
        maxTouchPoints: 5,
        standalone: false,
        dismissed: false,
      }),
    ).toBe(true);
  });

  it('hides once installed (standalone)', () => {
    expect(
      shouldShowIOSInstallHint({ userAgent: IPHONE_SAFARI, standalone: true }),
    ).toBe(false);
  });

  it('hides after the user dismissed it', () => {
    expect(
      shouldShowIOSInstallHint({ userAgent: IPHONE_SAFARI, dismissed: true }),
    ).toBe(false);
  });

  it('hides on Android', () => {
    expect(shouldShowIOSInstallHint({ userAgent: ANDROID_CHROME })).toBe(false);
  });

  it('hides on a real desktop Mac (no touch points)', () => {
    expect(
      shouldShowIOSInstallHint({
        userAgent: MAC_SAFARI,
        platform: 'MacIntel',
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });

  it('hides with no environment info', () => {
    expect(shouldShowIOSInstallHint()).toBe(false);
  });
});
