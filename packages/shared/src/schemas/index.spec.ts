import { describe, expect, it } from 'vitest';
import { zItemDto } from './index.js';

const cuid = 'clh3am1r30000qzrmn831i7n';

describe('zItemDto (Phase 4 regression)', () => {
  it('normalizes null cefrTag/mediaAssetId to undefined (Prisma serializes unset nullable columns as null, not absent)', () => {
    const result = zItemDto.parse({ prompt: 'q', answer: 'a', cefrTag: null, mediaAssetId: null });
    expect(result.cefrTag).toBeUndefined();
    expect(result.mediaAssetId).toBeUndefined();
  });

  it('normalizes an empty choices array to undefined (Prisma serializes an unset scalar-list column as [], not absent)', () => {
    const result = zItemDto.parse({ prompt: 'q', answer: 'a', choices: [] });
    expect(result.choices).toBeUndefined();
  });

  it('still rejects a genuinely too-short choices array (a real authoring mistake, not an unset field)', () => {
    expect(() => zItemDto.parse({ prompt: 'q', answer: 'a', choices: ['only-one'] })).toThrow();
  });

  it('the exact GET->PUT round trip this bug came from: a fetched item with every optional field unset re-parses cleanly', () => {
    // Shape a real Prisma Item row actually returns for a plain
    // short-answer item authored with no cefrTag/mediaAssetId/choices.
    const fetchedFromApi = {
      id: cuid,
      itemBankId: cuid,
      order: 0,
      type: 'SHORT_ANSWER',
      prompt: 'q',
      answer: 'a',
      choices: [],
      cefrTag: null,
      mediaAssetId: null,
    };
    expect(() => zItemDto.parse(fetchedFromApi)).not.toThrow();
  });

  it('still accepts a real MCQ item with cefrTag and mediaAssetId set', () => {
    const result = zItemDto.parse({ prompt: 'q', answer: 'a', choices: ['a', 'b'], cefrTag: 'A2', mediaAssetId: cuid });
    expect(result).toMatchObject({ cefrTag: 'A2', mediaAssetId: cuid, choices: ['a', 'b'] });
  });
});
