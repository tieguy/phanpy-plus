// "Main character of the day" detection.
//
// Scans the recent (merged) feed for a subject that's suddenly over-represented
// — the person or proper noun everyone's talking about today — so the UI can
// offer a one-tap mute. Two signals:
//   - accounts being talked *about*: @mentions + quoted-post authors
//   - proper-noun phrases in post text (to catch off-network news figures)
// Ranked by how many distinct posts (and distinct authors) reference the
// subject, so one ranty thread can't crown a main character on its own.
//
// This is deliberately a heuristic. The account signal is reliable; the
// proper-noun signal is fuzzy and gated behind higher thresholds + a stopword
// list to keep false positives down.

// Common words + sentence-openers + app/network vocabulary that get
// capitalized but aren't main characters.
const STOPWORDS = new Set(
  [
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'if',
    'then',
    'so',
    'because',
    'i',
    'im',
    "i'm",
    'you',
    'your',
    "you're",
    'we',
    'our',
    'they',
    'them',
    'he',
    'she',
    'it',
    'this',
    'that',
    'these',
    'those',
    'my',
    'me',
    'us',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'do',
    'does',
    'did',
    'have',
    'has',
    'had',
    'will',
    'would',
    'can',
    'could',
    'should',
    'may',
    'might',
    'not',
    'no',
    'yes',
    // Contractions whose stripped base isn't itself a word.
    "won't",
    "ain't",
    "shan't",
    "let's",
    "y'all",
    'here',
    'there',
    'when',
    'where',
    'what',
    'who',
    'why',
    'how',
    'all',
    'just',
    'like',
    'get',
    'got',
    'one',
    'now',
    'today',
    'tomorrow',
    'yesterday',
    'also',
    'even',
    'really',
    'very',
    'some',
    'any',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
    'bluesky',
    'mastodon',
    'fleeting',
    'twitter',
    'facebook',
    'us',
    'usa',
    'am',
    'pm',
    'ok',
    'okay',
    'lol',
    'rt',
    'via',
    'http',
    'https',
    'www',
  ].map((w) => w.toLowerCase()),
);

function stripHTML(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeApostrophes(s) {
  // Normalize curly/smart quotes to straight apostrophes
  return s.replace(/[\u2018\u2019\u2032\u0060\u00b4]/g, "'");
}

function isStopword(word) {
  const w = normalizeApostrophes(word.toLowerCase());
  if (STOPWORDS.has(w)) return true;
  // Collapse possessives and contractions onto their base word, so the list
  // doesn't have to spell out every form: "I've" → "i", "They'll" → "they",
  // "Didn't" → "did". Irregular forms whose base isn't a word ("won't",
  // "ain't") are listed verbatim and caught by the check above.
  const base = w.replace(/n't$/, '').replace(/'(s|ve|d|ll|re|m|t)$/, '');
  return base !== w && STOPWORDS.has(base);
}

// Capitalized 1–3 word phrases that look like proper nouns.
export function properNounPhrases(text) {
  if (!text) return [];
  const out = [];
  const re = /\b([A-Z][a-zA-Z’'-]+(?:\s+[A-Z][a-zA-Z’'-]+){0,2})\b/g;
  let m;
  while ((m = re.exec(text))) {
    const phrase = normalizeApostrophes(m[1]).replace(/'s\b/g, '').trim();
    const words = phrase.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    // Drop phrases that are entirely stopwords, or a lone short/common word.
    if (words.every(isStopword)) continue;
    if (words.length === 1 && (phrase.length < 3 || isStopword(phrase)))
      continue;
    out.push(phrase);
  }
  return out;
}

// Distinct subjects referenced by a single status (each counts once per post).
function subjectsFromStatus(status) {
  const s = status?.reblog || status;
  if (!s) return [];
  const byKey = new Map();
  const add = (key, subject) => {
    if (!byKey.has(key)) byKey.set(key, { key, ...subject });
  };

  for (const mention of s.mentions || []) {
    const acct = (mention.acct || mention.username || '').toLowerCase();
    if (!acct) continue;
    add(`acct:${acct}`, {
      type: 'account',
      label: `@${mention.username || mention.acct}`,
      acct: mention.acct || mention.username,
      keyword: mention.username || mention.acct,
    });
  }

  const quotedAccount = s.quote?.account;
  if (quotedAccount?.acct) {
    const acct = quotedAccount.acct.toLowerCase();
    add(`acct:${acct}`, {
      type: 'account',
      label: `@${quotedAccount.username || quotedAccount.acct}`,
      acct: quotedAccount.acct,
      keyword: quotedAccount.username || quotedAccount.acct,
    });
  }

  const text = s.text || stripHTML(s.content);
  for (const phrase of properNounPhrases(text)) {
    add(`kw:${phrase.toLowerCase()}`, {
      type: 'keyword',
      label: phrase,
      keyword: phrase,
    });
  }

  return [...byKey.values()];
}

// Find the single most over-represented subject, or null if none clears the bar.
// Keyword candidates face a higher bar than accounts (fuzzier signal).
export function findMainCharacter(statuses, opts = {}) {
  const {
    minPosts = 5,
    minShare = 0.06,
    minAuthors = 3,
    keywordMinPosts = 7,
    keywordMinAuthors = 4,
    minTotal = 20,
  } = opts;
  const list = (statuses || []).filter(Boolean);
  const total = list.length;
  if (total < minTotal) return null;

  const stats = new Map();
  for (const status of list) {
    const authorId = (status.reblog || status).account?.id;
    const statusId = status.id;
    for (const subj of subjectsFromStatus(status)) {
      let e = stats.get(subj.key);
      if (!e) {
        e = { ...subj, posts: new Set(), authors: new Set() };
        stats.set(subj.key, e);
      }
      e.posts.add(statusId);
      if (authorId) e.authors.add(authorId);
    }
  }

  const candidates = [...stats.values()]
    .map((e) => ({
      key: e.key,
      type: e.type,
      label: e.label,
      keyword: e.keyword,
      acct: e.acct,
      postCount: e.posts.size,
      authorCount: e.authors.size,
      share: e.posts.size / total,
      total,
    }))
    .filter((e) => {
      if (e.type === 'keyword') {
        return (
          e.postCount >= keywordMinPosts && e.authorCount >= keywordMinAuthors
        );
      }
      return (
        e.postCount >= minPosts &&
        e.authorCount >= minAuthors &&
        e.share >= minShare
      );
    })
    .sort(
      (a, b) =>
        b.postCount - a.postCount ||
        b.authorCount - a.authorCount ||
        // Prefer accounts over keywords on a tie (more reliable signal).
        (a.type === 'account' ? -1 : 1) - (b.type === 'account' ? -1 : 1),
    );

  return candidates[0] || null;
}
