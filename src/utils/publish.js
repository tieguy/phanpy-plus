// Network-agnostic thread publishing: posts 1..N segments to ONE target
// account/instance, chaining each segment as a reply to the previous.
// Absorbs the old bluesky/cross-post.js — a single post is a one-segment
// thread, and the primary post and cross-posts go through the same path.

// Cross-post eligibility for a draft. Single source of truth for the rules
// previously inlined twice in compose.jsx.
export function canCrossPost({ poll, scheduledAt, visibility }) {
  return (
    !poll &&
    !scheduledAt &&
    (visibility === 'public' || visibility === 'unlisted')
  );
}

// Build cross-post segments from primary status and additional segments.
// Polls are excluded (canCrossPost checks this), and we set poll: undefined
// on the first segment to match the contract.
export function buildCrossSegments({ status, mediaAttachments, moreSegments }) {
  const crossSegments = [
    {
      text: status,
      mediaAttachments,
      poll: undefined,
    },
  ];
  for (const segment of moreSegments || []) {
    crossSegments.push({
      text: segment.text,
      mediaAttachments: segment.mediaAttachments,
    });
  }
  return crossSegments;
}

function removeNullUndefined(obj) {
  for (const key in obj) {
    if (obj[key] === null || obj[key] === undefined) {
      delete obj[key];
    }
  }
  return obj;
}

async function createWithIdempotency(client, params, key) {
  if (!key) return await client.v1.statuses.create(params);
  try {
    return await client.v1.statuses.create(params, {
      requestInit: {
        headers: { 'Idempotency-Key': key },
      },
    });
  } catch (_) {
    // If idempotency key fails, try again without it (pre-existing
    // fallback behavior from compose.jsx)
    return await client.v1.statuses.create(params);
  }
}

// Upload a segment's media to the target when the composer hasn't already
// (cross-post targets, and later non-first thread segments).
async function resolveMediaIds({ client, isBluesky, segment }) {
  if (segment.mediaIds?.length) {
    return { mediaIds: segment.mediaIds, skippedMedia: [] };
  }
  const mediaIds = [];
  const skippedMedia = [];
  for (const attachment of segment.mediaAttachments || []) {
    const { fileData, fileName, type, description } = attachment;
    if (!fileData) {
      skippedMedia.push(fileName);
      continue;
    }
    if (isBluesky && !/^image\//.test(type)) {
      // Only images can cross-post to Bluesky for now
      skippedMedia.push(fileName);
      continue;
    }
    const file = new File([fileData], fileName || 'media', { type });
    const res = await client.v2.media.create({
      file,
      description: description || undefined,
    });
    if (res?.id) mediaIds.push(res.id);
  }
  return { mediaIds, skippedMedia };
}

