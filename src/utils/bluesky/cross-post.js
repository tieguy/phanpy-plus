// Cross-post a just-composed status to another account (usually on the
// other network — Mastodon ↔ Bluesky). Both networks are reached through
// api({ account }), which returns either a real masto client or the
// Bluesky masto-compatible facade.
import { api } from '../api';

import { isBlueskyAccount } from './index';

export async function crossPostStatus({
  account,
  status,
  spoilerText,
  sensitive,
  language,
  visibility,
  mediaAttachments = [],
}) {
  const { masto } = api({ account });
  const isBluesky = isBlueskyAccount(account);

  const mediaIds = [];
  const skippedMedia = [];
  for (const attachment of mediaAttachments) {
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
    const res = await masto.v2.media.create({
      file,
      description: description || undefined,
    });
    if (res?.id) mediaIds.push(res.id);
  }

  const params = {
    status,
    spoiler_text: spoilerText || undefined,
    sensitive: !!sensitive,
    language,
    media_ids: mediaIds.length ? mediaIds : undefined,
  };
  if (!isBluesky) {
    params.visibility = visibility || 'public';
  }
  const newStatus = await masto.v1.statuses.create(params);
  return { newStatus, skippedMedia };
}
