import { describe, expect, it } from 'vitest';
import {
  zClaimStationDto,
  zCreateAssessmentDto,
  zCreateClassroomDto,
  zGradeWritingTestDto,
  zItemDto,
  zJoinLiveClassDto,
  zStartAttemptDto,
  zVocabularyTestConfig,
} from './index.js';
import { resolveTestPolicy } from '../types/index.js';

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

describe('classroom join restructure schemas', () => {
  it('zClaimStationDto accepts a sign-in with no classCode (sign-in never needs a class)', () => {
    const result = zClaimStationDto.parse({ serviceNumber: 'STU-001', password: 'pw', systemNumber: 5 });
    expect(result.classCode).toBeUndefined();
  });

  it('zClaimStationDto still accepts a classCode from an older desktop build', () => {
    expect(zClaimStationDto.parse({ serviceNumber: 'STU-001', password: 'pw', systemNumber: 5, classCode: 'ABC234' }).classCode).toBe('ABC234');
  });

  it('zJoinLiveClassDto requires a non-empty code and trims it', () => {
    expect(zJoinLiveClassDto.parse({ classCode: '  abc234 ' }).classCode).toBe('abc234');
    expect(() => zJoinLiveClassDto.parse({ classCode: '   ' })).toThrow();
  });

  it('zCreateClassroomDto needs only a name; joinOpen defaults to true and code/joinKey stay unset', () => {
    const result = zCreateClassroomDto.parse({ name: '  Morning English  ' });
    expect(result).toEqual({ name: 'Morning English', joinOpen: true });
  });

  it('zCreateClassroomDto still validates a teacher-typed code and key', () => {
    expect(() => zCreateClassroomDto.parse({ name: 'x', code: 'ab' })).toThrow();
    expect(() => zCreateClassroomDto.parse({ name: 'x', joinKey: 'short' })).toThrow();
    expect(zCreateClassroomDto.parse({ name: 'x', code: 'ACTC-B02', joinKey: 'Alpha-2026' })).toMatchObject({ code: 'ACTC-B02', joinKey: 'Alpha-2026' });
  });
});

