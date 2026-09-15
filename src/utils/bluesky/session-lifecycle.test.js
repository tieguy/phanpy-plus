// Session lifecycle for the Bluesky client: resuming from the *stored*
// session, gating retries on terminally-dead refresh tokens, reviving when a
// newer token appears (other tab, fresh login), and adopting cross-tab token
// rotations without a network round-trip.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const atproto = vi.hoisted(() => {
  const state = { agents: [], nextResumeImpl: null };
  class FakeAtpAgent {
    constructor({ persistSession }) {
      this.persistSession = persistSession;
      this.session = undefined;
      this.resumeCalls = [];
      // Default: resume succeeds and persists an update, like the real
      // AtpAgent (whose resumeSession force-refreshes)
      this.resumeImpl =
        state.nextResumeImpl ||
        (async (session) => {
          this.session = { ...session };
          this.persistSession?.('update', this.session);
        });
      state.nextResumeImpl = null;
      this.sessionManager = this; // mirrors AtpAgent's session proxying
      state.agents.push(this);
    }
    get hasSession() {
      return !!this.session;
    }
    async resumeSession(session) {
      this.resumeCalls.push(session);
      return this.resumeImpl(session);
    }
    // Simulate a mid-session refresh failure (revoked/expired refresh token)
    expireInFlight() {
      this.session = undefined;
      this.persistSession?.('expired', undefined);
    }
  }
  return { state, FakeAtpAgent };
});

const oauth = vi.hoisted(() => ({
  deletedCallbacks: new Set(),
  updatedCallbacks: new Set(),
  restoreImpl: null,
  resets: 0,
}));

vi.mock('@atproto/api', () => ({
  AtpAgent: atproto.FakeAtpAgent,
  Agent: class {},
  RichText: class {},
}));

vi.mock('./oauth', () => ({
  restoreOAuthSession: (did) => oauth.restoreImpl(did),
  resetOAuthClient: async () => {
    oauth.resets++;
  },
  onOAuthSessionDeleted: (cb) => {
    oauth.deletedCallbacks.add(cb);
    return () => oauth.deletedCallbacks.delete(cb);
  },
  onOAuthSessionUpdated: (cb) => {
    oauth.updatedCallbacks.add(cb);
    return () => oauth.updatedCallbacks.delete(cb);
  },
}));

import { createBlueskyClient } from './client';

const DID = 'did:plc:test';

function sess(refreshJwt) {
  return {
    did: DID,
    handle: 'test.bsky.social',
    accessJwt: `access-${refreshJwt}`,
    refreshJwt,
    active: true,
  };
}

function makeClient(overrides = {}) {
  return createBlueskyClient({
    service: 'https://bsky.social',
    instance: 'bsky.social',
    did: DID,
    authType: 'password',
    ...overrides,
  });
}

beforeEach(() => {
  atproto.state.agents.length = 0;
  atproto.state.nextResumeImpl = null;
  oauth.deletedCallbacks.clear();
  oauth.updatedCallbacks.clear();
  oauth.restoreImpl = null;
  oauth.resets = 0;
});

