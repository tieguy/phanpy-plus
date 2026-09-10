# Quote Without Attribution ("no-dunk quote") Design

## Summary

This adds a third way to quote a post that shares only the text, not the
author. Instead of a link back to the original, as both existing quote paths
produce, it draws a card of the post's content with the avatar and name
replaced by gray placeholders, and hands that card to the composer as an
ordinary image attachment with alt text prefilled. The new post carries no
URL, ID, or handle of the original.

The card is drawn from scratch with the Canvas 2D API rather than captured
from the rendered post. Screenshot libraries fail on avatars and media hosted
on other sites and inject styles the app's Content Security Policy blocks.
A hand-drawn card of placeholders and plain text needs no image loading and
no network requests. The work splits into a pure model layer (what the card
says, plus alt text), a pure layout layer (line wrapping with an injected
text-measuring function), and a browser-only renderer. The first two run in
Node, so they are unit tested; the renderer and the menu action are verified
in a browser.

## Definition of Done

A third entry in the status boost/quote menu, "Quote without attribution",
available for any post on either network. It renders the post text as a PNG
card via Canvas 2D: gray circle for the avatar, gray bar for the name, the
post text verbatim with custom emoji shown as their shortcode, and a line
noting omitted media or polls. It opens the composer with that PNG attached,
empty body text, and alt text prefilled as "Screenshot of a post, author
hidden: <plain text>", truncated to the 1500-char limit. No link or ID of the
original post goes anywhere in the new post. The existing Quote and Boost
actions are untouched. Unit tests cover the text layout/wrapping, alt text
builder, and the composer handoff.

## Glossary

- **Canvas 2D**: The browser drawing API used to paint the card by hand (circles, rectangles, text).
- **DOM screenshot / html2canvas**: The alternative of photographing the rendered post element. Rejected because it fails on cross-origin images and injects styles the CSP forbids.
- **CSP (Content Security Policy)**: The app's browser-enforced rule set that blocks inline scripts, eval, wasm, and injected styles.
- **Cross-origin**: Content hosted on a different site than the app; browsers refuse to read it into a canvas.
- **Mastopoet**: An existing tool that turns a Mastodon post into an image, cited as prior art; it shows the author.
- **PNG / Blob**: The image format and in-browser binary object the card is rendered to via the canvas `toBlob` method.
- **Alt text**: The accessibility description attached to an image; here auto-generated from the post text and capped at 1500 characters.
- **Custom emoji / shortcode**: Instance-specific emoji images such as `:blobcat:`; the card shows the shortcode text rather than fetching the image.
- **Spoiler text / content warning (CW)**: A post's optional warning label, drawn bold above the body.
- **Composer**: The post-writing component, `src/components/compose.jsx`.
- **draftStatus / showCompose**: The existing mechanism for opening the composer prepopulated with text and attachments.
- **mediaAttachments**: The composer's list of attached files; the card is added to it like any photo.
- **Mastodon-shaped status**: The app's internal post structure, used for Bluesky posts too after conversion.
- **getHTMLText**: Existing helper that converts a post's HTML body to plain text.
- **measureText**: A function returning the rendered width of a string; injected into the layout so wrapping is testable without a canvas.
- **devicePixelRatio**: Screen density multiplier; the card is rendered at least 2x for sharpness.
- **Vitest**: The project's unit test runner.
- **Boost/quote menu**: The per-post menu offering Boost, Quote, and now this option.
- **Native quote / link-fallback quote**: The two existing quote paths, a platform-level quote or a pasted link when that is unavailable.

## Architecture

A third quote action, "Quote without attribution", rasterizes the target post
into a PNG card with the author redacted and hands that PNG to the composer as
an ordinary attachment. The new post carries no link, ID, or handle of the
original, so it cannot be traced back through the network and does not
notify the original author.

