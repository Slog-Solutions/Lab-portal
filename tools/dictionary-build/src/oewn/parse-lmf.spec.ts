import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWnLmf } from './parse-lmf.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_XML = readFileSync(path.resolve(HERE, '../../fixtures/mini-oewn.xml'), 'utf-8');

describe('parseWnLmf', () => {
  const result = parseWnLmf(FIXTURE_XML);

  it('parses every LexicalEntry with a recognized POS', () => {
    const headwords = result.entries.map((e) => e.headword);
    expect(headwords).toEqual(
      expect.arrayContaining(['run', 'scurry', 'mouse', 'resolve', 'settle', 'quick', 'markuptest', 'manyverb', 'allarchaic']),
    );
  });

  it('skips an entry whose POS is not noun/verb/adj/adv', () => {
    expect(result.entries.some((e) => e.headword === 'unknownpos')).toBe(false);
    expect(result.stats.skippedPosCount).toBe(1);
  });

  it('maps LMF POS codes to the dictionary POS vocabulary', () => {
    const run = result.entries.find((e) => e.headword === 'run')!;
    const mouse = result.entries.find((e) => e.headword === 'mouse')!;
    const quick = result.entries.find((e) => e.headword === 'quick')!;
    expect(run.pos).toBe('verb');
    expect(mouse.pos).toBe('noun');
    expect(quick.pos).toBe('adj');
  });

  it('collects irregular <Form> elements', () => {
    const run = result.entries.find((e) => e.headword === 'run')!;
    expect(run.irregularForms.sort()).toEqual(['ran', 'running']);
    const mouse = result.entries.find((e) => e.headword === 'mouse')!;
    expect(mouse.irregularForms).toEqual(['mice']);
  });

  it('prefers a GB pronunciation for IPA', () => {
    const run = result.entries.find((e) => e.headword === 'run')!;
    expect(run.ipa).toBe('rʌn');
    const mouse = result.entries.find((e) => e.headword === 'mouse')!;
    expect(mouse.ipa).toBeNull();
  });

  it('resolves synonyms from a synset\'s other members, excluding self', () => {
    const run = result.entries.find((e) => e.headword === 'run')!;
    const senseOne = run.senses.find((s) => s.definition.startsWith("move fast"))!;
    expect(senseOne.synonyms).toEqual(['scurry']);

    const scurry = result.entries.find((e) => e.headword === 'scurry')!;
    expect(scurry.senses[0]!.synonyms).toEqual(['run']);

    const resolve = result.entries.find((e) => e.headword === 'resolve')!;
    expect(resolve.senses[0]!.synonyms).toEqual(['settle']);
  });

  it('orders senses by the LMF sense order (n attribute)', () => {
    const run = result.entries.find((e) => e.headword === 'run')!;
    expect(run.senses.map((s) => s.ord)).toEqual([0, 1, 2]);
  });

  it('flags an archaic/obsolete-marked definition, without dropping it (rank.ts drops it)', () => {
    const run = result.entries.find((e) => e.headword === 'run')!;
    const archaicSense = run.senses.find((s) => s.definition.includes('flow or discharge'))!;
    expect(archaicSense.archaicOrRare).toBe(true);

    const allarchaic = result.entries.find((e) => e.headword === 'allarchaic')!;
    expect(allarchaic.senses[0]!.archaicOrRare).toBe(true);
  });

  it('carries raw (unstripped) markup through to rank.ts/clean.ts unchanged', () => {
    const markuptest = result.entries.find((e) => e.headword === 'markuptest')!;
    expect(markuptest.senses[0]!.definition).toContain('{{');
    expect(markuptest.senses[0]!.definition).toContain('[[');
  });

  it('keeps every sense for a headword with more than 5 (rank.ts caps it)', () => {
    const manyverb = result.entries.find((e) => e.headword === 'manyverb')!;
    expect(manyverb.senses).toHaveLength(6);
  });
});
