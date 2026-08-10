// Character counting for compose, following Mastodon's rules
// https://github.com/mastodon/mastodon/blob/c4a429ed47e85a6bbf0d470a41cc2f64cf120c19/app/javascript/mastodon/features/compose/util/counter.js

import urlRegexObj from './url-regex';

const usernameRegex = /(^|[^\/\w])[@＠](([a-z0-9_]+)@[a-z0-9\.\-]+[a-z0-9]+)/gi;
const urlPlaceholder = '$2xxxxxxxxxxxxxxxxxxxxxxx';

export function countableText(inputText) {
  return inputText
    .replace(urlRegexObj, urlPlaceholder)
    .replace(usernameRegex, '$1@$3');
}

export function segmentCharCount(text, { blueskyRules }, stringLength) {
  return stringLength(blueskyRules ? text : countableText(text));
}
