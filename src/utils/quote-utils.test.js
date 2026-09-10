import { beforeEach, describe, expect, it, vi } from 'vitest';

// Both dependencies reach into the account store / localStorage, so they are
// stubbed: these tests are about which instance the capability check reads.
vi.mock('./bluesky', () => ({
  isBlueskyInstance: (instance) => blueskyInstances.has(instance),
}));
vi.mock('./store-utils', () => ({
  getCurrentInstance: () => currentInstance,
  getAPIVersions: (instance) =>
    (instance
      ? apiVersionsByInstance[instance]
      : currentInstance?.apiVersions) || {},
}));

let blueskyInstances;
let currentInstance;
let apiVersionsByInstance;

const { supportsNativeQuote } = await import('./quote-utils');

describe('supportsNativeQuote', () => {
  beforeEach(() => {
    blueskyInstances = new Set(['bsky.social']);
    apiVersionsByInstance = {
      'mastodon.social': { mastodon: 7 },
      'old.example': { mastodon: 5 },
    };
    currentInstance = null;
  });

  it('is true for a Bluesky post whatever account is current', () => {
    currentInstance = { apiVersions: { mastodon: 5 } };
    expect(supportsNativeQuote('bsky.social')).toBe(true);
  });

  it('reads the named Mastodon instance, not the current account', () => {
    // Current account is Bluesky: it has no Mastodon apiVersions at all.
    currentInstance = { _bluesky: true };
    expect(supportsNativeQuote('mastodon.social')).toBe(true);
    expect(supportsNativeQuote('old.example')).toBe(false);
  });

  it('falls back to the current instance when none is named', () => {
    currentInstance = { apiVersions: { mastodon: 7 } };
    expect(supportsNativeQuote()).toBe(true);
    currentInstance = { apiVersions: { mastodon: 5 } };
    expect(supportsNativeQuote()).toBe(false);
    currentInstance = { _bluesky: true };
    expect(supportsNativeQuote()).toBe(true);
  });
});