describe('zCreateAssessmentDto (Create Assignment pages)', () => {
  const base = { title: '  Unit 3  ', studentIds: [cuid] };

  it('accepts each assignment type and trims the title', () => {
    const vocab = zCreateAssessmentDto.parse({ ...base, type: 'VOCABULARY_TEST', wordListText: 'cat = gato' });
    expect(vocab.title).toBe('Unit 3');
    expect(zCreateAssessmentDto.parse({ ...base, type: 'WRITING_TEST', prompt: 'Describe your town.' }).type).toBe('WRITING_TEST');
    expect(zCreateAssessmentDto.parse({ ...base, type: 'LISTENING_TEST', audioAssetId: cuid, questionsText: 'q = a' }).type).toBe('LISTENING_TEST');
    expect(zCreateAssessmentDto.parse({ ...base, type: 'READING_TEST', passage: 'The quick brown fox.' }).type).toBe('READING_TEST');
  });

  it('rejects a type that is not one of the assignment types, including other real activity types', () => {
    expect(() => zCreateAssessmentDto.parse({ ...base, type: 'PRONUNCIATION_TEST', wordListText: 'x = y' })).toThrow();
    expect(() => zCreateAssessmentDto.parse({ ...base, type: 'NOPE' })).toThrow();
  });

  it('needs at least one student for every type except VOCABULARY_TEST, and the fields its own type requires', () => {
    expect(() => zCreateAssessmentDto.parse({ ...base, studentIds: [], type: 'WRITING_TEST', prompt: 'p' })).toThrow();
    expect(() => zCreateAssessmentDto.parse({ ...base, type: 'WRITING_TEST', prompt: '   ' })).toThrow();
    expect(() => zCreateAssessmentDto.parse({ ...base, type: 'LISTENING_TEST', questionsText: 'q = a' })).toThrow(); // no audio
  });

  it('vocabulary test: studentIds may be empty ("save without assigning" — SPEC-mcq-test-timed-reveal.md §6.1), and wordListText/questions are optional at the schema level', () => {
    // Same "cross-field rule enforced in the service, not the schema"
    // precedent as the reading test's passage/documentAssetId below —
    // AssessmentsService.build() requires exactly one of wordListText/questions.
    expect(zCreateAssessmentDto.parse({ ...base, studentIds: [], type: 'VOCABULARY_TEST', wordListText: 'cat = gato' }).studentIds).toEqual([]);
    expect(() => zCreateAssessmentDto.parse({ ...base, type: 'VOCABULARY_TEST' })).not.toThrow();
  });

  it('vocabulary test: the form-builder question shape enforces exactly one correct answer and distinct options', () => {
    const dto = zCreateAssessmentDto.parse({
      ...base,
      type: 'VOCABULARY_TEST',
      questions: [{ prompt: 'Capital of France?', options: ['Paris', 'Lyon', 'Nice'], correctIndex: 0 }],
    });
    expect(dto.type).toBe('VOCABULARY_TEST');
    expect(() =>
      zCreateAssessmentDto.parse({
        ...base,
        type: 'VOCABULARY_TEST',
        questions: [{ prompt: 'q', options: ['a', 'b'], correctIndex: 5 }], // out of range
      }),
    ).toThrow();
    expect(() =>
      zCreateAssessmentDto.parse({
        ...base,
        type: 'VOCABULARY_TEST',
        questions: [{ prompt: 'q', options: ['a', 'A'], correctIndex: 0 }], // case-insensitive duplicate
      }),
    ).toThrow();
  });

  it('vocabulary test: ON_TIME_EXPIRY requires a time limit', () => {
    expect(() =>
      zCreateAssessmentDto.parse({ ...base, type: 'VOCABULARY_TEST', wordListText: 'cat = gato', revealMode: 'ON_TIME_EXPIRY' }),
    ).not.toThrow(); // the DTO itself doesn't carry this refine (it lives on zVocabularyTestConfig, built server-side)
  });

  it('coerces the ISO due date the browser sends into a Date', () => {
    const dto = zCreateAssessmentDto.parse({ ...base, type: 'WRITING_TEST', prompt: 'p', dueAt: '2026-10-01T23:59:59.000Z' });
    expect(dto.dueAt).toBeInstanceOf(Date);
  });

  it('reading test: defaults the voice, and caps the passage at 2000 chars (what /pronunciation/speak can read back)', () => {
    const dto = zCreateAssessmentDto.parse({ ...base, type: 'READING_TEST', passage: 'The quick brown fox.' });
    expect(dto.type === 'READING_TEST' && dto.voice).toBe('en_GB');
    expect(() => zCreateAssessmentDto.parse({ ...base, type: 'READING_TEST', passage: 'x'.repeat(2001) })).toThrow();
    expect(zCreateAssessmentDto.parse({ ...base, type: 'READING_TEST', passage: 'x'.repeat(2000) }).type).toBe('READING_TEST');
  });

  it('reading test: passage is optional at the schema level — a PDF (documentAssetId) can stand in for it', () => {
    // "At least one of passage/documentAssetId" is a cross-field rule a
    // discriminated-union branch can't express with .refine(), so it's
    // enforced in AssessmentsService.build() instead (see its own spec).
    const dto = zCreateAssessmentDto.parse({ ...base, type: 'READING_TEST', documentAssetId: cuid });
    expect(dto.type === 'READING_TEST' && dto.passage).toBeUndefined();
    expect(dto.type === 'READING_TEST' && dto.documentAssetId).toBe(cuid);
    expect(() => zCreateAssessmentDto.parse({ ...base, type: 'READING_TEST', documentAssetId: 'not-a-cuid' })).toThrow();
  });
});

