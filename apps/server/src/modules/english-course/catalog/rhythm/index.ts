import type { CourseVoice, RhythmLine } from '@lab/shared';
import { activity, gapsFrom, type ItemDraft } from '../build';
import type { CatalogTag, CatalogTrack } from '../types';
import { RHYTHM_UNITS, type RhythmText } from './texts';

/** "i WANT a CUP of TEA" → "I want a cup of tea" (brackets kept for gapsFrom). */
export function toSpoken(notation: string): string {
  const lower = notation.toLowerCase().replace(/\bi\b/g, 'I');
  const first = lower.search(/[a-z]/);
  return first < 0 ? lower : lower.slice(0, first) + lower[first]!.toUpperCase() + lower.slice(first + 1);
}

const VOICES: CourseVoice[] = ['en_GB', 'en_US'];

function buildLines(text: RhythmText): RhythmLine[] {
  const speakers: string[] = [];
  return text.lines.map((raw) => {
    const m = /^([A-Za-z]+): (.*)$/.exec(raw);
    const speaker = m?.[1];
    const body = m ? m[2]! : raw;
    if (speaker && !speakers.includes(speaker)) speakers.push(speaker);
    const clean = body.replace(/\[([^\]]+)\]/g, '$1');
    return {
      ...(speaker ? { speaker } : {}),
      text: clean,
      spoken: toSpoken(clean),
      voice: speaker ? VOICES[speakers.indexOf(speaker) % VOICES.length] : 'en_GB',
    };
  });
}

function buildItems(text: RhythmText, lines: RhythmLine[]): ItemDraft[] {
  const gaps = text.lines.flatMap((raw, i) => {
    if (!raw.includes('[')) return [];
    const body = raw.replace(/^[A-Za-z]+: /, '');
    return gapsFrom(toSpoken(body), {
      prompt: 'Listen to the line and type the missing (weak) word.',
      tag: 'rhythm.weak-forms',
      voice: lines[i]!.voice,
      explain: 'Small grammar words fall between the beats — they are short, quick and often have /ə/.',
    });
  });
  const record: ItemDraft = {
    kind: 'record',
    prompt: 'Record yourself saying the whole text. Keep to the beat of the stressed syllables.',
    audio: lines.map((l) => ({ text: l.spoken, voice: l.voice, ...(l.speaker ? { speaker: l.speaker } : {}) })),
  };
  return [...gaps, record];
}

export const RHYTHM_TAGS: Record<string, CatalogTag> = {
  'rhythm.weak-forms': { label: 'Weak words between the beats', activityKey: 'pron.cs.weak-forms' },
};

const GENRE_LABEL = { dialogue: 'Dialogue', joke: 'Joke', poem: 'Poem', rhyme: 'Rhyme', quotation: 'Sayings' } as const;

/**
 * Ser 10 "Rhythm ... practice in the rhythm of spoken English throughout
 * everyday dialogues, jokes, poems, rhymes and quotations": 48 texts in 8
 * units, each tagged with a topic so they can also be browsed by topic.
 */
export const RHYTHM_TRACK: CatalogTrack = {
  key: 'rhythm',
  title: 'Rhythm',
  description: '48 dialogues, jokes, poems, rhymes and sayings. Listen to the beat, repeat line by line, fill in the weak words and build up your own set of recordings.',
  units: RHYTHM_UNITS.map((unit, u) => ({
    key: `rhythm-u${u + 1}`,
    title: unit.title,
    description: unit.texts.map((t) => t.title).join(' · '),
    activities: unit.texts.map((text, t) => {
      const lines = buildLines(text);
      return activity({
        key: `rhythm.u${u + 1}.t${t + 1}`,
        title: `${text.title} (${GENRE_LABEL[text.genre]})`,
        kind: 'rhythm-text',
        cefr: unit.cefr,
        skill: 'pronunciation',
        mode: 'practice',
        topic: text.topic,
        intro: 'The CAPITAL syllables are the beats. Listen, repeat line by line, fill the gaps, then record yourself.',
        rhythm: { genre: text.genre, lines },
        items: buildItems(text, lines),
      });
    }),
  })),
};