export async function publishThread({
  account, // cross-post target account (other network) — omit for primary
  instance, // primary target instance string (used when no client given)
  masto, // pre-resolved client for the primary path (optional)
  isBluesky, // explicit network flag; derived from account/instance if omitted
  segments, // [{ text, mediaIds?, mediaAttachments?, poll? }]
  shared = {}, // { visibility, language, spoilerText, sensitive, inReplyToId, quotedStatusId, quoteApprovalPolicy, scheduledAt }
  idempotencyPrefix, // per-segment Idempotency-Key: prefix, prefix-1, prefix-2…
  startAt = 0, // resume support: first segment index to post
  resumeInReplyToId, // when resuming, id of the last successfully-posted status
  onProgress, // (segmentIndex, 'posting' | 'done' | 'failed') => void
}) {
  let client = masto;
  if (!client) {
    const { api } = await import('./api');
    client = (account ? api({ account }) : api({ instance })).masto;
  }
  // Network detection must be EXPLICIT — never duck-type the client:
  // masto.js v7 is Proxy-based, so `typeof client.v1.statuses.anything
  // === 'function'` is true on real Mastodon clients. Callers pass
  // isBluesky when they know it (compose.jsx knows its primary target);
  // otherwise derive from the account/instance via the real predicates.
  if (isBluesky === undefined) {
    if (account || instance) {
      const { isBlueskyAccount, isBlueskyInstance } = await import('./bluesky');
      isBluesky = account
        ? isBlueskyAccount(account)
        : isBlueskyInstance(instance);
    } else {
      isBluesky = false;
    }
  }

  const statuses = [];
  const skippedMedia = [];

  // Atomic path: the Bluesky facade creates whole threads in one
  // applyWrites — all-or-nothing, so failure needs no resume bookkeeping.
  // Gate on the RESOLVED isBluesky flag, never on method presence:
  // masto.js v7 is Proxy-based, so any property duck-types as a function
  // and a presence check would 404 Mastodon threads into /create_thread.
  if (segments.length - startAt > 1 && isBluesky) {
    onProgress?.(startAt, 'posting');
    try {
      const paramsList = [];
      for (let i = startAt; i < segments.length; i++) {
        const segment = segments[i];
        const { mediaIds, skippedMedia: skipped } = await resolveMediaIds({
          client,
          isBluesky,
          segment,
        });
        skippedMedia.push(...skipped);
        paramsList.push(
          removeNullUndefined({
            status: segment.text,
            spoiler_text: shared.spoilerText || undefined,
            language: shared.language,
            sensitive: !!shared.sensitive,
            media_ids: mediaIds.length ? mediaIds : undefined,
            in_reply_to_id:
              i === startAt
                ? // startAt > 0 arm is currently unreachable (atomic failure never advances startAt), but kept correct for future use.
                  (startAt > 0 ? resumeInReplyToId : shared.inReplyToId) ||
                  undefined
                : undefined,
            quoted_status_id: i === 0 ? shared.quotedStatusId : undefined,
          }),
        );
      }
      const created = await client.v1.statuses.createThread(paramsList);
      statuses.push(...created);
      for (let i = startAt; i < segments.length; i++) onProgress?.(i, 'done');
      return { statuses, failedAtIndex: null, error: null, skippedMedia };
    } catch (error) {
      onProgress?.(startAt, 'failed');
      return { statuses, failedAtIndex: startAt, error, skippedMedia };
    }
  }

  let inReplyToId = startAt > 0 ? resumeInReplyToId : shared.inReplyToId;
  for (let i = startAt; i < segments.length; i++) {
    const segment = segments[i];
    onProgress?.(i, 'posting');
    try {
      const { mediaIds, skippedMedia: skipped } = await resolveMediaIds({
        client,
        isBluesky,
        segment,
      });
      skippedMedia.push(...skipped);
      const params = removeNullUndefined({
        status: segment.text,
        spoiler_text: shared.spoilerText || undefined,
        language: shared.language,
        sensitive: !!shared.sensitive,
        poll: segment.poll,
        media_ids: mediaIds.length ? mediaIds : undefined,
        // Bluesky cross-post targets don't take visibility (pre-existing rule)
        visibility: account && isBluesky ? undefined : shared.visibility,
        in_reply_to_id: inReplyToId || undefined,
        // These only make sense on the first post of a thread
        scheduled_at: i === 0 ? shared.scheduledAt : undefined,
        quoted_status_id: i === 0 ? shared.quotedStatusId : undefined,
        quote_approval_policy: shared.quoteApprovalPolicy,
      });
      const key =
        idempotencyPrefix &&
        (i === 0 ? idempotencyPrefix : `${idempotencyPrefix}-${i}`);
      const newStatus = await createWithIdempotency(client, params, key);
      statuses.push(newStatus);
      inReplyToId = newStatus.id;
      onProgress?.(i, 'done');
    } catch (error) {
      onProgress?.(i, 'failed');
      return { statuses, failedAtIndex: i, error, skippedMedia };
    }
  }
  return { statuses, failedAtIndex: null, error: null, skippedMedia };
}
