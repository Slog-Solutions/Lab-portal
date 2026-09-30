import { z } from 'zod';

/**
 * Annexure-I Ser 10 "English Content" — the built-in, originally authored
 * English Course. The content itself lives server-side only
 * (apps/server/src/modules/english-course/catalog), so a test-mode
 * activity's answer key never reaches a student seat before submission;
 * these are the shapes that travel over the wire.
 */

export const COURSE_TRACKS = ['pronunciation', 'rhythm', 'listening', 'reading', 'grammar', 'writing'] as const;
export type CourseTrack = (typeof COURSE_TRACKS)[number];

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/** Written to SkillProgress.skill on every scored attempt. */
export type CourseSkill = 'pronunciation' | 'speaking' | 'listening' | 'reading' | 'grammar' | 'writing';

export type CourseVoice = 'en_GB' | 'en_US';

/** One stretch of speech the seat voices through POST /pronunciation/speak. */
export interface CourseSpeech {
  text: string;
  voice?: CourseVoice;
  /** Dialogue speaker label, shown next to the line once revealed. */
  speaker?: string;
}

/**
 * Every answerable thing in the course is one of these. The answer fields
 * (`answer`/`answers`) are always present in the server catalog; the view
 * sent to a seat keeps them only for a practice-mode activity (instant
 * "test-as-you-learn" feedback) and strips them for a test-mode one. The
 * server grades every submission itself either way.
 *
 * Answers travel as strings keyed by item id: a choice/stress item's
 * answer is the chosen choice text / unit index, a multi item's is its
 * chosen choices joined by MULTI_ANSWER_SEPARATOR, a record item's is the
 * Recording id.
 */
export type CourseItem =
  | {
      id: string;
      kind: 'choice';
      prompt?: string;
      audio?: CourseSpeech[];
      choices: string[];
      answer?: string;
      explain?: string;
      tag?: string;
      /** Listening "gist then detail" ordering (General Listening Task). */
      phase?: 'gist' | 'detail';
    }
  | {
      id: string;
      kind: 'multi';
      prompt?: string;
      audio?: CourseSpeech[];
      choices: string[];
      answers?: string[];
      explain?: string;
      tag?: string;
    }
  | {
      id: string;
      kind: 'gap';
      prompt?: string;
      /** The sentence with exactly one `___` where the answer goes. */
      text: string;
      audio?: CourseSpeech[];
      /** Every accepted answer (compared case/punctuation-insensitively). */
      answers?: string[];
      explain?: string;
      tag?: string;
    }
  | {
      id: string;
      kind: 'stress';
      prompt?: string;
      /** Syllables of a word, or words of a phrase — the student taps the stressed one. */
      units: string[];
      audio?: CourseSpeech[];
      ipa?: string;
      /** Index into `units`. */
      answer?: number;
      explain?: string;
      tag?: string;
    }
  | {
      id: string;
      kind: 'field';
      /** Note-taking form field label ("Name", "Departure time"...). */
      label: string;
      answers?: string[];
      tag?: string;
    }
  | {
      id: string;
      kind: 'write';
      prompt: string;
      minWords: number;
      /** Language the task asks for (linking words, a tense...). A text
       * "meets the task" when it is long enough AND uses at least
       * `mustUseMin` of these (default: all). Quality is not machine-judged
       * — a teacher reads the text; the checklist is for self-review. */
      mustUse?: string[];
      mustUseMin?: number;
      /** A model answer, revealed with the result (stripped from a test view). */
      model?: string;
      tag?: string;
    }
  | {
      id: string;
      kind: 'record';
      prompt: string;
      audio?: CourseSpeech[];
      /** Back-chaining build-up, shortest (sentence end) first. */
      chunks?: string[];
    };

export type CourseItemKind = CourseItem['kind'];

export const MULTI_ANSWER_SEPARATOR = '|';

/** How the seat renders an activity. */
export type CourseActivityKind =
  | 'ipa-chart'
  | 'pairs-game'
  | 'quiz'
  | 'tutorial'
  | 'backchain'
  | 'rhythm-text'
  | 'listening'
  | 'listen-respond'
  | 'note-taking'
  | 'speed-reading'
  | 'grammar-lesson'
  | 'writing';

export interface IpaPhoneme {
  symbol: string;
  group: 'short-vowel' | 'long-vowel' | 'diphthong' | 'consonant';
  /** Example words; the sound is shown in brackets, e.g. "sh[i]p". */
  examples: string[];
  voiced?: boolean;
  tip?: string;
}

/** A step-by-step tutorial page ("test-as-you-learn"): explanation first,
 * then the check items that must be answered before moving on. */
export interface CourseTutorialStep {
  title: string;
  /** Plain paragraphs; `**word**` marks stress/emphasis. */
  body: string[];
  examples?: Array<{ speech: CourseSpeech[]; note?: string }>;
  checkItemIds?: string[];
}

