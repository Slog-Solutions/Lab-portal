import { activity, say, type ItemDraft } from '../build';
import type { CatalogTag, CatalogTrack } from '../types';
import { CONNECTED_SPEECH_TAGS, CONNECTED_SPEECH_UNIT } from './connected-speech';
import { IPA_UNIT } from './ipa';
import { MINIMAL_PAIRS_TAGS, MINIMAL_PAIRS_UNIT } from './minimal-pairs';
import { PHRASE_STRESS_UNIT, WORD_STRESS_TAGS, WORD_STRESS_UNIT } from './word-stress';

/**
 * Back-chaining (Ser 10 "recording tool and back chaining facility"): a
 * long sentence is built up from its END — "evening" → "on Friday evening"
 * → ... — so the learner always finishes on the familiar, well-practised
 * part with natural intonation. `|` marks the chunk boundaries.
 */
function backchain(sentence: string): ItemDraft {
  const groups = sentence.split('|').map((g) => g.trim());
  const chunks = groups.map((_, i) => groups.slice(groups.length - 1 - i).join(' '));
  const full = groups.join(' ');
  return {
    kind: 'record',
    prompt: full,
    audio: say(full),
    chunks,
  };
}

const BACKCHAIN_SETS: Array<{ key: string; title: string; cefr: 'A2' | 'B1' | 'B2'; sentences: string[] }> = [
  {
    key: 'pron.backchain.everyday',
    title: 'Back-chaining: everyday requests',
    cefr: 'A2',
    sentences: [
      "I'd like | to book | a table | for two | on Friday | evening.",
      'Could you | tell me | the way | to the | railway station?',
      'We are going | to visit | my grandparents | at the weekend.',
      'Can I | have a cup | of tea | with milk, | please?',
      "I'm sorry, | I didn't | catch | your name.",
      'The next bus | to the city centre | leaves | in ten minutes.',
    ],
  },
  {
    key: 'pron.backchain.work',
    title: 'Back-chaining: at work',
    cefr: 'B1',
    sentences: [
      'I have been working | on this report | since | nine o\'clock | this morning.',
      'Would it be possible | to move the meeting | to Thursday | afternoon?',
      'Please make sure | that all the doors | are locked | before you leave.',
      'The training session | will begin | at half past ten | in the main hall.',
      'If you have | any questions, | please contact | the office | directly.',
      'We need | to finish | the inspection | by the end | of the week.',
    ],
  },
  {
    key: 'pron.backchain.presenting',
    title: 'Back-chaining: presenting and discussing',
    cefr: 'B2',
    sentences: [
      "In today's presentation | I would like | to outline | the main findings | of our survey.",
      'Although the results | were encouraging, | there is still | a great deal | of work to do.',
      'I completely agree | with your point, | but we should also | consider the cost.',
      'The committee has decided | to postpone | the annual meeting | until further notice.',
      'Could you explain | a little more | about how | the new system | will work?',
      'To sum up, | careful planning | is the key | to a successful | project.',
    ],
  },
];

export const PRONUNCIATION_TAGS: Record<string, CatalogTag> = {
  'ipa.vowels': { label: 'Vowel sounds', activityKey: 'pron.ipa.chart' },
  'ipa.consonants': { label: 'Consonant sounds', activityKey: 'pron.ipa.chart' },
  'ipa.transcription': { label: 'Reading phonetic symbols', activityKey: 'pron.ipa.chart' },
  ...MINIMAL_PAIRS_TAGS,
  ...WORD_STRESS_TAGS,
  ...CONNECTED_SPEECH_TAGS,
};

export const PRONUNCIATION_TRACK: CatalogTrack = {
  key: 'pronunciation',
  title: 'Pronunciation',
  description: 'The phonemic alphabet, similar sounds, word and phrase stress, connected speech, and back-chaining with your own recordings.',
  units: [
    IPA_UNIT,
    MINIMAL_PAIRS_UNIT,
    WORD_STRESS_UNIT,
    PHRASE_STRESS_UNIT,
    CONNECTED_SPEECH_UNIT,
    {
      key: 'pron-backchain',
      title: 'Record & Back-chain',
      description: 'Build long sentences up from the end, recording yourself at each step and comparing with the model.',
      activities: BACKCHAIN_SETS.map((set) =>
        activity({
          key: set.key,
          title: set.title,
          kind: 'backchain',
          cefr: set.cefr,
          skill: 'speaking',
          mode: 'practice',
          intro: 'Listen to each part, say it, then add the part before it. Record the whole sentence at the end and compare it with the model.',
          items: set.sentences.map(backchain),
        }),
      ),
    },
  ],
};

/** The "Stress & Rhythm" section (Ser 10: "over 600 sound items"). */
export const STRESS_AND_RHYTHM_UNIT_KEYS = [WORD_STRESS_UNIT.key, PHRASE_STRESS_UNIT.key, CONNECTED_SPEECH_UNIT.key];