Rendering is a hand-drawn Canvas 2D card, not a DOM screenshot. Prior art
(Mastopoet, the Bluesky post-to-image generators) all render the author
visibly and none anonymize; the DOM-to-image libraries they use fail on
cross-origin avatars and media and, in html2canvas's case, inject inline
styles blocked by this app's strict CSP. Since the avatar and name are
replaced by placeholders and post media is omitted, the card has no remote
resources to load, and Canvas 2D draws it with no new dependency.

Three layers, all under `src/utils/`:

- `post-card-model.js` (pure). `buildCardModel(status)` turns a
  Mastodon-shaped status (Bluesky posts already arrive in this shape from
  `src/utils/bluesky/convert.js`) into card content plus alt text.
- `post-card-layout.js` (pure). `layoutCard(model, measureText, opts)` wraps
  the content into positioned lines for a fixed card width. `measureText` is
  injected so the layout is testable in Node without a canvas.
- `post-card-render.js` (browser only, lazy-imported). `renderCardBlob(status)`
  draws the layout on a 2x canvas and returns a PNG `Blob`.

The menu item in `src/components/status.jsx` calls `renderCardBlob`, wraps
the blob in the composer's attachment shape, and opens the composer via
`showCompose({ draftStatus })`. The composer already restores
`mediaAttachments` from a draft (`src/components/compose.jsx`, the
`draftStatus` restore effect), so it needs no change.

### Contracts

```ts
// post-card-model.js
interface CardModel {
  spoilerText: string | null;   // content warning, drawn bold above body
  paragraphs: string[];         // plain-text body; custom emoji as :shortcode:
  omittedNote: string | null;   // e.g. "[2 images not shown]", "[poll not shown]",
                                //      "[quoted post not shown]", "[link preview not shown]"
  altText: string;              // "Screenshot of a post, author hidden: " + text, <= 1500 chars
}
function buildCardModel(status: MastodonStatus): CardModel;

// post-card-layout.js
interface CardLayout {
  width: number;                // css px
  height: number;               // css px, grows with content, capped
  lines: Array<{ text: string; x: number; y: number; style: 'spoiler' | 'body' | 'note' }>;
  truncated: boolean;           // true when the line cap was hit; a final "[…]" line is drawn
}
function layoutCard(model: CardModel, measureText: (text: string, style: string) => number,
                    opts?: { width?: number; maxLines?: number }): CardLayout;

// post-card-render.js
function renderCardBlob(status: MastodonStatus): Promise<{ blob: Blob, altText: string, truncated: boolean }>;  // rejects on toBlob failure

// composer attachment (existing shape, src/components/compose.jsx)
{ fileData: ArrayBuffer, fileName: string, type: 'image/png', size: number,
  url: string /* blob URL */, id: null, description: string /* altText */ }
```