export interface RhythmLine {
  speaker?: string;
  /** Stressed syllables in CAPITALS mark the beat: "i WANT a CUP of TEA". */
  text: string;
  /** The same line in normal case, for the voice ("I want a cup of tea."). */
  spoken: string;
  voice?: CourseVoice;
}

export interface CourseActivityView {
  key: string;
  exerciseId: string;
  track: CourseTrack;
  unitKey: string;
  title: string;
  kind: CourseActivityKind;
  cefr: CefrLevel;
  skill: CourseSkill;
  mode: 'practice' | 'test';
  topic?: string;
  intro?: string;
  steps?: CourseTutorialStep[];
  items: CourseItem[];
  /** ipa-chart */
  phonemes?: IpaPhoneme[];
  /** listening / note-taking: the recording the questions are about. */
  script?: CourseSpeech[];
  /** listen-respond: the dialogue, with the learner's turns as item ids. */
  dialogue?: Array<{ speech: CourseSpeech } | { itemId: string; speaker: string }>;
  /** note-taking: what the form is ("Telephone message", "Timetable"). */
  form?: { title: string; instructions?: string };
  /** rhythm-text */
  rhythm?: { genre: 'dialogue' | 'joke' | 'poem' | 'rhyme' | 'quotation'; lines: RhythmLine[] };
  /** speed-reading */
  passage?: { title: string; text: string; wordCount: number };
  /** writing */
  writing?: {
    task: string;
    minWords: number;
    checklist: string[];
    /** The worksheet's parts (reading, listening, language, speaking,
     * writing), each a run of this activity's items. */
    parts: Array<{ title: string; instructions?: string; itemIds: string[] }>;
  };
}

export interface CourseActivitySummary {
  key: string;
  exerciseId: string;
  title: string;
  kind: CourseActivityKind;
  cefr: CefrLevel;
  skill: CourseSkill;
  mode: 'practice' | 'test';
  topic?: string;
  itemCount: number;
  /** Only in a student's catalog. */
  progress?: { attempts: number; best: number | null; last: number | null; lastAt: string | null };
}

export interface CourseUnitView {
  key: string;
  title: string;
  description?: string;
  activities: CourseActivitySummary[];
}

export interface CourseTrackView {
  key: CourseTrack;
  title: string;
  description: string;
  units: CourseUnitView[];
}

export interface CourseCatalogView {
  tracks: CourseTrackView[];
}

export interface StartedCourseActivity {
  attemptId: string;
  activity: CourseActivityView;
}

export interface CourseReviewArea {
  tag: string;
  label: string;
  missed: number;
  total: number;
  /** Where to go to study/re-test this area (the follow-up quiz). */
  activityKey?: string;
}

export interface CourseItemResult {
  itemId: string;
  given: string | null;
  correct: boolean | null;
  /** Display form of the right answer (null for an ungraded record item). */
  expected: string | null;
  explain?: string;
}

export interface CourseResultView {
  attemptId: string;
  activityKey: string;
  score: number;
  correct: number;
  total: number;
  items: CourseItemResult[];
  reviewAreas: CourseReviewArea[];
  metrics: { durationMs: number; wpm?: number };
  best: number | null;
  attempts: number;
  /** Full transcript etc., revealed only after submission. */
  activity: CourseActivityView;
}

export interface CourseProgressView {
  totals: { attempts: number; activitiesDone: number; activitiesTotal: number; minutes: number; average: number | null };
  byTrack: Array<{ track: CourseTrack; title: string; done: number; total: number; average: number | null }>;
  bySkill: Array<{ skill: string; average: number | null; series: Array<{ at: string; score: number }> }>;
  recent: Array<{
    attemptId: string;
    activityKey: string;
    title: string;
    track: CourseTrack;
    score: number | null;
    at: string;
    durationMs: number | null;
  }>;
  reviewAreas: CourseReviewArea[];
  readingSpeed: Array<{ at: string; wpm: number; comprehension: number }>;
  recordings: Array<{ id: string; activityKey: string; title: string; createdAt: string; durationMs: number | null }>;
}

export const zStartCourseActivityDto = z.object({
  assignmentId: z.string().min(1).optional(),
});
export type StartCourseActivityDto = z.infer<typeof zStartCourseActivityDto>;

export const zSubmitCourseActivityDto = z.object({
  answers: z.record(z.string(), z.string().max(20_000)),
  /** Time the learner spent, as the seat measured it (capped server-side). */
  durationMs: z.number().int().nonnegative().max(24 * 3600 * 1000),
  /** speed-reading: how long the passage was on screen. */
  readingMs: z.number().int().positive().max(3600 * 1000).optional(),
});
export type SubmitCourseActivityDto = z.infer<typeof zSubmitCourseActivityDto>;
