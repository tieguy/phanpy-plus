// Engagement tab: likes and boosts as numbers rather than events.
// Neither network exposes count history, so the window tally is rebuilt from
// like/boost notifications whose server timestamps fall after the cutoff.

export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const PAGE_CAP = 5;

const LIKE = 'favourite';
const BOOST = 'reblog';

function timeOf(item) {
  const time = Date.parse(item?.createdAt);
  return Number.isNaN(time) ? null : time;
}

// Walks a notifications iterator until an item predates the cutoff, the
// iterator ends, or pageCap pages have been read. Empty pages do not stop the
// walk: the Bluesky facade filters `types` client-side, so a page can come back
// empty with more to follow.
export async function walkUntilCutoff(iterator, { cutoff, pageCap = PAGE_CAP }) {
  const notifications = [];
  for (let page = 0; page < pageCap; page++) {
    const { done, value } = await iterator.next();
    if (done) return { notifications, capped: false };
    const items = value || [];
    notifications.push(...items);
    if (items.some((item) => timeOf(item) !== null && timeOf(item) < cutoff)) {
      return { notifications, capped: false };
    }
  }
  return { notifications, capped: true };
}

export function tallyEngagement(sources, { cutoff }) {
  const networks = [];
  const rowsByKey = new Map();

  for (const { instance, notifications = [], capped = false } of sources) {
    const summary = { instance, likes: 0, boosts: 0, capped };
    networks.push(summary);

    for (const notification of notifications) {
      const { type } = notification || {};
      if (type !== LIKE && type !== BOOST) continue;
      const time = timeOf(notification);
      if (time === null || time < cutoff) continue;

      if (type === LIKE) summary.likes++;
      else summary.boosts++;

      const status = notification.status?.reblog || notification.status;
      if (!status?.id) continue;

      const key = `${instance}/${status.id}`;
      let row = rowsByKey.get(key);
      if (!row) {
        row = { key, instance, status, windowLikes: 0, windowBoosts: 0 };
        rowsByKey.set(key, row);
      }
      if (type === LIKE) row.windowLikes++;
      else row.windowBoosts++;
    }
  }

  const rows = [...rowsByKey.values()].sort(
    (a, b) =>
      b.windowLikes + b.windowBoosts - (a.windowLikes + a.windowBoosts) ||
      (timeOf(b.status) ?? 0) - (timeOf(a.status) ?? 0),
  );

  return { networks, rows };
}