describe('password session lifecycle', () => {
  it('resumes from the stored session, not the creation-time snapshot', async () => {
    const stored = { current: sess('R2') };
    const client = makeClient({
      session: sess('R1'),
      getStoredSession: () => stored.current,
    });
    await client._ready();
    const [agent] = atproto.state.agents;
    expect(agent.resumeCalls).toHaveLength(1);
    expect(agent.resumeCalls[0].refreshJwt).toBe('R2');
  });

  it('persists rotations and does not retry a terminally-dead token', async () => {
    const stored = { current: sess('R1') };
    const onSessionChange = vi.fn();
    const onAuthExpired = vi.fn();
    const client = makeClient({
      session: stored.current,
      getStoredSession: () => stored.current,
      onSessionChange,
      onAuthExpired,
    });
    await client._ready();
    expect(onSessionChange).toHaveBeenCalledTimes(1);

    // Refresh token dies mid-session; store still has the same dead token
    const [agent] = atproto.state.agents;
    agent.expireInFlight();
    expect(onAuthExpired).toHaveBeenCalledTimes(1);

    // Subsequent calls fail fast without hammering resumeSession
    await expect(client._ready()).rejects.toThrow(/session has expired/i);
    await expect(client._ready()).rejects.toThrow(/session has expired/i);
    expect(agent.resumeCalls).toHaveLength(1);
  });

  it('revives when a newer token lands in the store', async () => {
    const stored = { current: sess('R1') };
    const client = makeClient({
      session: stored.current,
      getStoredSession: () => stored.current,
    });
    await client._ready();
    const [agent] = atproto.state.agents;
    agent.expireInFlight();
    await expect(client._ready()).rejects.toThrow(/session has expired/i);

    // Another tab (or a fresh login) persisted a rotation
    stored.current = sess('R2');
    await client._ready();
    expect(agent.resumeCalls).toHaveLength(2);
    expect(agent.resumeCalls[1].refreshJwt).toBe('R2');
    expect(agent.hasSession).toBe(true);
  });

  it('does not mark auth expired when the store already holds a newer token', async () => {
    const stored = { current: sess('R1') };
    const onAuthExpired = vi.fn();
    const client = makeClient({
      session: stored.current,
      getStoredSession: () => stored.current,
      onAuthExpired,
    });
    await client._ready();
    // Store rotated (by another tab) before the in-memory session died
    stored.current = sess('R2');
    atproto.state.agents[0].expireInFlight();
    expect(onAuthExpired).not.toHaveBeenCalled();
  });

  it('adopts cross-tab rotations without a network call and clears the dead marker', async () => {
    const stored = { current: sess('R1') };
    const client = makeClient({
      session: stored.current,
      getStoredSession: () => stored.current,
    });
    await client._ready();
    const [agent] = atproto.state.agents;
    agent.expireInFlight();
    await expect(client._ready()).rejects.toThrow(/session has expired/i);

    stored.current = sess('R2');
    client.adoptSession(stored.current);
    expect(agent.session.refreshJwt).toBe('R2');
    // Adopted session means ready() is satisfied without resuming again
    await client._ready();
    expect(agent.resumeCalls).toHaveLength(1);
  });

  it('fails terminally when resume itself rejects with a revoked token', async () => {
    const stored = { current: sess('R1') };
    const onAuthExpired = vi.fn();
    // Resume fails like the real agent does on a revoked refresh token:
    // fires 'expired' (session cleared), then rejects
    atproto.state.nextResumeImpl = async function () {
      this.session = undefined;
      this.persistSession?.('expired', undefined);
      throw new Error('ExpiredToken');
    };
    const client = makeClient({
      session: stored.current,
      getStoredSession: () => stored.current,
      onAuthExpired,
    });
    await expect(client._ready()).rejects.toThrow('ExpiredToken');
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    // Same dead token still in the store → fail fast, no resume retry
    await expect(client._ready()).rejects.toThrow(/session has expired/i);
    expect(atproto.state.agents[0].resumeCalls).toHaveLength(1);
  });
});

