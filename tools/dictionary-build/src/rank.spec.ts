import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWnLmf } from './oewn/parse-lmf.js';
import { rankEntries } from './rank.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_XML = readFileSync(path.resolve(HERE, '../fixtures/mini-oewn.xml'), 'utf-8');

describe('rankEntries', () => {
  const parsed = parseWnLmf(FIXTURE_XML);
  const { entries, stats } = rankEntries(parsed.entries);

  it('drops archaic/obsolete senses', () => {
    const run = entries.find((e) => e.headwordLc === 'run')!;
    expect(run.senses).toHaveLength(2);
    expect(run.senses.every((s) => !s.definition.includes('flow or discharge'))).toBe(true);
  });

  it('drops an entry entirely once every sense is archaic', () => {
    expect(entries.find((e) => e.headwordLc === 'allarchaic')).toBeUndefined();
    expect(stats.droppedEmptyEntries).toBeGreaterThanOrEqual(1);
  });

  it('caps at 5 senses per headword+POS', () => {
    const manyverb = entries.find((e) => e.headwordLc === 'manyverb')!;
    expect(manyverb.senses).toHaveLength(5);
    expect(stats.cappedBeyondFiveSenses).toBeGreaterThanOrEqual(1);
  });

  it('renumbers surviving senses starting at 1', () => {
    const run = entries.find((e) => e.headwordLc === 'run')!;
    expect(run.senses.map((s) => s.ord)).toEqual([1, 2]);
  });

  it('cleans markup out of the definition', () => {
    const markuptest = entries.find((e) => e.headwordLc === 'markuptest')!;
    const def = markuptest.senses[0]!.definition;
    for (const marker of ['{{', '[[', '<ref', '&lt;']) {
      expect(def).not.toContain(marker);
    }
  });

  it('builds the inflection form list for each entry', () => {
    const run = entries.find((e) => e.headwordLc === 'run')!;
    expect(run.forms.sort()).toEqual(['ran', 'running', 'runs']);
    const mouse = entries.find((e) => e.headwordLc === 'mouse')!;
    expect(mouse.forms).toContain('mice');
  });

  it('assigns a lower freq_rank to the more polysemous headword', () => {
    const run = entries.find((e) => e.headwordLc === 'run')!;
    const quick = entries.find((e) => e.headwordLc === 'quick')!;
    // "run" has more surviving senses across its group than "quick" (1) —
    // more senses -> more common -> lower (better) freq_rank.
    expect(run.freqRank).toBeLessThan(quick.freqRank);
  });

  it('keeps only the first example sentence per sense', () => {
    const run = entries.find((e) => e.headwordLc === 'run')!;
    expect(run.senses[0]!.example).toBe('She ran to the store.');
  });

  it('carries synonyms through unchanged from the parser', () => {
    const resolve = entries.find((e) => e.headwordLc === 'resolve')!;
    expect(resolve.senses[0]!.synonyms).toEqual(['settle']);
  });
});
