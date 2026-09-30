import { CEFR_LEVELS } from '@lab/shared';
import { countWords } from '../../grading';
import { activity, choice, ids, say, type ItemDraft } from '../build';
import { fill, mc } from '../grammar/helpers';
import type { CatalogActivity, CatalogTag, CatalogTrack } from '../types';
import { WORKSHEETS, type Worksheet } from './worksheets';

/**
 * Ser 10: "Content Worksheet should include different exercise covering all
 * four key skills, reading, writing, speaking and listening, [and] follow
 * CEFR." One worksheet = one situation, five parts (see ./worksheets).
 *
 * Marking: the objective parts are graded exactly; the writing task is
 * checked for what a machine can honestly check (length and the language the
 * task asks for) and the learner's text is stored for a teacher to read —
 * quality of writing is NOT machine-judged. The speaking part is recorded.
 */

export const WRITING_TAGS: Record<string, CatalogTag> = {
  'writing.reading': { label: 'Reading comprehension' },
  'writing.listening': { label: 'Listening for detail' },
  'writing.language': { label: 'Grammar and vocabulary in context', activityKey: 'grammar.testbank' },
  'writing.task': { label: 'Writing task: length and required language' },
};

function worksheet(w: Worksheet): CatalogActivity {
  const items: ItemDraft[] = [
    ...w.reading.map(([q, a, wrong]) => choice(q, a, wrong, { tag: 'writing.reading' })),
    choice(w.listening.question[0], w.listening.question[1], w.listening.question[2], { audio: say(w.listening.script), tag: 'writing.listening' }),
    ...w.language.map((l) => ({ ...(l.kind === 'mc' ? mc(l.sentence, l.answer, l.wrong) : fill(l.text, l.answers)), tag: 'writing.language' }) as ItemDraft),
    { kind: 'record', prompt: w.speaking },
    {
      kind: 'write',
      prompt: w.writing.task,
      minWords: w.writing.minWords,
      mustUse: w.writing.mustUse,
      mustUseMin: w.writing.mustUseMin,
      model: w.writing.model,
      tag: 'writing.task',
    },
  ];
  const r = w.reading.length;
  const l = w.language.length;
  const listenAt = r + 1;
  const langFrom = listenAt + 1;
  const recordAt = langFrom + l;
  const writeAt = recordAt + 1;
  const wordCount = countWords(w.passage.text);
  return activity({
    key: `writing.${w.key}`,
    title: w.title,
    kind: 'writing',
    cefr: w.cefr,
    skill: 'writing',
    mode: 'test',
    topic: w.topic,
    intro: `A ${w.cefr} worksheet in four skills: read, listen, speak and write about one topic. Take your time — there is no timer.`,
    passage: { title: w.passage.title, text: w.passage.text, wordCount },
    writing: {
      task: w.writing.task,
      minWords: w.writing.minWords,
      checklist: w.writing.checklist,
      parts: [
        { title: 'Reading', instructions: 'Read the text, then answer the questions. You can listen to the text too.', itemIds: ids(1, r) },
        { title: 'Listening', instructions: 'Play the recording as many times as you like.', itemIds: ids(listenAt) },
        { title: 'Language in context', itemIds: ids(langFrom, recordAt - 1) },
        { title: 'Speaking', instructions: 'Record your answer. You can record again.', itemIds: ids(recordAt) },
        { title: 'Writing', itemIds: ids(writeAt) },
      ],
    },
    items,
  });
}

const LEVEL_TITLE: Record<string, string> = {
  A1: 'Level A1 — Breakthrough',
  A2: 'Level A2 — Waystage',
  B1: 'Level B1 — Threshold',
  B2: 'Level B2 — Vantage',
  C1: 'Level C1 — Effective proficiency',
};

export const WRITING_TRACK: CatalogTrack = {
  key: 'writing',
  title: 'Writing and CEFR worksheets',
  description: 'Worksheets from A1 to C1 that practise reading, listening, speaking and writing together, each ending in a writing task with a model answer.',
  units: CEFR_LEVELS.filter((lvl) => WORKSHEETS.some((w) => w.cefr === lvl)).map((lvl) => ({
    key: `writing-${lvl.toLowerCase()}`,
    title: LEVEL_TITLE[lvl] ?? lvl,
    activities: WORKSHEETS.filter((w) => w.cefr === lvl).map(worksheet),
  })),
};
