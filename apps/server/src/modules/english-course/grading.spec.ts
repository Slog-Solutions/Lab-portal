import { describe, expect, it } from 'vitest';
import type { CourseItem } from '@lab/shared';
import { countWords, gradeActivity, gradeItem, normalizeAnswer, pickFollowUp, shuffled } from './grading';

const choiceItem: CourseItem = { id: 'i1', kind: 'choice', choices: ['ship', 'sheep'], answer: 'sheep', tag: 'pairs.i-ii' };
const multiItem: CourseItem = { id: 'i2', kind: 'multi', choices: ['bread', 'milk', 'eggs', 'rice'], answers: ['milk', 'eggs'] };
const gapItem: CourseItem = { id: 'i3', kind: 'gap', text: "I'd like ___ cup of tea.", answers: ['a'], tag: 'cs.weak-forms' };
const stressItem: CourseItem = { id: 'i4', kind: 'stress', units: ['ba', 'na', 'na'], answer: 1 };
const fieldItem: CourseItem = { id: 'i5', kind: 'field', label: 'Departure time', answers: ['9.45', '9:45', 'quarter to ten'] };
const recordItem: CourseItem = { id: 'i6', kind: 'record', prompt: 'Say it' };

describe('normalizeAnswer', () => {
  it('ignores case, punctuation, curly quotes and extra spaces but keeps apostrophes', () => {
    expect(normalizeAnswer('  Don’t   WORRY! ')).toBe("don't worry");
    expect(normalizeAnswer("it's")).not.toBe(normalizeAnswer('its'));
    expect(normalizeAnswer('well-known')).toBe('well known');
  });
});

describe('gradeItem', () => {
  it('grades each kind', () => {
    expect(gradeItem(choiceItem, 'sheep')).toBe(true);
    expect(gradeItem(choiceItem, 'ship')).toBe(false);
    expect(gradeItem(multiItem, 'eggs|milk')).toBe(true);
    expect(gradeItem(multiItem, 'milk')).toBe(false);
    expect(gradeItem(multiItem, 'milk|eggs|rice')).toBe(false);
    expect(gradeItem(gapItem, ' A ')).toBe(true);
    expect(gradeItem(stressItem, '1')).toBe(true);
    expect(gradeItem(stressItem, '0')).toBe(false);
    expect(gradeItem(fieldItem, 'Quarter to ten.')).toBe(true);
    expect(gradeItem(recordItem, 'rec1')).toBeNull();
  });

  it('treats a missing or blank answer as wrong', () => {
    expect(gradeItem(choiceItem, undefined)).toBe(false);
    expect(gradeItem(gapItem, '   ')).toBe(false);
  });
});

describe('gradeActivity', () => {
  it('scores gradable items only and lists the areas to review', () => {
    const graded = gradeActivity(
      [choiceItem, gapItem, stressItem, recordItem],
      { i1: 'ship', i3: 'a', i4: '1', i6: 'rec1' },
      new Set(['i6']),
      { 'pairs.i-ii': { label: '/ɪ/ and /iː/', activityKey: 'pron.pairs.i-ii' }, 'cs.weak-forms': { label: 'Weak forms' } },
    );
    expect(graded.total).toBe(3);
    expect(graded.correct).toBe(2);
    expect(graded.score).toBe(66.7);
    expect(graded.graded).toBe(true);
    expect(graded.reviewAreas).toEqual([{ tag: 'pairs.i-ii', label: '/ɪ/ and /iː/', missed: 1, total: 1, activityKey: 'pron.pairs.i-ii' }]);
    expect(graded.items.find((i) => i.itemId === 'i1')).toMatchObject({ given: 'ship', correct: false, expected: 'sheep' });
    expect(graded.items.find((i) => i.itemId === 'i6')).toMatchObject({ correct: null, given: 'rec1' });
  });

  it('scores a record-only activity by completion, and flags it as not graded', () => {
    const second: CourseItem = { id: 'i7', kind: 'record', prompt: 'Again' };
    const graded = gradeActivity([recordItem, second], { i6: 'rec1', i7: 'rec-not-uploaded' }, new Set(['i6']), {});
    expect(graded.graded).toBe(false);
    expect(graded.score).toBe(50);
    expect(graded.items[1]).toMatchObject({ given: null });
  });
});

describe('helpers', () => {
  it('shuffles without losing or duplicating items', () => {
    const list = [1, 2, 3, 4, 5, 6];
    const out = shuffled(list, () => 0.3);
    expect([...out].sort()).toEqual(list);
    expect(list).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('counts words', () => {
    expect(countWords('The train leaves at 9 — from platform two.')).toBe(8);
  });
});

describe('write items', () => {
  const write: CourseItem = { id: 'w1', kind: 'write', prompt: 'Thank him.', minWords: 6, mustUse: ['thank you', 'because', 'bring'], mustUseMin: 2 };

  it('meets the task when it is long enough and uses enough of the required language', () => {
    expect(gradeItem(write, 'Thank you for the invitation, I will bring sweets.')).toBe(true);
    expect(gradeItem(write, 'Thank you, I can come, because I like parties.')).toBe(true);
  });

  it('fails a text that is too short, or that skips the required language', () => {
    expect(gradeItem(write, 'Thank you because.')).toBe(false);
    expect(gradeItem(write, 'I am happy to come to your party next week.')).toBe(false);
    expect(gradeItem(write, '   ')).toBe(false);
    expect(gradeItem(write, undefined)).toBe(false);
  });

  it('matches whole words only', () => {
    expect(gradeItem({ ...write, mustUse: ['can'], mustUseMin: 1 }, 'I scan the pages carefully every single day.')).toBe(false);
  });
});

describe('pickFollowUp', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ kind: 'choice', id: `i${i}`, tag: `grammar.t${i % 6}` }));
  const at = (n: number) => () => (n += 0.137) % 1;

  it('serves the weak tenses when there are enough of their questions', () => {
    const picked = pickFollowUp(items, new Set(['grammar.t1', 'grammar.t2']), 15, at(0.3));
    expect(picked).toHaveLength(15);
    expect(picked.every((i) => ['grammar.t1', 'grammar.t2'].includes(i.tag))).toBe(true);
    expect(new Set(picked.map((i) => i.id)).size).toBe(15);
  });

  it('tops up with other questions when the weak areas are too small a quiz', () => {
    const few = items.slice(0, 20);
    const picked = pickFollowUp(few, new Set(['grammar.t0']), 12, at(0.6));
    expect(picked).toHaveLength(12);
    expect(picked.filter((i) => i.tag === 'grammar.t0')).toHaveLength(4);
  });

  it('is a plain random sample with no weak areas', () => {
    const picked = pickFollowUp(items, new Set(), 10, at(0.1));
    expect(picked).toHaveLength(10);
    expect(new Set(picked.map((i) => i.tag)).size).toBeGreaterThan(1);
  });
});
