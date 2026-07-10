// Converters: Bluesky (AT Protocol) objects → Mastodon-shaped objects
// so that phanpy's existing UI can render Bluesky content natively.

export const BSKY_WEB = 'https://bsky.app';

// AT-URI <-> route-safe status ID
// at://did:plc:xyz/app.bsky.feed.post/rkey <-> did:plc:xyz+app.bsky.feed.post+rkey
// '+' never appears in DIDs, NSIDs or record keys, and is path-safe in URLs
export function atUriToId(uri) {
  if (!uri) return uri;
  return uri.replace(/^at:\/\//, '').replace(/\//g, '+');
}
export function idToAtUri(id) {
  if (!id) return id;
  if (/^at:\/\//.test(id)) return id;
  return `at://${id.replace(/\+/g, '/')}`;
}
export function isBlueskyStatusID(id) {
  return typeof id === 'string' && /^did:[a-z0-9]+:.+\+.+\+/.test(id);
}
export function didFromAtUri(uri) {
  const m = uri?.match(/^at:\/\/([^/]+)/);
  return m ? m[1] : null;
}
export function rkeyFromAtUri(uri) {
  const m = uri?.match(/\/([^/]+)$/);
  return m ? m[1] : null;
}

function escapeHTML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(html) {
  return html.replace(/\n/g, '<br/>');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Convert post text + facets (byte-offset based) into Mastodon-flavored HTML
export function textToHTML(text, facets) {
  if (!text) return '';
  if (!facets?.length) {
    return `<p>${nl2br(escapeHTML(text))}</p>`;
  }
  const bytes = encoder.encode(text);
  const sorted = facets
    .filter((f) => f?.index && f.index.byteStart <= f.index.byteEnd)
    .sort((a, b) => a.index.byteStart - b.index.byteStart);
  let html = '';
  let cursor = 0;
  const sliceText = (start, end) => decoder.decode(bytes.slice(start, end));
  for (const facet of sorted) {
    const { byteStart, byteEnd } = facet.index;
    if (byteStart < cursor) continue; // overlapping facet, skip
    html += nl2br(escapeHTML(sliceText(cursor, byteStart)));
    const segment = sliceText(byteStart, byteEnd);
    const feature = facet.features?.[0];
    const type = feature?.$type;
    if (type === 'app.bsky.richtext.facet#link' && feature.uri) {
      html += `<a href="${escapeHTML(
        feature.uri,
      )}" target="_blank" rel="nofollow noopener">${escapeHTML(segment)}</a>`;
    } else if (type === 'app.bsky.richtext.facet#mention' && feature.did) {
      const handle = segment.replace(/^@/, '');
      // href uses the DID so mention clicks match the status's mentions list
      html += `<span class="h-card"><a href="${BSKY_WEB}/profile/${escapeHTML(
        feature.did,
      )}" class="u-url mention">@<span>${escapeHTML(handle)}</span></a></span>`;
    } else if (type === 'app.bsky.richtext.facet#tag' && feature.tag) {
      html += `<a href="${BSKY_WEB}/hashtag/${encodeURIComponent(
        feature.tag,
      )}" class="mention hashtag" rel="tag">#<span>${escapeHTML(
        feature.tag,
      )}</span></a>`;
    } else {
      html += nl2br(escapeHTML(segment));
    }
    cursor = byteEnd;
  }
  html += nl2br(escapeHTML(sliceText(cursor, bytes.length)));
  return `<p>${html}</p>`;
}

// ProfileView(Basic|Detailed) → Mastodon Account
export function profileToAccount(profile, instance) {
  if (!profile) return null;
  const { did, handle, displayName, avatar, banner, description, viewer } =
    profile;
  const acct = handle === 'handle.invalid' ? did : handle;
  return {
    id: did,
    username: acct,
    acct,
    displayName: displayName || acct,
    avatar: avatar || '',
    avatarStatic: avatar || '',
    header: banner || '',
    headerStatic: banner || '',
    url: `${BSKY_WEB}/profile/${did}`,
    note: description ? `<p>${nl2br(escapeHTML(description))}</p>` : '',
    followersCount: profile.followersCount ?? 0,
    followingCount: profile.followsCount ?? 0,
    statusesCount: profile.postsCount ?? 0,
    createdAt: profile.createdAt || profile.indexedAt,
    bot: false,
    locked: false,
    group: false,
    discoverable: true,
    fields: [],
    emojis: [],
    _bluesky: true,
    _instance: instance,
    // profileViewBasic (e.g. post authors) carries no counts — flag it so
    // profile views know to fetch the detailed profile before trusting 0s
    _partial: profile.followersCount === undefined ? true : undefined,
    _viewer: viewer
      ? {
          following: viewer.following,
          followedBy: viewer.followedBy,
          muted: viewer.muted,
          blocking: viewer.blocking,
          blockedBy: viewer.blockedBy,
        }
      : undefined,
  };
}

// viewer relationship → Mastodon Relationship
export function profileToRelationship(profile) {
  const viewer = profile?.viewer || {};
  return {
    id: profile.did,
    following: !!viewer.following,
    followedBy: !!viewer.followedBy,
    requested: false,
    blocking: !!viewer.blocking,
    blockedBy: !!viewer.blockedBy,
    muting: !!viewer.muted,
    mutingNotifications: false,
    domainBlocking: false,
    endorsed: false,
    showingReblogs: true,
    notifying: false,
    languages: null,
    note: '',
    _followingUri: viewer.following,
    _blockingUri: viewer.blocking,
  };
}

function imageToAttachment(img) {
  const { width, height } = img.aspectRatio || {};
  return {
    id: img.fullsize || img.thumb,
    type: 'image',
    url: img.fullsize,
    previewUrl: img.thumb,
    remoteUrl: null,
    description: img.alt || '',
    blurhash: null,
    meta:
      width && height
        ? {
            original: { width, height, aspect: width / height },
            small: { width, height, aspect: width / height },
          }
        : {},
  };
}

function videoToAttachment(video) {
  const { width, height } = video.aspectRatio || {};
  return {
    id: video.cid || video.playlist,
    type: 'video',
    url: video.playlist,
    previewUrl: video.thumbnail,
    remoteUrl: null,
    description: video.alt || '',
    blurhash: null,
    _hls: true,
    meta:
      width && height
        ? {
            original: { width, height, aspect: width / height },
            small: { width, height, aspect: width / height },
          }
        : {},
  };
}

function externalToCard(external) {
  const { uri, title, description, thumb } = external;
  let providerName = '';
  try {
    providerName = new URL(uri).hostname;
  } catch (e) {}
  return {
    url: uri,
    title: title || uri,
    description: description || '',
    type: 'link',
    image: thumb || null,
    authorName: '',
    authorUrl: '',
    providerName,
    providerUrl: '',
    html: '',
    width: 0,
    height: 0,
    embedUrl: '',
  };
}

// Extract media attachments + card + quote from a post embed view
function extractEmbed(embed, instance) {
  const result = { mediaAttachments: [], card: null, quote: null };
  if (!embed) return result;
  const type = embed.$type || '';
  if (type.startsWith('app.bsky.embed.images')) {
    result.mediaAttachments = (embed.images || []).map(imageToAttachment);
  } else if (type.startsWith('app.bsky.embed.video')) {
    result.mediaAttachments = [videoToAttachment(embed)];
  } else if (type.startsWith('app.bsky.embed.external')) {
    result.card = externalToCard(embed.external);
  } else if (type.startsWith('app.bsky.embed.recordWithMedia')) {
    const mediaPart = extractEmbed(embed.media, instance);
    result.mediaAttachments = mediaPart.mediaAttachments;
    result.card = mediaPart.card;
    result.quote = viewRecordToQuote(embed.record?.record, instance);
  } else if (type.startsWith('app.bsky.embed.record')) {
    result.quote = viewRecordToQuote(embed.record, instance);
  }
  return result;
}

// embed.record view → Mastodon-native-style quote object
function viewRecordToQuote(record, instance) {
  if (!record) return null;
  const type = record.$type || '';
  if (
    type.includes('viewNotFound') ||
    type.includes('viewBlocked') ||
    type.includes('viewDetached')
  ) {
    return { state: 'deleted', native: true };
  }
  // Only embed record views of posts (not feed gens, lists, starter packs)
  if (!type.startsWith('app.bsky.embed.record#viewRecord')) return null;
  const quotedStatus = viewRecordToStatus(record, instance);
  if (!quotedStatus) return null;
  return {
    state: 'accepted',
    quotedStatus,
  };
}

// app.bsky.embed.record#viewRecord → Mastodon Status (embedded quoted post)
function viewRecordToStatus(viewRecord, instance) {
  const { uri, cid, author, value, embeds, indexedAt } = viewRecord;
  if (!uri || !value) return null;
  const embedded = extractEmbed(embeds?.[0], instance);
  return baseStatus({
    uri,
    cid,
    author,
    record: value,
    indexedAt,
    embedded,
    counts: {
      replyCount: viewRecord.replyCount,
      repostCount: viewRecord.repostCount,
      likeCount: viewRecord.likeCount,
      quoteCount: viewRecord.quoteCount,
    },
    viewer: {},
    instance,
    // Avoid infinite quote nesting in embedded views
    includeQuote: false,
  });
}

function baseStatus({
  uri,
  cid,
  author,
  record,
  indexedAt,
  embedded,
  counts,
  viewer = {},
  labels,
  instance,
  includeQuote = true,
}) {
  const id = atUriToId(uri);
  const createdAt = record?.createdAt || indexedAt;
  const account = profileToAccount(author, instance);
  const mentions = [];
  const tags = [];
  for (const facet of record?.facets || []) {
    const feature = facet.features?.[0];
    if (feature?.$type === 'app.bsky.richtext.facet#mention') {
      mentions.push({
        id: feature.did,
        username: feature.did,
        acct: feature.did,
        url: `${BSKY_WEB}/profile/${feature.did}`,
      });
    } else if (feature?.$type === 'app.bsky.richtext.facet#tag') {
      tags.push({
        name: feature.tag,
        url: `${BSKY_WEB}/hashtag/${encodeURIComponent(feature.tag)}`,
      });
    }
  }

  // Content warnings via self-labels
  let spoilerText = '';
  let sensitive = false;
  const selfLabels =
    record?.labels?.values?.map((v) => v.val) ||
    (labels || []).filter((l) => l?.src === author?.did).map((l) => l.val);
  if (selfLabels?.length) {
    const sensitiveLabels = ['porn', 'sexual', 'nudity', 'graphic-media'];
    sensitive = selfLabels.some((val) => sensitiveLabels.includes(val));
  }

  const inReplyToUri = record?.reply?.parent?.uri;

  return {
    id,
    uri,
    url: `${BSKY_WEB}/profile/${author?.did}/post/${rkeyFromAtUri(uri)}`,
    createdAt,
    editedAt: null,
    account,
    content: textToHTML(record?.text, record?.facets),
    text: record?.text,
    visibility: 'public',
    sensitive,
    spoilerText,
    mediaAttachments: embedded?.mediaAttachments || [],
    mentions,
    tags,
    emojis: [],
    card: embedded?.card || null,
    poll: null,
    quote: includeQuote ? embedded?.quote || null : null,
    reblog: null,
    repliesCount: counts?.replyCount ?? 0,
    reblogsCount: counts?.repostCount ?? 0,
    favouritesCount: counts?.likeCount ?? 0,
    quotesCount: counts?.quoteCount ?? 0,
    favourited: !!viewer?.like,
    reblogged: !!viewer?.repost,
    bookmarked: !!viewer?.bookmarked,
    muted: !!viewer?.threadMuted,
    pinned: !!viewer?.pinned,
    inReplyToId: inReplyToUri ? atUriToId(inReplyToUri) : null,
    inReplyToAccountId: inReplyToUri ? didFromAtUri(inReplyToUri) : null,
    language: record?.langs?.[0]?.split('-')?.[0] || null,
    filtered: [],
    application: null,
    _bluesky: true,
    _instance: instance,
    _cid: cid,
    _likeUri: viewer?.like,
    _repostUri: viewer?.repost,
    _replyDisabled: !!viewer?.replyDisabled,
  };
}

// app.bsky.feed.defs#postView → Mastodon Status
export function postToStatus(post, instance) {
  if (!post) return null;
  const embedded = extractEmbed(post.embed, instance);
  return baseStatus({
    uri: post.uri,
    cid: post.cid,
    author: post.author,
    record: post.record,
    indexedAt: post.indexedAt,
    embedded,
    counts: post,
    viewer: post.viewer,
    labels: post.labels,
    instance,
  });
}

// app.bsky.feed.defs#feedViewPost → Mastodon Status (may be a repost wrapper)
export function feedItemToStatus(item, instance) {
  const status = postToStatus(item.post, instance);
  if (!status) return null;
  const reason = item.reason;
  if (reason?.$type?.includes('reasonRepost') && reason.by) {
    // Repost → Mastodon boost wrapper
    const account = profileToAccount(reason.by, instance);
    return {
      id: `${status.id}+repost+${reason.by.did}`,
      uri: reason.uri || status.uri,
      url: status.url,
      createdAt: reason.indexedAt,
      editedAt: null,
      account,
      content: '',
      visibility: 'public',
      sensitive: false,
      spoilerText: '',
      mediaAttachments: [],
      mentions: [],
      tags: [],
      emojis: [],
      reblog: status,
      repliesCount: 0,
      reblogsCount: 0,
      favouritesCount: 0,
      favourited: false,
      reblogged: false,
      bookmarked: false,
      muted: false,
      inReplyToId: null,
      inReplyToAccountId: null,
      language: null,
      filtered: [],
      _bluesky: true,
      _instance: instance,
    };
  }
  return status;
}

// app.bsky.notification.listNotifications#notification → Mastodon Notification
// subjectStatus: hydrated status for reasonSubject (like/repost) if available
export function notificationToMasto(notif, instance, subjectStatus) {
  const { uri, author, reason, isRead, indexedAt, record } = notif;
  const typeMap = {
    like: 'favourite',
    repost: 'reblog',
    follow: 'follow',
    mention: 'mention',
    reply: 'mention',
    quote: 'mention',
  };
  const type = typeMap[reason];
  if (!type) return null;
  let status = null;
  if (reason === 'like' || reason === 'repost') {
    status = subjectStatus || null;
  } else if (reason === 'mention' || reason === 'reply' || reason === 'quote') {
    // The notification's own record is the mentioning/replying post
    status =
      subjectStatus ||
      baseStatus({
        uri,
        cid: notif.cid,
        author,
        record,
        indexedAt,
        embedded: {},
        counts: {},
        viewer: {},
        instance,
      });
  }
  return {
    id: atUriToId(uri),
    type,
    createdAt: indexedAt,
    account: profileToAccount(author, instance),
    status,
    _read: isRead,
    _bluesky: true,
    _instance: instance,
  };
}

// Synthetic Mastodon-style instance info for a Bluesky service
export function blueskyInstanceInfo(domain) {
  return {
    domain,
    title: 'Bluesky',
    version: '0.0.1',
    sourceUrl: 'https://github.com/bluesky-social/atproto',
    description: 'Bluesky (AT Protocol)',
    languages: ['en'],
    urls: {},
    configuration: {
      statuses: {
        maxCharacters: 300,
        maxMediaAttachments: 4,
        charactersReservedPerUrl: 0,
      },
      mediaAttachments: {
        supportedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
          'video/mp4',
          'video/webm',
          'video/quicktime',
        ],
        imageSizeLimit: 1000000,
        imageMatrixLimit: 16777216,
        videoSizeLimit: 100000000,
        videoFrameRateLimit: 60,
        videoMatrixLimit: 16777216,
      },
      polls: {
        maxOptions: 0,
        maxCharactersPerOption: 0,
        minExpiration: 0,
        maxExpiration: 0,
      },
    },
    registrations: { enabled: false },
    contact: {},
    rules: [],
    _bluesky: true,
  };
}
