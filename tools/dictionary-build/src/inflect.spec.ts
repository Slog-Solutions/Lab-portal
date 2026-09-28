import { describe, expect, it } from 'vitest';
import { buildFormsForEntry, generateRegularForms, regularAdjectiveForms, regularSAffix, regularVerbForms } from './inflect.js';

describe('regularSAffix', () => {
  it('adds -s by default', () => {
    expect(regularSAffix('run')).toBe('runs');
  });
  it('adds -es after s/x/z/ch/sh', () => {
    expect(regularSAffix('box')).toBe('boxes');
    expect(regularSAffix('church')).toBe('churches');
    expect(regularSAffix('dish')).toBe('dishes');
    expect(regularSAffix('buzz')).toBe('buzzes');
  });
  it('replaces a consonant+y with -ies', () => {
    expect(regularSAffix('party')).toBe('parties');
  });
  it('just adds -s after a vowel+y', () => {
    expect(regularSAffix('play')).toBe('plays');
  });
});

describe('regularVerbForms', () => {
  it('doubles the final consonant for a short CVC verb', () => {
    expect(regularVerbForms('run')).toEqual({ thirdPerson: 'runs', gerund: 'running', past: 'runned' });
    expect(regularVerbForms('stop')).toEqual({ thirdPerson: 'stops', gerund: 'stopping', past: 'stopped' });
  });
  it('drops a silent trailing e', () => {
    expect(regularVerbForms('resolve')).toEqual({ thirdPerson: 'resolves', gerund: 'resolving', past: 'resolved' });
  });
  it('keeps the e for ee/oe/ye endings', () => {
    expect(regularVerbForms('agree').gerund).toBe('agreeing');
    expect(regularVerbForms('dye').gerund).toBe('dyeing');
  });
  it('does not double a common stress-elsewhere exception', () => {
    expect(regularVerbForms('open').gerund).toBe('opening');
    expect(regularVerbForms('target').gerund).toBe('targeting');
  });
  it('does not double after w/x/y', () => {
    expect(regularVerbForms('show').gerund).toBe('showing');
    expect(regularVerbForms('play').gerund).toBe('playing');
  });
});

describe('regularAdjectiveForms', () => {
  it('handles a plain short adjective', () => {
    expect(regularAdjectiveForms('quick')).toEqual({ comparative: 'quicker', superlative: 'quickest' });
  });
  it('doubles a short CVC adjective', () => {
    expect(regularAdjectiveForms('big')).toEqual({ comparative: 'bigger', superlative: 'biggest' });
  });
  it('replaces consonant+y with -ier/-iest', () => {
    expect(regularAdjectiveForms('happy')).toEqual({ comparative: 'happier', superlative: 'happiest' });
  });
  it('returns null for a long, multi-syllable adjective', () => {
    expect(regularAdjectiveForms('beautiful')).toBeNull();
    expect(regularAdjectiveForms('wonderful')).toBeNull();
  });
});

describe('generateRegularForms', () => {
  it('returns nothing for a multi-word headword', () => {
    expect(generateRegularForms('round table', 'noun')).toEqual([]);
  });
  it('returns nothing for an adverb', () => {
    expect(generateRegularForms('quickly', 'adv')).toEqual([]);
  });
});

describe('buildFormsForEntry', () => {
  it('merges irregular forms with 3rd-person and gerund, but skips a guessed regular past for an already-irregular verb', () => {
    const forms = buildFormsForEntry('run', 'verb', ['ran', 'running']);
    expect(forms.sort()).toEqual(['ran', 'running', 'runs']);
    expect(forms).not.toContain('runned');
  });

  it('generates full regular forms for a verb with no recorded irregulars', () => {
    const forms = buildFormsForEntry('resolve', 'verb', []);
    expect(forms.sort()).toEqual(['resolved', 'resolves', 'resolving']);
  });

  it('merges an irregular noun plural with nothing extra generated (regular plural still added)', () => {
    const forms = buildFormsForEntry('mouse', 'noun', ['mice']);
    expect(forms.sort()).toEqual(['mice', 'mouses']);
  });

  it('never includes the headword itself', () => {
    const forms = buildFormsForEntry('quick', 'adj', []);
    expect(forms).not.toContain('quick');
  });
});
