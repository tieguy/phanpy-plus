import DOMPurify from 'dompurify';

// Client-side sanitizer for remote HTML before it's injected into the DOM
// (status content, account bios/fields, direct messages).
//
// This is defense-in-depth behind the CSP: `script-src 'self'` already stops
// injected scripts and inline handlers from executing, but sanitizing also
// removes them (and javascript: URLs, dangling markup) so we don't rely on a
// single control, and so a malicious or buggy instance's HTML can't smuggle
// active content through. DOMPurify's defaults keep the safe HTML subset
// Mastodon and our Bluesky converter emit, so this is near-lossless.
export default function sanitizeHTML(html) {
  if (!html) return '';
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}
