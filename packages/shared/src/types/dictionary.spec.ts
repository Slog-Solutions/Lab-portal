import { describe, expect, it } from 'vitest';
import { ActivityType } from './enums.js';
import {
  boundedEditDistance,
  extractLookupWord,
  normalizeLookupQuery,
  resolveDictionaryEnabled,
  shouldHandleDictionaryShortcut,
} from './dictionary.js';

describe('normalizeLookupQuery', () => {
  it('lowercases, trims and strips surrounding punctuation', () => {
    expect(normalizeLookupQuery('  Resolve.  ')).toBe('resolve');
    expect(normalizeLookupQuery('"discipline",')).toBe('discipline');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeLookupQuery('round   table')).toBe('round table');
  });

  it('NFC-normalizes accented input', () => {
    // "café" with a combining acute accent (NFD) must equal the precomposed form.
    expect(normalizeLookupQuery('café')).toBe(normalizeLookupQuery('café'));
  });
});

describe('extractLookupWord', () => {
  it('accepts a single word', () => {
    expect(extractLookupWord('resolve')).toBe('resolve');
  });

  it('accepts hyphenated and possessive forms', () => {
    expect(extractLookupWord("well-known")).toBe('well-known');
  });

  it('rejects a whole sentence', () => {
    expect(extractLookupWord('The quick brown fox jumps')).toBeNull();
  });

  it('rejects punctuation-only or empty selections', () => {
    expect(extractLookupWord('...')).toBeNull();
    expect(extractLookupWord('   ')).toBeNull();
  });

  it('rejects mixed-script or numeric selections', () => {
    expect(extractLookupWord('123')).toBeNull();
  });
});

describe('boundedEditDistance', () => {
  it('is 0 for identical strings', () => {
    expect(boundedEditDistance('resolve', 'resolve', 3)).toBe(0);
  });

  it('counts a single substitution as 1', () => {
    expect(boundedEditDistance('cat', 'bat', 3)).toBe(1);
  });

  it('counts an adjacent transposition as 1 (Damerau)', () => {
    expect(boundedEditDistance('form', 'from', 3)).toBe(1);
  });

  it('returns max+1 once the length gap alone exceeds max', () => {
    expect(boundedEditDistance('a', 'abcdef', 2)).toBe(3);
  });

  it('caps distance at max+1 for wildly different strings', () => {
    expect(boundedEditDistance('abcdefgh', 'zzzzzzzz', 2)).toBe(3);
  });
});

describe('resolveDictionaryEnabled', () => {
  it('defaults VOCABULARY_TEST to off', () => {
    expect(resolveDictionaryEnabled(ActivityType.VOCABULARY_TEST, null)).toBe(false);
    expect(resolveDictionaryEnabled(ActivityType.VOCABULARY_TEST, undefined)).toBe(false);
  });

  it('defaults every other activity to on', () => {
    expect(resolveDictionaryEnabled(ActivityType.ROUND_TABLE, null)).toBe(true);
    expect(resolveDictionaryEnabled(null, null)).toBe(true);
  });

  it('an explicit override always wins', () => {
    expect(resolveDictionaryEnabled(ActivityType.VOCABULARY_TEST, true)).toBe(true);
    expect(resolveDictionaryEnabled(ActivityType.ROUND_TABLE, false)).toBe(false);
  });
});

describe('shouldHandleDictionaryShortcut', () => {
  const baseEvent = { key: 'd', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false };

  it('fires for Ctrl+D with no focused target', () => {
    expect(shouldHandleDictionaryShortcut(baseEvent, null, true)).toBe(true);
  });

  it('is suppressed while the activity has the dictionary disabled', () => {
    expect(shouldHandleDictionaryShortcut(baseEvent, null, false)).toBe(false);
  });

  it('ignores OS auto-repeat', () => {
    expect(shouldHandleDictionaryShortcut({ ...baseEvent, repeat: true }, null, true)).toBe(false);
  });

  it('ignores a non-D key', () => {
    expect(shouldHandleDictionaryShortcut({ ...baseEvent, key: 'a' }, null, true)).toBe(false);
  });

  it('does not fire while typing in a textarea', () => {
    expect(shouldHandleDictionaryShortcut(baseEvent, { tagName: 'TEXTAREA' }, true)).toBe(false);
  });

  it('does not fire while typing in a contentEditable element', () => {
    expect(shouldHandleDictionaryShortcut(baseEvent, { isContentEditable: true }, true)).toBe(false);
  });

  it('still fires while focus is in the dictionary panel’s own search box', () => {
    expect(
      shouldHandleDictionaryShortcut(baseEvent, { tagName: 'INPUT', dataset: { dictionarySearch: 'true' } }, true),
    ).toBe(true);
  });

  it('fires from a plain, non-editable element', () => {
    expect(shouldHandleDictionaryShortcut(baseEvent, { tagName: 'DIV' }, true)).toBe(true);
  });
});
