import { activity, ids, say, type ItemDraft } from '../build';
import type { CatalogActivity, CatalogTag, CatalogTrack, CatalogUnit } from '../types';
import type { Tense } from './helpers';
import { FUTURE_TENSES } from './future';
import { MIXED } from './mixed';
import { PAST_TENSES } from './past';
import { PRESENT_TENSES } from './present';

/**
 * Ser 10 Grammar: "a larger grammar section which highlights the
 * particular areas where the learner mistake ... Each tense covered in the
 * grammar section has a quiz", plus the "Large Test Bank" — "each time the
 * learner does the test they will get a different set of questions".
 *
 *  - every tense: a tutorial (test-as-you-learn) and a quiz that serves a
 *    random sample of that tense's bank;
 *  - a test bank over ALL banks, a different set each attempt;
 *  - a follow-up quiz built from the areas THIS learner last got wrong.
 *
 * Every item is tagged with its tense, so a mistake anywhere lists that
 * tense under "areas to review", linking to its lesson.
 */

const TENSES: Tense[] = [...PRESENT_TENSES, ...PAST_TENSES, ...FUTURE_TENSES];

const tagOf = (tense: string) => `grammar.${tense}`;
const lessonKey = (tense: string) => `grammar.${tense}.lesson`;

/** Tag an item with its tense, and default its explanation to the tense's rule. */
function tagged(item: ItemDraft, tense: Tense | { key: string; hint: string }): ItemDraft {
  return { ...item, tag: tagOf(tense.key), ...('explain' in item && item.explain ? {} : { explain: tense.hint }) } as ItemDraft;
}

const QUIZ_SIZE = 10;
const GROUP_TEST_SIZE = 15;
export const TEST_BANK_SIZE = 25;
const FOLLOW_UP_SIZE = 20;

function lesson(tense: Tense): CatalogActivity {
  const items: ItemDraft[] = [];
  const steps = tense.steps.map((step) => {
    const from = items.length + 1;
    items.push(...step.checks.map((c) => tagged(c, tense)));
    return {
      title: step.title,
      body: step.body,
      ...(step.examples ? { examples: step.examples.map(([text, note]) => ({ speech: say(text), ...(note ? { note } : {}) })) } : {}),
      checkItemIds: ids(from, items.length),
    };
  });
  return activity({
    key: lessonKey(tense.key),
    title: `${tense.title}: lesson`,
    kind: 'tutorial',
    cefr: tense.cefr,
    skill: 'grammar',
    mode: 'practice',
    topic: tense.title,
    intro: tense.hint,
    steps,
    items,
  });
}

function quiz(tense: Tense): CatalogActivity {
  return activity({
    key: `grammar.${tense.key}.quiz`,
    title: `${tense.title}: quiz`,
    kind: 'quiz',
    cefr: tense.cefr,
    skill: 'grammar',
    mode: 'test',
    topic: tense.title,
    intro: `${QUIZ_SIZE} questions picked at random from a bank of ${tense.bank.length} — you get a different set every time.`,
    sampleSize: QUIZ_SIZE,
    items: tense.bank.map((i) => tagged(i, tense)),
  });
}

const BY_KEY = new Map(TENSES.map((t) => [t.key, t]));

/** Every banked question, plus the cross-tense contrast items. */
const ALL_ITEMS: ItemDraft[] = [
  ...TENSES.flatMap((t) => t.bank.map((i) => tagged(i, t))),
  ...MIXED.map(([key, item]) => {
    const tense = BY_KEY.get(key);
    if (!tense) throw new Error(`grammar mixed item refers to unknown tense "${key}"`);
    return tagged(item, tense);
  }),
];

function groupTest(group: Tense['group'], title: string, cefr: CatalogActivity['cefr']): CatalogActivity {
  const tenses = TENSES.filter((t) => t.group === group);
  const keys = new Set(tenses.map((t) => tagOf(t.key)));
  return activity({
    key: `grammar.test.${group}`,
    title,
    kind: 'quiz',
    cefr,
    skill: 'grammar',
    mode: 'test',
    intro: `${GROUP_TEST_SIZE} questions from every ${group} tense, a different set each time.`,
    sampleSize: GROUP_TEST_SIZE,
    items: ALL_ITEMS.filter((i) => 'tag' in i && i.tag && keys.has(i.tag)),
  });
}

const GROUP_UNITS: Array<{ group: Tense['group']; title: string; description: string }> = [
  { group: 'present', title: 'Present tenses', description: 'Present simple, continuous, perfect and perfect continuous.' },
  { group: 'past', title: 'Past tenses', description: 'Past simple, continuous, perfect and perfect continuous.' },
  { group: 'future', title: 'Future forms', description: 'Will, going to, future continuous, future perfect and future perfect continuous.' },
];

const TEST_UNIT: CatalogUnit = {
  key: 'grammar-tests',
  title: 'Test bank and follow-up',
  description: 'Random tests from the whole grammar bank, and a quiz built from the areas you got wrong.',
  activities: [
    activity({
      key: 'grammar.testbank',
      title: 'Grammar test bank (random)',
      kind: 'quiz',
      cefr: 'B1',
      skill: 'grammar',
      mode: 'test',
      intro: `${TEST_BANK_SIZE} questions drawn at random from ${ALL_ITEMS.length} across every tense. Take it again and again — each time the set is different, so your score stays a fair measure.`,
      sampleSize: TEST_BANK_SIZE,
      items: ALL_ITEMS,
    }),
    activity({
      key: 'grammar.followup',
      title: 'Follow-up quiz: my weak areas',
      kind: 'quiz',
      cefr: 'B1',
      skill: 'grammar',
      mode: 'test',
      intro: `${FOLLOW_UP_SIZE} questions from the tenses you got wrong most recently, to check you understood them. If there is nothing to follow up yet, it is a random mix.`,
      sampleSize: FOLLOW_UP_SIZE,
      followUp: true,
      items: ALL_ITEMS,
    }),
    groupTest('present', 'Test: present tenses (random)', 'A2'),
    groupTest('past', 'Test: past tenses (random)', 'A2'),
    groupTest('future', 'Test: future forms (random)', 'B1'),
  ],
};

export const GRAMMAR_TRACK: CatalogTrack = {
  key: 'grammar',
  title: 'Grammar',
  description: 'A lesson and a quiz for every tense, a large random test bank, and a follow-up quiz on the areas you got wrong.',
  units: [
    ...GROUP_UNITS.map(
      ({ group, title, description }): CatalogUnit => ({
        key: `grammar-${group}`,
        title,
        description,
        activities: TENSES.filter((t) => t.group === group).flatMap((t) => [lesson(t), quiz(t)]),
      }),
    ),
    TEST_UNIT,
  ],
};

export const GRAMMAR_TAGS: Record<string, CatalogTag> = Object.fromEntries(
  TENSES.map((t) => [tagOf(t.key), { label: t.title, activityKey: lessonKey(t.key) }] as const),
);

/** For the spec: how many distinct questions the bank holds. */
export const GRAMMAR_BANK_SIZE = ALL_ITEMS.length;
export const GRAMMAR_TENSE_KEYS = TENSES.map((t) => t.key);
