// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { ALT_TEXT_PREFIX, MAX_ALT_TEXT, buildCardModel } from './post-card-model';

function status(overrides = {}) {
  return {
    id: '1',
    url: 'https://example.social/@someone/1',
    account: { acct: 'someone@example.social', displayName: 'Someone' },
    content: '<p>Hello world</p>',
    spoilerText: '',
    mediaAttachments: [],
    poll: null,
    card: null,
    quote: null,
    ...overrides,
  };
}

describe('buildCardModel', () => {
  it('turns a plain post into one paragraph with no note', () => {
    const model = buildCardModel(status());
    expect(model.spoilerText).toBeNull();
    expect(model.paragraphs).toEqual(['Hello world']);
    expect(model.omittedNote).toBeNull();
    expect(model.altText).toBe(`${ALT_TEXT_PREFIX}Hello world`);
  });

  it('splits paragraphs and keeps line breaks inside a paragraph', () => {
    const model = buildCardModel(
      status({ content: '<p>One<br>two</p><p>Three</p>' }),
    );
    expect(model.paragraphs).toEqual(['One\ntwo', 'Three']);
  });

  it('keeps the content warning and prefixes it in the alt text', () => {
    const model = buildCardModel(
      status({ spoilerText: 'spoilers', content: '<p>Body</p>' }),
    );
    expect(model.spoilerText).toBe('spoilers');
    expect(model.altText).toBe(`${ALT_TEXT_PREFIX}CW: spoilers\n\nBody`);
  });

  it('notes omitted images on a media-only post', () => {
    const model = buildCardModel(
      status({
        content: '',
        mediaAttachments: [{ type: 'image' }, { type: 'image' }],
      }),
    );
    expect(model.paragraphs).toEqual([]);
    expect(model.omittedNote).toBe('[2 images not shown]');
    expect(model.altText).toBe(`${ALT_TEXT_PREFIX}[2 images not shown]`);
  });

  it('counts videos separately from images', () => {
    const model = buildCardModel(
      status({
        mediaAttachments: [{ type: 'image' }, { type: 'gifv' }, { type: 'video' }],
      }),
    );
    expect(model.omittedNote).toBe('[1 image, 2 videos not shown]');
  });

  it('notes an omitted poll', () => {
    const model = buildCardModel(status({ poll: { options: [] } }));
    expect(model.omittedNote).toBe('[poll not shown]');
  });

  it('notes an omitted quoted post', () => {
    const model = buildCardModel(status({ quote: { id: '2' } }));
    expect(model.omittedNote).toBe('[quoted post not shown]');
  });

  it('notes an omitted link preview', () => {
    const model = buildCardModel(status({ card: { url: 'https://x' } }));
    expect(model.omittedNote).toBe('[link preview not shown]');
  });

  it('joins several omitted things into one note', () => {
    const model = buildCardModel(
      status({ mediaAttachments: [{ type: 'image' }], poll: {}, card: {} }),
    );
    expect(model.omittedNote).toBe(
      '[1 image not shown] [poll not shown] [link preview not shown]',
    );
  });

  it('keeps custom emoji as their shortcode', () => {
    const model = buildCardModel(
      status({
        content: '<p>hi :blobcat:</p>',
        emojis: [{ shortcode: 'blobcat', url: 'https://x/blobcat.png' }],
      }),
    );
    expect(model.paragraphs).toEqual(['hi :blobcat:']);
    expect(model.altText).toContain(':blobcat:');
  });

  it('truncates alt text to the limit with an ellipsis', () => {
    const long = 'a'.repeat(2000);
    const model = buildCardModel(status({ content: `<p>${long}</p>` }));
    expect(model.altText.length).toBe(MAX_ALT_TEXT);
    expect(model.altText.endsWith('…')).toBe(true);
    expect(model.altText.startsWith(ALT_TEXT_PREFIX)).toBe(true);
  });

  it('carries nothing that identifies the author', () => {
    const model = buildCardModel(status());
    const dump = JSON.stringify(model);
    expect(dump).not.toContain('someone');
    expect(dump).not.toContain('Someone');
    expect(dump).not.toContain('example.social');
  });
});
