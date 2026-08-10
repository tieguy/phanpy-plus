import { describe, expect, it } from 'vitest';

import { buildCrossSegments, canCrossPost, publishThread } from './publish';

function fakeClient({ failAtCall } = {}) {
  const calls = [];
  return {
    calls,
    v1: {
      statuses: {
        create: async (params, opts) => {
          if (calls.length === failAtCall) {
            calls.push({ params, opts, failed: true });
            throw new Error('boom');
          }
          calls.push({ params, opts });
          return { id: `id-${calls.length - 1}`, ...params };
        },
      },
    },
    v2: { media: { create: async () => ({ id: 'uploaded-1' }) } },
  };
}

function fakeBlueskyClient() {
  const threadCalls = [];
  return {
    threadCalls,
    v1: {
      statuses: {
        create: async () => {
          throw new Error('should not be called for multi-segment');
        },
        createThread: async (paramsList) => {
          threadCalls.push(paramsList);
          return paramsList.map((p, i) => ({ id: `bsky-${i}`, ...p }));
        },
      },
    },
    v2: { media: { create: async () => ({ id: 'uploaded-1' }) } },
  };
}

const segments3 = [{ text: 'one' }, { text: 'two' }, { text: 'three' }];

describe('canCrossPost', () => {
  it('allows public/unlisted without poll or schedule', () => {
    expect(canCrossPost({ visibility: 'public' })).toBe(true);
    expect(canCrossPost({ visibility: 'unlisted' })).toBe(true);
  });
  it('rejects polls, schedules, and non-public', () => {
    expect(canCrossPost({ poll: {}, visibility: 'public' })).toBe(false);
    expect(canCrossPost({ scheduledAt: 'x', visibility: 'public' })).toBe(
      false,
    );
    expect(canCrossPost({ visibility: 'private' })).toBe(false);
    expect(canCrossPost({ visibility: 'direct' })).toBe(false);
  });
});

describe('publishThread sequential chaining', () => {
  it('chains each segment as a reply to the previous', async () => {
    const client = fakeClient();
    const { statuses, failedAtIndex } = await publishThread({
      masto: client,
      segments: segments3,
      shared: { visibility: 'public' },
    });
    expect(failedAtIndex).toBe(null);
    expect(statuses).toHaveLength(3);
    expect(client.calls[0].params.in_reply_to_id).toBe(undefined);
    expect(client.calls[1].params.in_reply_to_id).toBe('id-0');
    expect(client.calls[2].params.in_reply_to_id).toBe('id-1');
  });

  it('starts the chain at shared.inReplyToId (thread-as-reply)', async () => {
    const client = fakeClient();
    await publishThread({
      masto: client,
      segments: segments3,
      shared: { inReplyToId: 'root-99' },
    });
    expect(client.calls[0].params.in_reply_to_id).toBe('root-99');
    expect(client.calls[1].params.in_reply_to_id).toBe('id-0');
  });

  it('sends per-segment idempotency keys (prefix, prefix-1, …)', async () => {
    const client = fakeClient();
    await publishThread({
      masto: client,
      segments: segments3,
      idempotencyPrefix: 'UID',
    });
    const keys = client.calls.map(
      (c) => c.opts?.requestInit?.headers?.['Idempotency-Key'],
    );
    expect(keys).toEqual(['UID', 'UID-1', 'UID-2']);
  });

  it('puts scheduled_at and quoted_status_id only on the first segment', async () => {
    const client = fakeClient();
    await publishThread({
      masto: client,
      segments: segments3,
      shared: { scheduledAt: '2030-01-01', quotedStatusId: 'q1' },
    });
    expect(client.calls[0].params.scheduled_at).toBe('2030-01-01');
    expect(client.calls[0].params.quoted_status_id).toBe('q1');
    expect(client.calls[1].params.scheduled_at).toBe(undefined);
    expect(client.calls[1].params.quoted_status_id).toBe(undefined);
  });
});

