// Character counting for compose, following Mastodon's rules
// https://github.com/mastodon/mastodon/blob/c4a429ed47e85a6bbf0d470a41cc2f64cf120c19/app/javascript/mastodon/features/compose/util/counter.js

import { toShortUrl } from './bluesky/shorten-links';
import urlRegexObj from './url-regex';

const usernameRegex = /(^|[^\/\w])[@＠](([a-z0-9_]+)@[a-z0-9\.\-]+[a-z0-9]+)/gi;
const urlPlaceholder = '$2xxxxxxxxxxxxxxxxxxxxxxx';

export function countableText(inputText) {
  return inputText
    .replace(urlRegexObj, urlPlaceholder)
    .replace(usernameRegex, '$1@$3');
}

// Bluesky counts the literal post text against its 300-grapheme limit, but
// the publish path (shortenLinkFacets in bluesky/client.js) rewrites each
// link's display text to its shortened form first — so count that form here,
// or long URLs would show as over-limit when the actual post fits.
// In the url regex, $2 is the char before the URL and group 3 is the URL.
export function countableBlueskyText(inputText) {
  return inputText.replace(
    urlRegexObj,
    (match, g1, before, url) => `${before}${toShortUrl(url)}`,
  );
}

export function segmentCharCount(text, { blueskyRules }, stringLength) {
  return stringLength(
    blueskyRules ? countableBlueskyText(text) : countableText(text),
  );
}

/**
 * Determines if character limit enforcement is needed.
 * Bluesky threads need enforcement at 300; Mastodon cross-posting needs enforcement.
 * @param {number} effectiveMaxCharacters - The effective limit for current context
 * @param {number} maxCharacters - The base limit for the account
 * @param {number} segmentCount - Number of segments in the thread (0 = single post)
 * @returns {boolean} Whether to enforce the character limit
 */
export function shouldEnforceCharLimit(
  effectiveMaxCharacters,
  maxCharacters,
  segmentCount,
) {
  return effectiveMaxCharacters < maxCharacters || segmentCount > 0;
}

/**
 * Calculates character count for a segment, including spoiler text when sensitive is true.
 * Must match getCharCount() logic from compose.jsx to ensure meter and validator agree.
 * Spoiler text is only counted when the sensitive flag is active.
 * @param {string} text - The segment text
 * @param {string} spoilerText - Content warning text (may be empty)
 * @param {boolean} sensitive - Whether content warning is active (gates spoiler counting)
 * @param {boolean} blueskyRules - Whether to use Bluesky counting (official-app URL shortening)
 * @param {Function} stringLength - Function to count string length
 * @returns {number} Total character count (text + spoiler only if sensitive is true)
 */
export function getSegmentCharCount(
  text,
  spoilerText,
  sensitive,
  blueskyRules,
  stringLength,
) {
  const countedText = blueskyRules
    ? countableBlueskyText(text)
    : countableText(text);
  const textCount = stringLength(countedText);
  // Only count spoilerText when sensitive is true (mirrors compose.jsx getCharCount)
  const spoilerCount = sensitive ? stringLength(spoilerText || '') : 0;
  return textCount + spoilerCount;
}

/**
 * Validates all segments against character limits and emptiness.
 * Returns validation errors that should be surfaced to the user.
 * @param {Object} params - Validation parameters
 * @param {string} params.mainText - The main status text
 * @param {Array<{text: string}>} params.moreSegments - Additional thread segments
 * @param {string} params.spoilerText - Content warning (may be empty)
 * @param {boolean} params.sensitive - Whether content warning is active
 * @param {number} params.effectiveMaxCharacters - Character limit
 * @param {boolean} params.enforceCharLimit - Whether to enforce character limit (false = backend validates)
 * @param {boolean} params.blueskyRules - Whether to use Bluesky counting
 * @param {Function} params.stringLength - Function to count string length
 * @returns {Object|null} Error object {segmentIndex, reason} or null if valid
 */
export function validateSegments({
  mainText,
  moreSegments,
  spoilerText,
  sensitive,
  effectiveMaxCharacters,
  enforceCharLimit,
  blueskyRules,
  stringLength,
}) {
  // Check main segment
  if (enforceCharLimit) {
    const mainCount = getSegmentCharCount(
      mainText || '',
      spoilerText,
      sensitive,
      blueskyRules,
      stringLength,
    );
    if (mainCount > effectiveMaxCharacters) {
      return { segmentIndex: 0, reason: 'too-long' };
    }
  }

  // Check all moreSegments
  for (let i = 0; i < moreSegments.length; i++) {
    const segment = moreSegments[i];
    const trimmedText = (segment.text || '').trim();

    if (!trimmedText) {
      return { segmentIndex: i + 1, reason: 'empty' };
    }

    if (enforceCharLimit) {
      // Thread segments don't have separate spoiler text, but Bluesky prepends CW
      // to each segment if spoilerText is set
      const segCount = getSegmentCharCount(
        segment.text,
        spoilerText,
        sensitive,
        blueskyRules,
        stringLength,
      );
      if (segCount > effectiveMaxCharacters) {
        return { segmentIndex: i + 1, reason: 'too-long' };
      }
    }
  }

  return null;
}
