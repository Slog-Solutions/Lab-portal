import { describe, expect, it } from 'vitest';
import { CATALOG, CATALOG_INDEX, CATALOG_TAGS, validateCatalog } from '.';
import { countSoundItems } from './pronunciation/connected-speech';
import { STRESS_AND_RHYTHM_UNIT_KEYS } from './pronunciation';
import { GRAMMAR_BANK_SIZE, GRAMMAR_TENSE_KEYS, TEST_BANK_SIZE } from './grammar';
import { WORKSHEETS } from './writing/worksheets';
import { writeRequirements } from '@lab/shared';

describe('English Course catalog', () => {
  it('is structurally valid (answers among choices, tags defined, tutorial checks exist...)', () => {
    expect(validateCatalog()).toEqual([]);
  });

  it('catches a broken item', () => {
    const broken = structuredClone(CATALOG);
    const first = broken[0]!.units[0]!.activities.find((a) => a.items.length > 0)!;
    const item = first.items[0]!;
    if (item.kind === 'choice') item.answer = 'not a choice';
    expect(validateCatalog(broken).length).toBeGreaterThan(0);
  });

  it('meets Ser 10: the Stress & Rhythm section has over 600 sound items', () => {
    const items = CATALOG.flatMap((t) => t.units)
      .filter((u) => STRESS_AND_RHYTHM_UNIT_KEYS.includes(u.key))
      .flatMap((u) => u.activities)
      // A tutorial reuses bank items as its checks, and the mixed tests
      // re-serve whole banks — count each distinct piece of speech once.
      .filter((a) => a.kind !== 'tutorial' && a.mode === 'practice')
      .flatMap((a) => a.items);
    const distinct = new Set(items.filter((i) => countSoundItems([i]) === 1).map((i) => JSON.stringify({ ...i, id: undefined })));
    expect(distinct.size).toBeGreaterThan(600);
  });

  it('meets Ser 10 Rhythm: 48 texts across dialogues, jokes, poems, rhymes and quotations, browsable by topic', () => {
    const rhythm = CATALOG.find((t) => t.key === 'rhythm')!;
    const texts = rhythm.units.flatMap((u) => u.activities);
    expect(texts).toHaveLength(48);
    expect(new Set(texts.map((a) => a.rhythm!.genre))).toEqual(new Set(['dialogue', 'joke', 'poem', 'rhyme', 'quotation']));
    expect(new Set(texts.map((a) => a.topic)).size).toBeGreaterThanOrEqual(6);
    for (const a of texts) {
      expect(a.items.some((i) => i.kind === 'gap'), a.key).toBe(true);
      expect(a.items.filter((i) => i.kind === 'record'), a.key).toHaveLength(1);
      // The voice reads normal case, never the CAPITALS stress notation.
      for (const line of a.rhythm!.lines) expect(line.spoken, a.key).not.toMatch(/[A-Z]{2}/);
    }
  });

  it('meets Ser 10 listening: active, listen-and-respond (3 areas), note-taking, gist-then-detail', () => {
    const units = CATALOG.find((t) => t.key === 'listening')!.units;
    const [active, respond, notes, general] = units.map((u) => u.activities);
    expect(active!.every((a) => a.script?.length && a.items.length > 0)).toBe(true);
    expect(active!.some((a) => a.items.some((i) => i.kind === 'multi'))).toBe(true);
    const areas = new Set(respond!.flatMap((a) => a.items.map((i) => ('tag' in i ? i.tag : ''))));
    expect(areas).toEqual(new Set(['listening.respond.meeting', 'listening.respond.eating', 'listening.respond.booking']));
    expect(notes!.every((a) => a.form && a.items.every((i) => i.kind === 'field'))).toBe(true);
    for (const a of general!) {
      const phases = a.items.map((i) => (i.kind === 'choice' ? i.phase : undefined));
      expect(phases.indexOf('detail'), a.key).toBeGreaterThan(phases.lastIndexOf('gist'));
      expect(phases[0], a.key).toBe('gist');
    }
  });

  it('meets Ser 10 Read Up-Speed Up: timed, graded passages with comprehension questions', () => {
    const passages = CATALOG.find((t) => t.key === 'reading')!.units.flatMap((u) => u.activities).filter((a) => a.kind === 'speed-reading');
    expect(passages.length).toBeGreaterThanOrEqual(12);
    expect(new Set(passages.map((a) => a.cefr)).size).toBeGreaterThanOrEqual(4);
    for (const a of passages) {
      expect(a.passage!.wordCount, a.key).toBeGreaterThan(100);
      expect(a.mode, a.key).toBe('test');
      expect(a.items.length, a.key).toBeGreaterThanOrEqual(5);
    }
    // Longer texts at higher levels
    const avg = (lvl: string) => {
      const xs = passages.filter((a) => a.cefr === lvl).map((a) => a.passage!.wordCount);
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    };
    expect(avg('C1')).toBeGreaterThan(avg('A2'));
  });

  it('meets Ser 10 grammar: a lesson and a quiz for every tense, tagged so mistakes point back to the lesson', () => {
    const acts = CATALOG.find((t) => t.key === 'grammar')!.units.flatMap((u) => u.activities);
    const byKey = new Map(acts.map((a) => [a.key, a]));
    expect(GRAMMAR_TENSE_KEYS).toHaveLength(13);
    for (const tense of GRAMMAR_TENSE_KEYS) {
      const lesson = byKey.get(`grammar.${tense}.lesson`);
      const quiz = byKey.get(`grammar.${tense}.quiz`);
      expect(lesson?.kind, tense).toBe('tutorial');
      expect(lesson!.steps!.length, tense).toBeGreaterThanOrEqual(3);
      expect(quiz?.mode, tense).toBe('test');
      expect(quiz!.items.length, tense).toBeGreaterThanOrEqual(20);
      expect(quiz!.sampleSize, tense).toBeLessThan(quiz!.items.length);
      expect(CATALOG_TAGS[`grammar.${tense}`]?.activityKey, tense).toBe(`grammar.${tense}.lesson`);
      for (const item of quiz!.items) expect('tag' in item && item.tag, tense).toBe(`grammar.${tense}`);
    }
  });

  it('meets Ser 10 "Large Test Bank": a big bank, a different random set per attempt, and a follow-up quiz', () => {
    const bank = CATALOG_INDEX.get('grammar.testbank')!.activity;
    expect(GRAMMAR_BANK_SIZE).toBeGreaterThanOrEqual(250);
    expect(bank.items).toHaveLength(GRAMMAR_BANK_SIZE);
    expect(bank.sampleSize).toBe(TEST_BANK_SIZE);
    // No question is asked twice in the bank (by its wording and answer).
    const seen = new Set(bank.items.map((i) => JSON.stringify([('prompt' in i && i.prompt) || '', 'text' in i ? i.text : '', 'answer' in i ? i.answer : 'answers' in i ? i.answers : ''])));
    expect(seen.size).toBe(bank.items.length);
    const followUp = CATALOG_INDEX.get('grammar.followup')!.activity;
    expect(followUp.followUp).toBe(true);
    expect(followUp.items).toHaveLength(GRAMMAR_BANK_SIZE);
  });

  it('meets Ser 10 CEFR worksheets: reading, listening, speaking and writing, from A1 to C1, each with a model that meets its own task', () => {
    const sheets = CATALOG.find((t) => t.key === 'writing')!.units.flatMap((u) => u.activities);
    expect(sheets).toHaveLength(WORKSHEETS.length);
    expect(new Set(sheets.map((a) => a.cefr))).toEqual(new Set(['A1', 'A2', 'B1', 'B2', 'C1']));
    for (const a of sheets) {
      const kinds = new Set(a.items.map((i) => i.kind));
      expect(kinds.has('choice') && kinds.has('record') && kinds.has('write'), a.key).toBe(true);
      expect(a.items.some((i) => i.kind === 'choice' && i.audio?.length), `${a.key} has a listening item`).toBe(true);
      expect(a.passage?.wordCount, a.key).toBeGreaterThan(30);
      expect(a.writing!.parts.flatMap((p) => p.itemIds).sort(), a.key).toEqual(a.items.map((i) => i.id).sort());
      const write = a.items.find((i) => i.kind === 'write')!;
      if (write.kind !== 'write') throw new Error('unreachable');
      expect(writeRequirements(write, write.model ?? '').met, `${a.key}: the model answer meets its own requirements`).toBe(true);
    }
  });

  it('gives every activity a unique key', () => {
    const keys = CATALOG.flatMap((t) => t.units.flatMap((u) => u.activities.map((a) => a.key)));
    expect(new Set(keys).size).toBe(keys.length);
    expect(CATALOG_INDEX.size).toBe(keys.length);
  });
});
