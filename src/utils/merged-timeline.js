// Chronological k-way merge over multiple timeline paginators
// (e.g. Mastodon home + Bluesky timeline), preserving per-source cursors.
//
// Each source: { instance, makeIterator: () => asyncIterator }
// where the iterator yields pages via .next() → { done, value: [statuses] }
//
// Returned object: { next(limit) → { done, value: [statuses] } }
// Every emitted status is stamped with `_instance` so callers can
// save/render it under the right account/instance.

export function createMergedTimelineIterator(sources) {
  const streams = sources.map((source) => ({
    ...source,
    iterator: null,
    buffer: [],
    done: false,
    failed: false,
  }));

  async function fillBuffers() {
    await Promise.all(
      streams.map(async (s) => {
        if (s.done || s.buffer.length) return;
        if (!s.iterator) s.iterator = s.makeIterator();
        try {
          const { done, value } = await s.iterator.next();
          if (value?.length) {
            for (const item of value) {
              if (!item._instance) item._instance = s.instance;
              s.buffer.push(item);
            }
          }
          if (done || !value?.length) s.done = true;
        } catch (e) {
          // One network failing shouldn't kill the whole timeline
          console.error('Merged timeline source failed', s.instance, e);
          s.done = true;
          s.failed = true;
        }
      }),
    );
  }

  return {
    streams,
    async next(limit = 20) {
      const items = [];
      while (items.length < limit) {
        await fillBuffers();
        // Merge: we can only safely emit while every non-exhausted source
        // has buffered items to compare against
        while (
          items.length < limit &&
          streams.every((s) => s.done || s.buffer.length)
        ) {
          const candidates = streams.filter((s) => s.buffer.length);
          if (!candidates.length) break;
          let best = candidates[0];
          for (const s of candidates) {
            if (
              Date.parse(s.buffer[0].createdAt) >
              Date.parse(best.buffer[0].createdAt)
            ) {
              best = s;
            }
          }
          items.push(best.buffer.shift());
        }
        if (streams.every((s) => s.done && !s.buffer.length)) break;
      }
      // masto.js paginator semantics: pages come with done=false;
      // done=true (with no value) only when there's nothing left
      const exhausted = streams.every((s) => s.done && !s.buffer.length);
      return { done: exhausted && !items.length, value: items };
    },
  };
}