describe('publishThread partial failure and resume', () => {
  it('reports failedAtIndex and keeps earlier statuses', async () => {
    const client = fakeClient({ failAtCall: 1 });
    const { statuses, failedAtIndex, error } = await publishThread({
      masto: client,
      segments: segments3,
    });
    expect(statuses).toHaveLength(1);
    expect(failedAtIndex).toBe(1);
    expect(error.message).toBe('boom');
  });

  it('resumes from startAt, chaining to resumeInReplyToId, with stable keys', async () => {
    const client = fakeClient();
    const { statuses, failedAtIndex } = await publishThread({
      masto: client,
      segments: segments3,
      startAt: 1,
      resumeInReplyToId: 'id-from-before',
      idempotencyPrefix: 'UID',
    });
    expect(failedAtIndex).toBe(null);
    expect(statuses).toHaveLength(2);
    expect(client.calls[0].params.status).toBe('two');
    expect(client.calls[0].params.in_reply_to_id).toBe('id-from-before');
    // Segment 1 keeps ITS key on retry — not renumbered from the resume point
    expect(
      client.calls[0].opts?.requestInit?.headers?.['Idempotency-Key'],
    ).toBe('UID-1');
    // Resumed run must not re-send first-segment-only fields
    expect(client.calls[0].params.scheduled_at).toBe(undefined);
  });

  it('reports progress per segment', async () => {
    const events = [];
    await publishThread({
      masto: fakeClient({ failAtCall: 2 }),
      segments: segments3,
      onProgress: (i, state) => events.push([i, state]),
    });
    expect(events).toEqual([
      [0, 'posting'],
      [0, 'done'],
      [1, 'posting'],
      [1, 'done'],
      [2, 'posting'],
      [2, 'failed'],
    ]);
  });
});

