import { describe, expect, it } from 'vitest';
import { getActivity } from './registry.js';
import { ActivityType } from '../types/enums.js';
import './index.js';

const cuid = 'clh3am1r30000qzrmn831i7n'; // a syntactically valid cuid2 fixture

describe('CONFERENCE_INTERPRETING config (Phase 5)', () => {
  it('accepts roles keyed by stationId', () => {
    const result = getActivity(ActivityType.CONFERENCE_INTERPRETING).configSchema.safeParse({
      topic: 'Trade talks',
      languages: ['fr'],
      roles: [{ stationId: cuid, role: 'INTERPRETER', lang: 'fr' }],
    });
    expect(result.success).toBe(true);
  });

  it('regression: rejects the old studentId-keyed shape (renamed in Phase 5 — see definitions.ts)', () => {
    const result = getActivity(ActivityType.CONFERENCE_INTERPRETING).configSchema.safeParse({
      topic: 'Trade talks',
      languages: ['fr'],
      roles: [{ studentId: cuid, role: 'INTERPRETER', lang: 'fr' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('ROUND_TABLE config (Ser 3)', () => {
  const descriptor = getActivity(ActivityType.ROUND_TABLE);

  it('still accepts a config saved before participant assignment existed', () => {
    const result = descriptor.configSchema.safeParse({ topic: 'Trade', chairmanAssignment: 'manual', micRequestQueueEnabled: true });
    expect(result.success).toBe(true);
  });

  it('defaults the new fields', () => {
    const parsed = descriptor.configSchema.parse({ topic: 'Trade' }) as Record<string, unknown>;
    expect(parsed.participantAssignment).toBe('manual');
    expect(parsed.chairmanStrategy).toBe('random');
    expect(parsed.chairmanAssignment).toBe('manual');
    expect(parsed.micRequestQueueEnabled).toBe(true);
  });

  it('bounds the group size and the rotation interval', () => {
    const base = { topic: 'Trade', participantAssignment: 'automatic' };
    expect(descriptor.configSchema.safeParse({ ...base, targetGroupSize: 5 }).success).toBe(true);
    expect(descriptor.configSchema.safeParse({ ...base, targetGroupSize: 1 }).success).toBe(false);
    expect(descriptor.configSchema.safeParse({ ...base, targetGroupSize: 11 }).success).toBe(false);
    expect(descriptor.configSchema.safeParse({ topic: 'x', chairmanStrategy: 'rotate', rotateEverySec: 30 }).success).toBe(false);
    expect(descriptor.configSchema.safeParse({ topic: 'x', chairmanStrategy: 'rotate', rotateEverySec: 120 }).success).toBe(true);
  });
});

describe('ROUND_TABLE response (Ser 3)', () => {
  const descriptor = getActivity(ActivityType.ROUND_TABLE);

  it('accepts turns keyed by stationId, studentId nullable', () => {
    const result = descriptor.responseSchema.safeParse({
      speakingTurns: [
        { stationId: cuid, studentId: null, role: 'MEMBER', startMs: 0, endMs: 900 },
        { stationId: null, studentId: null, teacherUserId: cuid, role: 'TEACHER', startMs: 1000, endMs: 2000 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('regression: rejects the old studentId-only turn shape (see definitions.ts)', () => {
    const result = descriptor.responseSchema.safeParse({
      speakingTurns: [{ studentId: cuid, startMs: 0, endMs: 900 }],
    });
    expect(result.success).toBe(false);
  });

  it('only a TEACHER turn may have no station', () => {
    const turn = { stationId: null, studentId: null, startMs: 0, endMs: 1 };
    expect(descriptor.responseSchema.safeParse({ speakingTurns: [{ ...turn, role: 'MEMBER' }] }).success).toBe(false);
    expect(descriptor.responseSchema.safeParse({ speakingTurns: [{ ...turn, role: 'TEACHER' }] }).success).toBe(true);
  });
});

describe('WRITING_TEST config', () => {
  const descriptor = getActivity(ActivityType.WRITING_TEST);

  it('is valid with no limits at all — the prompt lives in the item bank, not the config', () => {
    expect(descriptor.configSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a word-count range and rejects an inverted one', () => {
    expect(descriptor.configSchema.safeParse({ minWords: 100, maxWords: 250 }).success).toBe(true);
    expect(descriptor.configSchema.safeParse({ minWords: 300, maxWords: 250 }).success).toBe(false);
  });
});

describe('LISTENING_TEST config', () => {
  const descriptor = getActivity(ActivityType.LISTENING_TEST);

  it('requires the audio clip', () => {
    expect(descriptor.configSchema.safeParse({}).success).toBe(false);
    expect(descriptor.configSchema.safeParse({ audioAssetId: cuid }).success).toBe(true);
  });
});

describe('VOCABULARY_TEST config', () => {
  it('requires either itemBankId or a non-empty items[] (the two serving modes)', () => {
    const descriptor = getActivity(ActivityType.VOCABULARY_TEST);
    expect(descriptor.configSchema.safeParse({ shuffleItems: true }).success).toBe(false);
    expect(descriptor.configSchema.safeParse({ itemBankId: cuid, shuffleItems: true }).success).toBe(true);
    expect(descriptor.configSchema.safeParse({ items: [{ prompt: 'q', answer: 'a' }] }).success).toBe(true);
  });
});

describe('READING_TEST', () => {
  const descriptor = getActivity(ActivityType.READING_TEST);

  it('config is valid with no fields at all — the passage lives in the item bank, not the config — and defaults the voice', () => {
    const result = descriptor.configSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.success && (result.data as { voice?: string }).voice).toBe('en_GB');
    expect(descriptor.configSchema.safeParse({ voice: 'fr' }).success).toBe(false);
  });

  it('response requires the recording id', () => {
    expect(descriptor.responseSchema.safeParse({}).success).toBe(false);
    expect(descriptor.responseSchema.safeParse({ studentAudioAssetId: cuid }).success).toBe(true);
  });
});
