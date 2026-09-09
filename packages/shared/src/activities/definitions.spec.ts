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

describe('VOCABULARY_TEST config', () => {
  it('requires either itemBankId or a non-empty items[] (the two serving modes)', () => {
    const descriptor = getActivity(ActivityType.VOCABULARY_TEST);
    expect(descriptor.configSchema.safeParse({ shuffleItems: true }).success).toBe(false);
    expect(descriptor.configSchema.safeParse({ itemBankId: cuid, shuffleItems: true }).success).toBe(true);
    expect(descriptor.configSchema.safeParse({ items: [{ prompt: 'q', answer: 'a' }] }).success).toBe(true);
  });
});
