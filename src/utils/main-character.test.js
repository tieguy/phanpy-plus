import { describe, expect, it } from 'vitest';

import { findMainCharacter, properNounPhrases } from './main-character';

// Build a status that mentions the given accts, authored by `author`.
function post(id, author, mentionedAccts = [], text = '') {
  return {
    id,
    account: { id: author },
    mentions: mentionedAccts.map((a) => ({
      acct: a,
      username: a.split('@')[0],
    })),
    text,
    content: '',
  };
}

// Filler posts so the total clears the minTotal bar without adding subjects.
function filler(n) {
  return Array.from({ length: n }, (_, i) =>
    post(`f${i}`, `author${i}`, [], 'hello world'),
  );
}

describe('properNounPhrases', () => {
  it('extracts capitalized proper-noun phrases', () => {
    expect(properNounPhrases('I think Seanan McGuire is right')).toEqual([
      'Seanan McGuire',
    ]);
  });

  it('drops stopwords and sentence-opener noise', () => {
    // "Today" / "The" are stopwords; only the real name survives.
    expect(
      properNounPhrases('Today The discourse is about Elon again'),
    ).toEqual(['Elon']);
  });

  it('ignores lowercase text', () => {
    expect(properNounPhrases('just a normal sentence here')).toEqual([]);
  });
});

describe('findMainCharacter', () => {
  it('returns null when there is not enough data', () => {
    expect(findMainCharacter([post('1', 'a', ['x@m'])])).toBeNull();
  });

  it('surfaces an account many different people mention', () => {
    const statuses = [
      post('1', 'alice', ['maincharacter@m']),
      post('2', 'bob', ['maincharacter@m']),
      post('3', 'carol', ['maincharacter@m']),
      post('4', 'dave', ['maincharacter@m']),
      post('5', 'erin', ['maincharacter@m']),
      ...filler(20),
    ];
    const mc = findMainCharacter(statuses);
    expect(mc).toBeTruthy();
    expect(mc.type).toBe('account');
    expect(mc.acct).toBe('maincharacter@m');
    expect(mc.postCount).toBe(5);
    expect(mc.authorCount).toBe(5);
  });

  it('does not crown a subject pushed by a single author', () => {
    // One person mentions the account 8 times; only 1 distinct author.
    const statuses = [
      ...Array.from({ length: 8 }, (_, i) =>
        post(`r${i}`, 'ranter', ['obsession@m']),
      ),
      ...filler(20),
    ];
    expect(findMainCharacter(statuses)).toBeNull();
  });

  it('holds keyword candidates to a higher bar than accounts', () => {
    // 5 distinct authors say "Ozymandias" — clears account bar (5) but not the
    // stricter keyword bar (7).
    const statuses = [
      post('1', 'alice', [], 'Ozymandias again'),
      post('2', 'bob', [], 'Ozymandias trending'),
      post('3', 'carol', [], 'Ozymandias news'),
      post('4', 'dave', [], 'Ozymandias discourse'),
      post('5', 'erin', [], 'Ozymandias everywhere'),
      ...filler(20),
    ];
    expect(findMainCharacter(statuses)).toBeNull();

    // Two more distinct authors push it over the keyword bar.
    statuses.push(post('6', 'frank', [], 'Ozymandias'));
    statuses.push(post('7', 'grace', [], 'Ozymandias'));
    const mc = findMainCharacter(statuses);
    expect(mc?.type).toBe('keyword');
    expect(mc.keyword).toBe('Ozymandias');
  });
});