describe('zGradeWritingTestDto', () => {
  it('keeps the mark within 0-100', () => {
    expect(zGradeWritingTestDto.parse({ score: 0 }).score).toBe(0);
    expect(zGradeWritingTestDto.parse({ score: 100 }).score).toBe(100);
    expect(() => zGradeWritingTestDto.parse({ score: 101 })).toThrow();
    expect(() => zGradeWritingTestDto.parse({ score: -1 })).toThrow();
  });
});

describe('zVocabularyTestConfig (SPEC-mcq-test-timed-reveal.md Phase 2 exit criterion)', () => {
  it('a legacy config with none of the new reveal fields still parses', () => {
    const cfg = zVocabularyTestConfig.parse({ items: [{ prompt: 'q', answer: 'a' }] });
    expect(cfg.revealMode).toBeUndefined();
    expect(cfg.revealDetail).toBeUndefined();
    expect(cfg.allowReview).toBeUndefined();
  });

  it('rejects ON_TIME_EXPIRY with no time limit', () => {
    expect(() => zVocabularyTestConfig.parse({ items: [{ prompt: 'q', answer: 'a' }], revealMode: 'ON_TIME_EXPIRY' })).toThrow();
    expect(() =>
      zVocabularyTestConfig.parse({ items: [{ prompt: 'q', answer: 'a' }], revealMode: 'ON_TIME_EXPIRY', timeLimitSec: 600 }),
    ).not.toThrow();
  });

  it('ON_SUBMIT and ON_TEACHER_RELEASE need no time limit', () => {
    expect(() => zVocabularyTestConfig.parse({ items: [{ prompt: 'q', answer: 'a' }], revealMode: 'ON_SUBMIT' })).not.toThrow();
    expect(() => zVocabularyTestConfig.parse({ items: [{ prompt: 'q', answer: 'a' }], revealMode: 'ON_TEACHER_RELEASE' })).not.toThrow();
  });

  it('an item explanation of null or empty string collapses to undefined, same as cefrTag', () => {
    const cfg = zVocabularyTestConfig.parse({ items: [{ prompt: 'q', answer: 'a', explanation: '' }] });
    expect(cfg.items?.[0]?.explanation).toBeUndefined();
    const cfg2 = zVocabularyTestConfig.parse({ items: [{ prompt: 'q', answer: 'a', explanation: 'Because.' }] });
    expect(cfg2.items?.[0]?.explanation).toBe('Because.');
  });
});

describe('resolveTestPolicy', () => {
  it('a legacy config (no reveal fields) defaults to ON_SUBMIT / SCORE_ONLY / retryable — today\'s behaviour, unchanged', () => {
    const policy = resolveTestPolicy({});
    expect(policy).toEqual({ revealMode: 'ON_SUBMIT', revealDetail: 'SCORE_ONLY', allowReview: true, oneShot: false });
  });

  it('a timed config with no explicit revealMode infers ON_TIME_EXPIRY / FULL_ANSWERS / one-shot', () => {
    const policy = resolveTestPolicy({ timeLimitSec: 600 });
    expect(policy).toEqual({ revealMode: 'ON_TIME_EXPIRY', revealDetail: 'FULL_ANSWERS', allowReview: true, oneShot: true });
  });

  it('an explicit revealMode is never overridden', () => {
    expect(resolveTestPolicy({ revealMode: 'ON_TEACHER_RELEASE', revealDetail: 'SCORE_ONLY' }).revealMode).toBe('ON_TEACHER_RELEASE');
    expect(resolveTestPolicy({ revealMode: 'ON_SUBMIT' }).oneShot).toBe(false);
  });
});

describe('zStartAttemptDto', () => {
  it('accepts exerciseId alone, activityInstanceId alone, or both — never neither', () => {
    expect(zStartAttemptDto.parse({ exerciseId: cuid }).exerciseId).toBe(cuid);
    expect(zStartAttemptDto.parse({ activityInstanceId: cuid }).activityInstanceId).toBe(cuid);
    expect(() => zStartAttemptDto.parse({})).toThrow();
  });
});
