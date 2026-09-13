# Quote Without Attribution Implementation Plan — Phase 4: Menu action and composer handoff

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Add a "Quote without attribution" action that renders a post's text as a PNG card with the author redacted and hands it to the composer as an image attachment.

**Architecture:** A pure attachment builder (`src/utils/post-card-attachment.js`) turns a Blob plus alt text into the composer's attachment shape. A new item in the boost/quote menu of `src/components/status.jsx` lazy-imports the renderer, builds the attachment, and opens the composer with `showCompose({ draftStatus: { status: '', mediaAttachments: [attachment] } })`. The composer needs no change: its `draftStatus` restore effect already calls `setMediaAttachments`.

**Tech Stack:** Preact, `@szhsin/react-menu` `MenuItem`, Lingui `t` macro (via `useLingui()` already in the component), Vitest in Node (Node's global `Blob` is used in the test).

**Scope:** 5 phases from original design (`docs/design-plans/2026-09-10-no-dunk-quote.md`).

**Codebase verified:** 2026-09-10

---

See `phase_01.md` "Conventions for every phase" for test, commit, and staging rules.

## Phase 4 context (verified)

- Composer attachment shape, from `processFiles` in `src/components/compose.jsx` (around line 395):
  `{ fileData: await file.arrayBuffer(), fileName: file.name, type: file.type, size: file.size, url: URL.createObjectURL(file), id: null, description: null }`. `description` is the alt text; the composer's alt-text field reads it.
- The `draftStatus` restore effect in `compose.jsx` (around lines 675 to 714) does `textareaRef.current.value = status` and `if (mediaAttachments) setMediaAttachments(mediaAttachments)`. An empty `status: ''` is accepted.
- In `src/components/status.jsx`:
  - `const { _, t, i18n } = useLingui();` is at line 346, so `` t`...` `` works inside the component.
  - `showCompose` (line 48), `showToast` (line 49), `Icon` (line 70), and `MenuItem` (line 5) are already imported. `showToast` accepts a plain string.
  - Component state hooks sit together at lines 744 to 748 (`showEdited`, `showEmbed`, `showQuoteSettings`, `showQuotes`, `showQuoteChain`).
  - There are **two** boost/quote menus in the same `Status` component, and the new item goes in both:
    1. The kebab/context menu: `menuExtras` of the `MenuConfirm` at line 1302. Its "Quote with link" item ends at `</MenuItem>` on line 1351, followed by `)}` on line 1352 and `{boostAsAccounts.map(...)` on line 1353.
    2. The action-bar Boost button, the rocket icon under every post: `menuExtras` of the `MenuConfirm` at line 3185 (inside `<div class="action ...">`). Its "Quote with link" item ends at `</MenuItem>` on line 3249, followed by `)}` on line 3250 and the fragment close `</>` on line 3251. This one has no `boostAsAccounts` block.
  - Both `MenuConfirm`s carry `disabled={!canBoost}` (lines 1371 and 3186). Whether that actually blocks the menu differs by surface: `src/components/menu-confirm.jsx` forwards `disabled` to a `SubMenu` for the kebab menu (a supported prop) but to a plain `Menu` for the action bar, which has no `disabled` prop. So on a post the user cannot boost, the new action may be reachable from one surface and not the other. The plan adds no exception; Step 6 observes the real behaviour on both surfaces and Phase 5 documents what was observed, not what was inferred.
  - When a status is a boost, the component re-renders itself with the boosted post as `status` (line 618 onward), so inside the menu `status` is already the post to quote. No extra reblog handling is needed.
  - Lazy import pattern in the same file: `const { detectAll } = await import('tinyld/light');` (line 255).
- The project is English-only (commit 9ceb64ea dropped translation catalogs), so no locale extraction step is required for the new string.

---

### Task 1: Attachment builder — `blobToAttachment`

**Files:**
- Create: `src/utils/post-card-attachment.js`
- Create: `src/utils/post-card-attachment.test.js`

**Step 1: Write the failing tests**

Create `src/utils/post-card-attachment.test.js`:

```js
import { describe, expect, it } from 'vitest';

import { blobToAttachment } from './post-card-attachment';

describe('blobToAttachment', () => {
  it('builds the composer attachment shape from a PNG blob', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const blob = new Blob([bytes], { type: 'image/png' });
    const createObjectURL = (b) => {
      expect(b).toBe(blob);
      return 'blob:fake-url';
    };

    const attachment = await blobToAttachment(blob, 'alt text here', {
      createObjectURL,
    });

    expect(attachment).toMatchObject({
      fileName: 'quoted-post.png',
      type: 'image/png',
      size: 4,
      url: 'blob:fake-url',
      id: null,
      description: 'alt text here',
    });
    expect(new Uint8Array(attachment.fileData)).toEqual(bytes);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- src/utils/post-card-attachment.test.js`
Expected: FAIL — `Failed to resolve import "./post-card-attachment"`.

**Step 3: Write the implementation**

Create `src/utils/post-card-attachment.js`:

```js
// Wraps a rendered card Blob in the composer's media attachment shape (see
// processFiles in src/components/compose.jsx). Blob URL creation is
// injectable so this is testable in Node.

export const CARD_FILE_NAME = 'quoted-post.png';

export async function blobToAttachment(blob, altText, opts = {}) {
  const createObjectURL =
    opts.createObjectURL || ((b) => URL.createObjectURL(b));
  return {
    fileData: await blob.arrayBuffer(),
    fileName: CARD_FILE_NAME,
    type: blob.type || 'image/png',
    size: blob.size,
    url: createObjectURL(blob),
    id: null,
    description: altText,
  };
}
```

**Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- src/utils/post-card-attachment.test.js`
Expected: PASS, 1 test.

**Step 5: Commit**

```bash
git add src/utils/post-card-attachment.js src/utils/post-card-attachment.test.js
git commit -m "feat: attachment builder for the no-attribution quote card

blobToAttachment wraps a rendered PNG Blob in the composer's media
attachment shape with the alt text prefilled as its description."
git show HEAD --stat
```

---

### Task 2: "Quote without attribution" menu item

**Files:**
- Modify: `src/components/status.jsx` (state near line 748; menus near lines 1352 to 1353 and 3250 to 3251)

**Step 1: Add the in-flight state**

In `src/components/status.jsx`, directly after line 748 (`const [showQuoteChain, setShowQuoteChain] = useState(false);`), add:

```jsx
  const [renderingCard, setRenderingCard] = useState(false);
```

**Step 2: Add the handler**

Directly after the line you just added, add:

```jsx
  // "Quote without attribution": render the post as a redacted PNG card and
  // open the composer with it attached. Nothing that identifies the original
  // (URL, ID, handle, name, avatar, time) reaches the new post.
  const quoteWithoutAttribution = async () => {
    if (renderingCard) return;
    setRenderingCard(true);
    try {
      const [{ renderCardBlob }, { blobToAttachment }] = await Promise.all([
        import('../utils/post-card-render'),
        import('../utils/post-card-attachment'),
      ]);
      const { blob, altText } = await renderCardBlob(status);
      const attachment = await blobToAttachment(blob, altText);
      showCompose({
        draftStatus: {
          status: '',
          mediaAttachments: [attachment],
        },
      });
    } catch (e) {
      console.error(e);
      showToast(t`Could not render the post`);
    } finally {
      setRenderingCard(false);
    }
  };
```

**Step 3: Add the menu item to the kebab menu**

In the `menuExtras` of the boost `MenuConfirm` at line 1302, find this block (currently lines 1334 to 1352):

```jsx
                  {(DEV || !supportsNativeQuote(instance)) && (
                    <MenuItem
                      onClick={() => {
                        showCompose({
                          draftStatus: {
                            status: `\n${url}`,
                          },
                        });
                      }}
                    >
                      <Icon icon="quote" />
                      <span>
                        <Trans>Quote with link</Trans>
                      </span>
                      {supportsNativeQuote(instance) && DEV && (
                        <small class="tag collapsed">DEV</small>
                      )}
                    </MenuItem>
                  )}
```

Immediately after its closing `)}` and before `{boostAsAccounts.map((account) => {`, insert:

```jsx
                  <MenuItem
                    disabled={renderingCard}
                    onClick={quoteWithoutAttribution}
                  >
                    <Icon icon="quote" />
                    <span>
                      <Trans>Quote without attribution</Trans>
                    </span>
                  </MenuItem>
```

**Step 4: Add the same item to the action-bar boost menu**

In the `menuExtras` of the `MenuConfirm` at line 3185 (the one wrapping `<StatusButton class="reblog-button" ...>`), find the "Quote with link" block (lines 3232 to 3250, indented four levels deeper than the first one, otherwise identical). Immediately after its closing `)}` (line 3250) and before the fragment close `</>` (line 3251), insert the same item at that indentation:

```jsx
                        <MenuItem
                          disabled={renderingCard}
                          onClick={quoteWithoutAttribution}
                        >
                          <Icon icon="quote" />
                          <span>
                            <Trans>Quote without attribution</Trans>
                          </span>
                        </MenuItem>
```

Note: `@szhsin/react-menu` closes the menu on click, so `disabled={renderingCard}` only matters if the menu is reopened mid-render; the `if (renderingCard) return;` guard in the handler is the real double-click protection.

**Step 5: Verify the build and the existing tests**

Run: `npm run test:unit`
Expected: all files pass (27 files).

Run: `npm run build`
Expected: build completes with no errors. The output lists a separate chunk for `post-card-render` (confirming the lazy import split it out).

**Step 6: Verify in the browser**

Start `npm run dev` and open the app logged in to at least one Mastodon account and one Bluesky account.

1. On a Mastodon post in the home timeline, open the boost menu (the rocket icon under the post). Confirm the submenu shows Boost, the existing Quote entries, and the new "Quote without attribution". Then open the post's kebab (⋯) menu and confirm the Boost submenu there shows it too.
2. Click "Quote without attribution". Expected: the composer opens with an empty body, the card PNG attached, and the alt-text field prefilled with "Screenshot of a post, author hidden: …".
3. Post it. Open the resulting post and confirm its text is empty and it links nowhere. Confirm the original author receives no notification (no quote or mention lands in their notifications; check with your own second account by quoting your own post from the other account).
4. Repeat steps 1 to 3 on a Bluesky post. The card should render identically; the post publishes with only the image.
5. On a **boosted** post (one showing "X boosted"), use the menu and confirm the card shows the boosted post's text, not the booster's.
6. Confirm the existing Boost and Quote items still work as before.
7. Open DevTools Network panel while rendering: no requests other than the three lazy-loaded modules.
8. Find a post you cannot boost (someone else's followers-only post; the rocket is grayed). Open the action-bar boost menu and the kebab Boost submenu. Write down, for each surface, whether the menu opens and whether "Quote without attribution" is clickable. This observation is what Phase 5 records in CLAUDE.md.

**Step 7: Commit**

```bash
git add src/components/status.jsx
git commit -m "feat: quote a post without attribution

Adds a third entry to both boost/quote menus (action bar and kebab) that renders the post as a
redacted PNG card (placeholder avatar and name, text verbatim, media
noted as omitted) and opens the composer with it attached and alt text
prefilled. The new post carries no URL, ID, or handle of the original,
so it cannot be traced through the network and does not notify the
author. The renderer is lazy-loaded; the existing Quote and Boost
actions are untouched."
git show HEAD --stat
```
