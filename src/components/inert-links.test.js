// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { webLinkTarget } from './inert-links';

function linkIn(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root.querySelector('a');
}

describe('webLinkTarget', () => {
  it('opens a web link in the post text', () => {
    const link = linkIn(
      '<div class="content"><p><a href="https://example.com/a">x</a></p></div>',
    );
    expect(webLinkTarget(link)).toBe('https://example.com/a');
  });

  it('opens a link-preview card', () => {
    const link = linkIn(
      '<a class="card link" href="https://example.com/">x</a>',
    );
    expect(webLinkTarget(link)).toBe('https://example.com/');
  });

  it('keeps @-mentions and hashtags in the text inert', () => {
    expect(
      webLinkTarget(
        linkIn(
          '<div class="content"><a class="u-url mention" href="https://m.test/@a">@a</a></div>',
        ),
      ),
    ).toBe(null);
    expect(
      webLinkTarget(
        linkIn(
          '<div class="content"><a class="mention hashtag" href="https://m.test/tags/x">#x</a></div>',
        ),
      ),
    ).toBe(null);
  });

  it('keeps profile names and in-app links inert', () => {
    expect(
      webLinkTarget(
        linkIn('<a class="name-text" href="https://m.test/@a">A</a>'),
      ),
    ).toBe(null);
    expect(
      webLinkTarget(
        linkIn('<div class="content"><a href="#/m.test/s/1">x</a></div>'),
      ),
    ).toBe(null);
  });
});