describe('oauth session lifecycle', () => {
  const emitDeleted = (did = DID) => {
    for (const cb of oauth.deletedCallbacks) cb(did);
  };
  const emitUpdated = (did = DID) => {
    for (const cb of oauth.updatedCallbacks) cb(did);
  };

  it('marks auth expired when the deletion event fires during a failed restore', async () => {
    const onAuthExpired = vi.fn();
    const onSessionDeleted = vi.fn();
    oauth.restoreImpl = async (did) => {
      // The library announces the deletion mid-restore (revoked session /
      // deleted by another tab), then rejects — the subscription must
      // already be in place to catch it
      emitDeleted(did);
      throw new Error('The session was deleted by another process');
    };
    const client = makeClient({
      authType: 'oauth',
      onAuthExpired,
      onSessionDeleted,
    });
    await expect(client._ready()).rejects.toThrow();
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    expect(onSessionDeleted).toHaveBeenCalledTimes(1);
    // Now terminally dead: fails fast with the friendly message
    await expect(client._ready()).rejects.toThrow(/session has expired/i);
    // A first-ever restore never rebuilds the OAuth client
    expect(oauth.resets).toBe(0);
  });

  it('ignores deletion events for other accounts', async () => {
    const onAuthExpired = vi.fn();
    oauth.restoreImpl = async () => ({ did: DID });
    const client = makeClient({ authType: 'oauth', onAuthExpired });
    await client._ready();
    emitDeleted('did:plc:someone-else');
    expect(onAuthExpired).not.toHaveBeenCalled();
    await client._ready(); // still fine
    expect(oauth.resets).toBe(0);
  });

  it('reports a working restore so a stale expired flag can clear', async () => {
    const onSessionRestored = vi.fn();
    oauth.restoreImpl = async () => ({ did: DID });
    const client = makeClient({ authType: 'oauth', onSessionRestored });
    await client._ready();
    expect(onSessionRestored).toHaveBeenCalledTimes(1);
  });

  it('a deletion event alone does not expire a session that still restores', async () => {
    // The library emits "deleted" when it merely failed to *read* the store
    // (dead IndexedDB connection after the page was suspended), or relays
    // another tab's read failure — the stored tokens are fine
    const onAuthExpired = vi.fn();
    const onSessionDeleted = vi.fn();
    const onSessionRestored = vi.fn();
    const restores = [];
    oauth.restoreImpl = async (did) => {
      restores.push(did);
      return { did: DID };
    };
    const client = makeClient({
      authType: 'oauth',
      onAuthExpired,
      onSessionDeleted,
      onSessionRestored,
    });
    await client._ready();
    expect(restores).toHaveLength(1);

    emitDeleted();
    expect(onAuthExpired).not.toHaveBeenCalled();
    expect(onSessionDeleted).not.toHaveBeenCalled();

    // Next call re-checks: fresh OAuth client (fresh IndexedDB connection),
    // restore succeeds, account reported alive
    await client._ready();
    expect(oauth.resets).toBe(1);
    expect(restores).toHaveLength(2);
    expect(onAuthExpired).not.toHaveBeenCalled();
    expect(onSessionDeleted).not.toHaveBeenCalled();
    expect(onSessionRestored).toHaveBeenCalledTimes(2);

    // Settled: no further re-check without another event
    await client._ready();
    expect(oauth.resets).toBe(1);
    expect(restores).toHaveLength(2);
  });

  it('expires when the re-check after a deletion event fails the same way', async () => {
    const onAuthExpired = vi.fn();
    const onSessionDeleted = vi.fn();
    let alive = true;
    oauth.restoreImpl = async (did) => {
      if (alive) return { did: DID };
      emitDeleted(did);
      throw new Error('The session was deleted by another process');
    };
    const client = makeClient({
      authType: 'oauth',
      onAuthExpired,
      onSessionDeleted,
    });
    await client._ready();

    // Genuinely revoked: the event fires, and the re-check finds no session
    alive = false;
    emitDeleted();
    await expect(client._ready()).rejects.toThrow(/deleted by another/);
    expect(oauth.resets).toBe(1);
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    expect(onSessionDeleted).toHaveBeenCalledTimes(1);
    await expect(client._ready()).rejects.toThrow(/session has expired/i);
  });

  it('a transient failure during the re-check does not expire the session', async () => {
    const onAuthExpired = vi.fn();
    let fail = false;
    oauth.restoreImpl = async () => {
      if (fail) throw new Error('Load failed'); // network, no deletion event
      return { did: DID };
    };
    const client = makeClient({ authType: 'oauth', onAuthExpired });
    await client._ready();
    emitDeleted();
    fail = true;
    await expect(client._ready()).rejects.toThrow('Load failed');
    expect(onAuthExpired).not.toHaveBeenCalled();
    // Recovers on the next call
    fail = false;
    await client._ready();
    expect(onAuthExpired).not.toHaveBeenCalled();
  });

  it('a deletion event mid-restore does not start a second, parallel restore', async () => {
    let release;
    const restores = [];
    oauth.restoreImpl = async (did) => {
      restores.push(did);
      // Only the first restore is held open
      if (restores.length === 1) await new Promise((r) => (release = r));
      return { did: DID };
    };
    const client = makeClient({ authType: 'oauth' });
    const first = client._ready();
    // Let the flow get past its lazy imports and into restoreOAuthSession
    while (restores.length === 0) await new Promise((r) => setTimeout(r, 0));

    emitDeleted();
    const second = client._ready(); // joins the in-flight restore
    expect(restores).toHaveLength(1);
    expect(oauth.resets).toBe(0);

    release();
    await first;
    await second;
    // The event is honoured on the next call: one re-check, one reset
    await client._ready();
    expect(restores).toHaveLength(2);
    expect(oauth.resets).toBe(1);
  });

  it('a token refresh anywhere reports the session as working', async () => {
    const onSessionRestored = vi.fn();
    oauth.restoreImpl = async () => ({ did: DID });
    const client = makeClient({ authType: 'oauth', onSessionRestored });
    await client._ready();
    onSessionRestored.mockClear();
    emitUpdated();
    expect(onSessionRestored).toHaveBeenCalledTimes(1);
    emitUpdated('did:plc:someone-else');
    expect(onSessionRestored).toHaveBeenCalledTimes(1);
  });
});