Data flow: status → `buildCardModel` → `layoutCard` (with the canvas
context's `measureText`) → draw → `toBlob` → attachment object →
`showCompose({ draftStatus: { status: '', mediaAttachments: [attachment] } })`.

## Existing Patterns

- **Pure helper modules with colocated Vitest tests** in `src/utils/`
  (`compose-counting.js`, `notification-filter.js`, `main-character.js`).
  The model and layout modules follow this, keeping DOM out so tests run in
  Node.
- **Lazy-loading browser-only code** (`@atproto/api`, `thread-writes.js`).
  The renderer is dynamically imported from the menu handler.
- **Composer entry via `showCompose` with `draftStatus`**
  (`src/utils/show-compose.js`; the link-fallback quote in `status.jsx`
  already uses `draftStatus`). The composer restores `mediaAttachments` from a
  draft, so the attachment prefill reuses that path unchanged.
- **HTML-to-text** via `src/utils/getHTMLText.js`, already used by
  `status.jsx` for the same purpose.
- **Quote menu placement** in the boost/quote menu of `src/components/status.jsx`
  (native quote and link-fallback quote sit side by side there).
- **Error surfacing** via the app's existing toast (`showToast`).

No existing rendering-to-image code exists in the app beyond small canvas
uses (`avatar.jsx` alpha detection, `qr-code.jsx`, `status-card.jsx`), so
the renderer is new but stays within the Canvas 2D API.

## Implementation Phases

### Phase 1: Card model
**Goal:** Turn a status into redacted card content and alt text.

**Components:**
- `src/utils/post-card-model.js` — `buildCardModel`: spoiler, body paragraphs
  via `getHTMLText`, omitted-note composition from media count, poll, card,
  and quote, alt text with 1500-char truncation and ellipsis.
- `src/utils/post-card-model.test.js`.

**Dependencies:** None.

**Done when:** Tests pass for plain post, content warning, media-only post,
poll, quote, link card, custom emoji preserved as shortcode, and alt text
truncation.

### Phase 2: Text layout
**Goal:** Wrap card content into positioned lines without a DOM.

**Components:**
- `src/utils/post-card-layout.js` — `layoutCard`: header placeholder
  geometry, word wrap on spaces, hard break for tokens wider than the line,
  paragraph spacing, note style, line cap with `truncated` flag and trailing
  "[…]" line, total height.
- `src/utils/post-card-layout.test.js` with a fake `measureText`.

**Dependencies:** Phase 1 (model shape).

**Done when:** Tests pass for wrapping, long-token hard break, empty body with
note only, and the line cap.

### Phase 3: Canvas renderer
**Goal:** Draw the layout to a PNG blob.

**Components:**
- `src/utils/post-card-render.js` — `renderCardBlob`: 600 css-px card at
  `devicePixelRatio` (min 2), light background, rounded corners, system font
  stack matching the app, 40px gray avatar circle, gray name bar and lighter
  handle bar, spoiler bold, body, note muted; `toBlob('image/png')`; rejects
  when the blob is null.

**Dependencies:** Phases 1 and 2.

**Done when:** Manual browser check renders a card for a long post, a CW post,
and a media-only post, with no console errors and no network requests.

### Phase 4: Menu action and composer handoff
**Goal:** Expose the feature next to Quote.

**Components:**
- `src/components/status.jsx` — "Quote without attribution" item in the
  boost/quote menu, acting on the boosted status when the item is a boost;
  lazy-imports the renderer; disabled while a render is in flight; builds the
  attachment object (ArrayBuffer, blob URL, `description = altText`); opens
  `showCompose({ draftStatus: { status: '', mediaAttachments: [attachment] } })`;
  toast "Could not render the post" on failure.
- `src/utils/post-card-attachment.js` — pure `blobToAttachment(blob, altText)`
  builder, with a test in `post-card-attachment.test.js` (blob URL creation
  injected).

**Dependencies:** Phase 3.

**Done when:** Attachment builder test passes; in the browser, the composer
opens with the card attached and alt text prefilled from both a Mastodon
account and a Bluesky account, and the resulting post contains no URL or
handle of the original. Existing Quote and Boost behave as before.

### Phase 5: Documentation
**Goal:** Record the feature for readers of the repo.

**Components:**
- `README.md` feature list entry.
- `CLAUDE.md` short section describing the three-layer split and the
  "no remote resources, no original-post identifiers" invariant.

**Dependencies:** Phase 4.

**Done when:** Docs describe the shipped behavior in the present tense.

## Additional Considerations

**Privacy invariant:** nothing derived from the original's URL, ID, handle,
display name, avatar, or timestamp is drawn or attached. Mentions inside the
body are kept verbatim by decision; they may identify a thread, and the user
accepts that.

**Custom emoji and post media** are not fetched. Emoji stay as `:shortcode:`;
media, polls, quotes, and link previews become an omitted note. This is what
keeps the renderer free of CORS and CSP concerns.

**Bluesky alt text limit** is larger than 1500 characters, but the composer's
own `descriptionLimit` is 1500, so the model truncates to that for both
networks.

**Fonts:** the card uses the system font stack, so the look varies by OS.
Accepted; there are no web fonts to embed.
