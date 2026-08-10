import { describe, expect, it } from 'vitest';

import { hasNewDirectResponse, isDirectResponse } from './notification-filter';

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

describe('hasNewDirectResponse', () => {
  const seen = '2026-07-25T12:00:00.000Z';
  const older = '2026-07-25T11:00:00.000Z';
  const newer = '2026-07-25T13:00:00.000Z';

  it('is true when a reply/mention is newer than last seen', () => {
    expect(
      hasNewDirectResponse([{ type: 'mention', createdAt: newer }], seen),
    ).toBe(true);
  });

  it('is false when the only newer notifications are not responses', () => {
    expect(
      hasNewDirectResponse(
        [
          { type: 'favourite', createdAt: newer },
          { type: 'reblog', createdAt: newer },
          { type: 'quote', createdAt: newer },
        ],
        seen,
      ),
    ).toBe(false);
  });

  it('is false when the response is not newer than last seen', () => {
    expect(
      hasNewDirectResponse([{ type: 'mention', createdAt: older }], seen),
    ).toBe(false);
    // Exactly the last-seen one (already seen) does not re-light.
    expect(
      hasNewDirectResponse([{ type: 'mention', createdAt: seen }], seen),
    ).toBe(false);
  });

  it('picks the newer response out of a mixed batch', () => {
    expect(
      hasNewDirectResponse(
        [
          { type: 'favourite', createdAt: newer },
          { type: 'mention', createdAt: older },
          { type: 'mention', createdAt: newer },
        ],
        seen,
      ),
    ).toBe(true);
  });

  it('is safe on empty/malformed input', () => {
    expect(hasNewDirectResponse([], seen)).toBe(false);
    expect(hasNewDirectResponse(undefined, seen)).toBe(false);
    expect(hasNewDirectResponse([{ type: 'mention' }], seen)).toBe(false);
  });
});
