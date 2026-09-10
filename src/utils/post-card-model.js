import getHTMLText from './getHTMLText';

// Alt text is capped at 1500 chars: the composer's default descriptionLimit
// (src/components/media-attachment.jsx). Bluesky allows more; an instance
// may configure less, in which case the alt-text field's own maxlength
// clips it further. Accepted by the design.
export const MAX_ALT_TEXT = 1500;
export const ALT_TEXT_PREFIX = 'Screenshot of a post, author hidden: ';

const VIDEO_TYPES = new Set(['video', 'gifv']);

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function mediaNote(mediaAttachments) {
  if (!mediaAttachments?.length) return null;
  let images = 0;
  let videos = 0;
  let others = 0;
  for (const m of mediaAttachments) {
    if (m.type === 'image') images++;
    else if (VIDEO_TYPES.has(m.type)) videos++;
    else others++;
  }
  const parts = [];
  if (images) parts.push(plural(images, 'image'));
  if (videos) parts.push(plural(videos, 'video'));
  if (others) parts.push(plural(others, 'attachment'));
  return `[${parts.join(', ')} not shown]`;
}

// Everything the card draws, plus its alt text. Deliberately derived only
// from the post's own content — never from the author, URL, ID, or time.
export function buildCardModel(status) {
  const spoilerText = status.spoilerText?.trim() || null;

  const text = getHTMLText(status.content);
  const paragraphs = text
    ? text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  const notes = [
    mediaNote(status.mediaAttachments),
    status.poll ? '[poll not shown]' : null,
    status.quote ? '[quoted post not shown]' : null,
    status.card ? '[link preview not shown]' : null,
  ].filter(Boolean);
  const omittedNote = notes.length ? notes.join(' ') : null;

  const altBody = [
    spoilerText ? `CW: ${spoilerText}` : null,
    paragraphs.join('\n\n') || null,
    omittedNote,
  ]
    .filter(Boolean)
    .join('\n\n');
  let altText = ALT_TEXT_PREFIX + altBody;
  if (altText.length > MAX_ALT_TEXT) {
    altText = altText.slice(0, MAX_ALT_TEXT - 1) + '…';
  }

  return { spoilerText, paragraphs, omittedNote, altText };
}