describe('publishThread atomic delegation (Bluesky facade)', () => {
  it('delegates multi-segment to createThread in one call', async () => {
    const client = fakeBlueskyClient();
    const { statuses, failedAtIndex } = await publishThread({
      masto: client,
      isBluesky: true,
      segments: segments3,
      shared: { inReplyToId: 'root-1' },
    });
    expect(failedAtIndex).toBe(null);
    expect(statuses).toHaveLength(3);
    expect(client.threadCalls).toHaveLength(1);
    const paramsList = client.threadCalls[0];
    expect(paramsList).toHaveLength(3);
    expect(paramsList[0].in_reply_to_id).toBe('root-1');
    expect(paramsList[1].in_reply_to_id).toBe(undefined);
    expect(paramsList.map((p) => p.status)).toEqual(['one', 'two', 'three']);
  });

  it('puts quoted_status_id only on the first segment (atomic path)', async () => {
    const client = fakeBlueskyClient();
    await publishThread({
      masto: client,
      isBluesky: true,
      segments: segments3,
      shared: { inReplyToId: 'root-1', quotedStatusId: 'q1' },
    });
    const paramsList = client.threadCalls[0];
    expect(paramsList[0].quoted_status_id).toBe('q1');
    expect(paramsList[1].quoted_status_id).toBe(undefined);
    expect(paramsList[2].quoted_status_id).toBe(undefined);
  });

  it('reports atomic failure as failedAtIndex 0 with no statuses', async () => {
    const client = fakeBlueskyClient();
    client.v1.statuses.createThread = async () => {
      throw new Error('applyWrites failed');
    };
    const { statuses, failedAtIndex } = await publishThread({
      masto: client,
      isBluesky: true,
      segments: segments3,
    });
    expect(statuses).toHaveLength(0);
    expect(failedAtIndex).toBe(0);
  });

  it('accumulates skippedMedia on atomic path (Bluesky video)', async () => {
    const client = fakeBlueskyClient();
    const segmentsWithMedia = [
      { text: 'first' },
      {
        text: 'second',
        mediaAttachments: [
          { fileName: 'video.mp4', type: 'video/mp4', fileData: 'd' },
        ],
      },
      { text: 'third' },
    ];
    const { statuses, skippedMedia } = await publishThread({
      masto: client,
      isBluesky: true,
      segments: segmentsWithMedia,
    });
    expect(statuses).toHaveLength(3);
    expect(skippedMedia).toContain('video.mp4');
  });

  it('collects onProgress events on atomic path', async () => {
    const client = fakeBlueskyClient();
    const events = [];
    await publishThread({
      masto: client,
      isBluesky: true,
      segments: segments3,
      onProgress: (i, state) => events.push([i, state]),
    });
    expect(events).toEqual([
      [0, 'posting'],
      [0, 'done'],
      [1, 'done'],
      [2, 'done'],
    ]);
  });

  it('single-segment Bluesky post uses create path, not createThread', async () => {
    const calls = [];
    const client = {
      threadCalls: [],
      v1: {
        statuses: {
          create: async (params) => {
            calls.push(params);
            return { id: `id-${calls.length - 1}`, ...params };
          },
          createThread: async () => {
            throw new Error('should not be called for single segment');
          },
        },
      },
      v2: { media: { create: async () => ({ id: 'uploaded-1' }) } },
    };
    const { statuses, failedAtIndex } = await publishThread({
      masto: client,
      isBluesky: true,
      segments: [{ text: 'single' }],
    });
    expect(failedAtIndex).toBe(null);
    expect(statuses).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('NEVER routes Mastodon threads to createThread, even though masto.js proxies make every method look present', async () => {
    // masto.js v7 clients are Proxy-based: unknown properties return a
    // callable proxy, so `typeof client.v1.statuses.createThread ===
    // 'function'` is TRUE on real Mastodon clients. Publishing must gate
    // on the explicit isBluesky flag, not method presence — otherwise
    // Mastodon threads 404 into POST /statuses/create_thread.
    const calls = [];
    const proxyStatuses = new Proxy(
      {},
      {
        get: (_, prop) => {
          if (prop === 'create') {
            return async (params, opts) => {
              calls.push({ params, opts });
              return { id: `id-${calls.length - 1}`, ...params };
            };
          }
          // Everything else "exists" as a callable, like real masto.js
          return async () => {
            throw new Error(`404: unknown endpoint ${String(prop)}`);
          };
        },
      },
    );
    const client = {
      v1: { statuses: proxyStatuses },
      v2: { media: { create: async () => ({ id: 'uploaded-1' }) } },
    };
    // Sanity: the trap this test guards against is real on this fake
    expect(typeof client.v1.statuses.createThread).toBe('function');
    const { statuses, failedAtIndex } = await publishThread({
      masto: client,
      isBluesky: false,
      segments: segments3,
    });
    expect(failedAtIndex).toBe(null);
    expect(statuses).toHaveLength(3);
    expect(calls).toHaveLength(3); // sequential path, one create per segment
  });
});

describe('buildCrossSegments', () => {
  it('builds cross-post segments from primary status and additional segments', () => {
    const media1 = { fileName: 'img1.jpg', fileData: 'data1' };
    const media2 = { fileName: 'img2.jpg', fileData: 'data2' };
    const media3 = { fileName: 'img3.jpg', fileData: 'data3' };

    const result = buildCrossSegments({
      status: 'first post',
      mediaAttachments: [media1],
      moreSegments: [
        { text: 'second post', mediaAttachments: [media2] },
        { text: 'third post', mediaAttachments: [media3] },
      ],
    });

    expect(result).toEqual([
      { text: 'first post', mediaAttachments: [media1], poll: undefined },
      { text: 'second post', mediaAttachments: [media2] },
      { text: 'third post', mediaAttachments: [media3] },
    ]);
  });

  it('handles empty moreSegments (single post)', () => {
    const media = { fileName: 'img.jpg', fileData: 'data' };
    const result = buildCrossSegments({
      status: 'single post',
      mediaAttachments: [media],
      moreSegments: [],
    });

    expect(result).toEqual([
      { text: 'single post', mediaAttachments: [media], poll: undefined },
    ]);
  });

  it('includes undefined poll in first segment only', () => {
    const result = buildCrossSegments({
      status: 'post with poll',
      mediaAttachments: [],
      moreSegments: [{ text: 'follow-up' }],
    });

    expect(result[0]).toHaveProperty('poll', undefined);
    expect(result[1]).not.toHaveProperty('poll');
  });
});
