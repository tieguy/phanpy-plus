// Switching an existing Bluesky account between auth modes. The account
// record carries `blueskyAuth`, which decides whether the client resumes from
// the OAuth token store or from the app-password refresh token — so a login in
// one mode must overwrite the marker left by the other.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ accounts: [], revoked: [] }));

vi.mock('../store', () => ({
  default: {
    local: { getJSON: () => ({}), setJSON: () => {} },
    session: { get: () => null, set: () => {}, del: () => {} },
  },
}));
vi.mock('../store-utils', () => ({
  getAccount: (id) => state.accounts.find((a) => a.info.id === id),
  getAccounts: () => state.accounts,
  getCurrentAccountID: () => null,
  mutateAccounts: (fn) => fn(state.accounts),
  saveAccounts: (accts) => {
    state.accounts = accts;
  },
  setCurrentAccountID: () => {},
}));
vi.mock('./convert', () => ({
  blueskyInstanceInfo: () => ({}),
  profileToAccount: (profile, instance) => ({
    id: profile.did,
    acct: profile.handle,
    _bluesky: true,
    _instance: instance,
  }),
  isBlueskyStatusID: () => false,
}));
vi.mock('./client', () => ({
  createBlueskyClient: () => ({}),
  loadAtproto: async () => ({
    AtpAgent: class {
      async login() {
        this.session = {
          did: DID,
          handle: 'test.bsky.social',
          accessJwt: 'access-1',
          refreshJwt: 'refresh-1',
        };
      }
      async getProfile() {
        return { data: { did: DID, handle: 'test.bsky.social' } };
      }
    },
    Agent: class {},
  }),
}));
vi.mock('./oauth', () => ({
  revokeOAuthSession: async (did) => {
    state.revoked.push(did);
  },
  initBlueskyOAuth: async () => null,
}));

const DID = 'did:plc:test';

const { loginBluesky } = await import('./index');

describe('loginBluesky over an existing OAuth account', () => {
  beforeEach(() => {
    state.accounts = [
      {
        info: { id: DID, acct: 'test.bsky.social' },
        instanceURL: 'bsky.social',
        accountType: 'bluesky',
        blueskyAuth: 'oauth',
        accessToken: 'oauth',
        blueskySession: null,
      },
    ];
    state.revoked = [];
  });

  it('marks the account as app-password auth', async () => {
    await loginBluesky({ identifier: 'test.bsky.social', password: 'pw' });
    const [account] = state.accounts;
    expect(account.blueskyAuth).toBe('password');
    expect(account.blueskySession?.refreshJwt).toBe('refresh-1');
  });

  it('revokes the superseded OAuth session', async () => {
    await loginBluesky({ identifier: 'test.bsky.social', password: 'pw' });
    await new Promise((r) => setTimeout(r, 0)); // revocation is fire-and-forget
    expect(state.revoked).toEqual([DID]);
  });
});
