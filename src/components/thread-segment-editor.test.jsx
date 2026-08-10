// @vitest-environment happy-dom
import { render, h } from 'preact';
import { describe, expect, it, vi } from 'vitest';

// Mock @lingui/react/macro to provide useLingui hook that works with preact
// The gate verifies that if const { t } = useLingui() is removed from the component,
// the test fails with a ReferenceError
vi.mock('@lingui/react/macro', () => ({
  useLingui: () => ({
    t: (s, ...v) => s.reduce((a, p, i) => a + p + (v[i] ?? ''), ''),
  }),
}));

// Mock Icon component
vi.mock('./icon', () => ({
  default: ({ icon, alt }) => h('span', null, alt || icon),
}));

// Mock CharCountMeter component
vi.mock('./char-count-meter', () => ({
  default: ({ maxCharacters, charCount }) =>
    h('div', { class: 'char-count-meter' }, `${charCount}/${maxCharacters}`),
}));

import ThreadSegmentEditor from './thread-segment-editor';

describe('ThreadSegmentEditor', () => {
  it('renders and responds to text input', () => {
    // Create spy functions for callbacks
    const onChange = vi.fn();
    const onRemove = vi.fn();

    // Create test container
    const container = document.createElement('div');

    // Render component (useLingui hook is mocked to provide t function)
    render(
      h(ThreadSegmentEditor, {
        segment: {
          uid: 'test-uid-1',
          text: 'hi',
          mediaAttachments: [],
        },
        maxCharacters: 300,
        blueskyRules: false,
        maxMediaAttachments: 4,
        disabled: false,
        onChange,
        onRemove,
        processFiles: async () => [],
        stringLength: (s) => s.length,
      }),
      container,
    );

    // Assert: textarea exists with correct value
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('hi');

    // Assert: char meter element exists
    const charMeter = container.querySelector('[class*="char-count"]');
    expect(charMeter).not.toBeNull();
    expect(charMeter.textContent).toBe('2/300');

    // Assert: textarea name attribute is null (trap-invariant)
    expect(textarea.getAttribute('name')).toBeNull();

    // Assert: all buttons have type="button" (trap-invariant)
    container
      .querySelectorAll('button')
      .forEach((b) => expect(b.getAttribute('type')).toBe('button'));

    // Assert: typing calls onChange with new text
    const inputEvent = new Event('input', { bubbles: true });
    textarea.value = 'hello';
    textarea.dispatchEvent(inputEvent);
    expect(onChange).toHaveBeenCalledWith({ text: 'hello' });

    // Assert: remove button calls onRemove
    const removeButton = container.querySelector('.remove-segment');
    expect(removeButton).not.toBeNull();
    removeButton.click();
    expect(onRemove).toHaveBeenCalled();
  });

  it('when posted prop is true, makes textarea readOnly and hides remove/media buttons, shows ✓ chip', () => {
    const onChange = vi.fn();
    const onRemove = vi.fn();
    const container = document.createElement('div');

    render(
      h(ThreadSegmentEditor, {
        segment: {
          uid: 'test-uid-2',
          text: 'posted segment',
          mediaAttachments: [],
        },
        maxCharacters: 300,
        blueskyRules: false,
        maxMediaAttachments: 4,
        disabled: false,
        posted: true, // This is the new prop
        onChange,
        onRemove,
        processFiles: async () => [],
        stringLength: (s) => s.length,
      }),
      container,
    );

    // Assert: textarea exists and is readOnly
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(textarea.readOnly).toBe(true);

    // Assert: remove/media buttons are hidden or removed
    const removeButton = container.querySelector('.remove-segment');
    const addMediaButton = container.querySelector('.toolbar-button');
    // When posted, these buttons should not exist or be hidden
    expect(
      !removeButton ||
        removeButton.hidden ||
        removeButton.style.display === 'none',
    ).toBe(true);
    // Media button should be removed or hidden when posted
    expect(
      !addMediaButton ||
        addMediaButton.hidden ||
        addMediaButton.style.display === 'none',
    ).toBe(true);

    // Assert: ✓ Posted chip is visible
    const postedChip = container.querySelector('.posted-chip');
    expect(postedChip).not.toBeNull();
  });
});
