import { describe, expect, it } from 'vitest';
import { ActivityType } from '@lab/shared';
import { projectConfigForStation } from './served-config';
import { findAnswerLeaks } from './answer-leak.spec-helper';

/** GF-6: "capture the wire payload delivered to a station during the
 * test — it must contain none of the correct-answer strings, and no
 * explanation text". This is the automated regression the spec asks for. */
describe('projectConfigForStation (GF-6)', () => {
  it('strips items and itemBankId from an inline VOCABULARY_TEST config, keeping only settings', () => {
    const config = {
      items: [
        { prompt: 'Capital of France?', answer: 'Paris', choices: ['Paris', 'Lyon', 'Nice'], explanation: 'Paris is the capital.' },
      ],
      shuffleItems: true,
      timeLimitSec: 600,
      revealMode: 'ON_TIME_EXPIRY',
      revealDetail: 'FULL_ANSWERS',
      allowReview: true,
    };
    const projected = projectConfigForStation(ActivityType.VOCABULARY_TEST, config);
    expect(projected).toEqual({
      shuffleItems: true,
      timeLimitSec: 600,
      revealMode: 'ON_TIME_EXPIRY',
      revealDetail: 'FULL_ANSWERS',
      allowReview: true,
    });
    const leaks = findAnswerLeaks(projected, { answers: ['Paris'], explanations: ['Paris is the capital.'] });
    expect(leaks).toEqual([]);
  });

  it('strips itemBankId from a bank-mode config too', () => {
    const projected = projectConfigForStation(ActivityType.VOCABULARY_TEST, { itemBankId: 'bank1', sampleSize: 10 });
    expect(projected).toEqual({ sampleSize: 10 });
  });

  it('passes through any other activity type unmodified', () => {
    const config = { masterTrackAssetId: 'asset1' };
    expect(projectConfigForStation(ActivityType.MODEL_IMITATION, config)).toBe(config);
  });

  it('is a no-op on a non-object config', () => {
    expect(projectConfigForStation(ActivityType.VOCABULARY_TEST, null)).toBeNull();
    expect(projectConfigForStation(ActivityType.VOCABULARY_TEST, undefined)).toBeUndefined();
  });
});

describe('findAnswerLeaks helper (test infrastructure sanity check)', () => {
  it('flags an answer string outside a choices array', () => {
    const leaks = findAnswerLeaks({ answer: 'Paris' }, { answers: ['Paris'] });
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.kind).toBe('answer');
  });

  it('does not flag the same string inside a choices array', () => {
    const leaks = findAnswerLeaks({ choices: ['Paris', 'Lyon'] }, { answers: ['Paris'] });
    expect(leaks).toEqual([]);
  });

  it('always flags an explanation string, choices array or not', () => {
    const leaks = findAnswerLeaks({ choices: ['Paris is nice.'] }, { answers: [], explanations: ['Paris is nice.'] });
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.kind).toBe('explanation');
  });
});
