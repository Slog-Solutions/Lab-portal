import { describe, expect, it } from 'vitest';
import { ItemType } from '@lab/shared';
import { parseWordListText } from './word-list-parser';

describe('parseWordListText', () => {
  it('parses a plain "prompt = answer" line as SHORT_ANSWER', () => {
    const items = parseWordListText('cat = gato');
    expect(items).toEqual([{ type: ItemType.SHORT_ANSWER, prompt: 'cat', answer: 'gato' }]);
  });

  it('parses "prompt = answer | choice | choice" as MCQ, answer folded into choices', () => {
    const items = parseWordListText('cat = gato | perro | pajaro');
    expect(items).toEqual([
      { type: ItemType.MCQ, prompt: 'cat', answer: 'gato', choices: ['gato', 'perro', 'pajaro'] },
    ]);
  });

  it('dedupes a choice that repeats the answer', () => {
    const items = parseWordListText('cat = gato | gato | perro');
    expect(items[0]!.choices).toEqual(['gato', 'perro']);
  });

  it('skips blank lines and comment lines', () => {
    const items = parseWordListText('cat = gato\n\n# a comment\ndog = perro');
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.prompt)).toEqual(['cat', 'dog']);
  });

  it('trims whitespace around prompt/answer', () => {
    const items = parseWordListText('  cat   =   gato  ');
    expect(items[0]).toMatchObject({ prompt: 'cat', answer: 'gato' });
  });

  it('handles CRLF line endings the same as LF', () => {
    const items = parseWordListText('cat = gato\r\ndog = perro\r\n');
    expect(items).toHaveLength(2);
  });

  it('caps MCQ choices at 6 (the item bank column limit)', () => {
    const items = parseWordListText('q = a | b | c | d | e | f | g | h');
    expect(items[0]!.choices).toHaveLength(6);
  });

  it('throws on a line with no "="', () => {
    expect(() => parseWordListText('this line has no equals sign')).toThrow(/missing "="/);
  });

  it('throws on an empty prompt', () => {
    expect(() => parseWordListText(' = gato')).toThrow(/empty prompt or answer/);
  });

  it('throws on an empty answer', () => {
    expect(() => parseWordListText('cat = ')).toThrow(/empty prompt or answer/);
  });

  it('throws when every line is blank/comment (no real items)', () => {
    expect(() => parseWordListText('# just a comment\n\n')).toThrow(/No items found/);
  });

  it('throws on an MCQ line whose only extra choice duplicates the answer', () => {
    expect(() => parseWordListText('cat = gato | gato')).toThrow(/needs at least one distinct extra choice/);
  });
});
