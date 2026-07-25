import { describe, expect, it } from 'vitest';

import { isDirectResponse } from './notification-filter';

describe('isDirectResponse', () => {
  it('keeps replies and @-mentions (both are the `mention` type)', () => {
    expect(isDirectResponse({ type: 'mention' })).toBe(true);
  });

  it('drops quote-posts', () => {
    expect(isDirectResponse({ type: 'quote' })).toBe(false);
    expect(isDirectResponse({ type: 'quoted_update' })).toBe(false);
  });

  it('drops reposts, likes and follows', () => {
    expect(isDirectResponse({ type: 'reblog' })).toBe(false);
    expect(isDirectResponse({ type: 'favourite' })).toBe(false);
    expect(isDirectResponse({ type: 'favourite+reblog' })).toBe(false);
    expect(isDirectResponse({ type: 'follow' })).toBe(false);
    expect(isDirectResponse({ type: 'follow_request' })).toBe(false);
  });

  it('drops non-response post types (status, poll, update)', () => {
    expect(isDirectResponse({ type: 'status' })).toBe(false);
    expect(isDirectResponse({ type: 'poll' })).toBe(false);
    expect(isDirectResponse({ type: 'update' })).toBe(false);
  });

  it('is safe on empty/malformed input', () => {
    expect(isDirectResponse(null)).toBe(false);
    expect(isDirectResponse(undefined)).toBe(false);
    expect(isDirectResponse({})).toBe(false);
  });
});
