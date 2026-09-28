import { describe, expect, it } from 'vitest';
import { MAX_DEFINITION_LENGTH, cleanDefinition, cleanExample, stripWikiMarkup, truncateText } from './clean.js';

describe('stripWikiMarkup', () => {
  it('removes {{templates}}', () => {
    expect(stripWikiMarkup('a {{template|arg}} definition')).toBe('a definition');
  });

  it('replaces [[wiki links]] with their display text', () => {
    expect(stripWikiMarkup('see [[cat|cats]] for more')).toBe('see cats for more');
    expect(stripWikiMarkup('see [[cat]] for more')).toBe('see cat for more');
  });

  it('removes <ref>...</ref> blocks and self-closing refs', () => {
    expect(stripWikiMarkup('a fact<ref>a citation</ref> here')).toBe('a fact here');
    expect(stripWikiMarkup('a fact<ref name="x"/> here')).toBe('a fact here');
  });

  it('removes arbitrary HTML tags', () => {
    expect(stripWikiMarkup('some <b>bold</b> text')).toBe('some bold text');
  });

  it('decodes HTML entities — a decoded ampersand is legitimate text and stays', () => {
    expect(stripWikiMarkup('a &lt;tag&gt; and &amp; sign')).toBe('a and & sign');
    expect(stripWikiMarkup('&amp;lt;ref&amp;gt;x&amp;lt;/ref&amp;gt; tail')).toBe('tail');
  });

  it('leaves plain text completely alone', () => {
    expect(stripWikiMarkup('move fast by using one\'s feet')).toBe("move fast by using one's feet");
  });

  it('never leaves a gate-forbidden marker behind', () => {
    const dirty = '{{t}}a [[link|text]] with <ref>cite</ref> and &lt;weird&gt; <b>markup</b>';
    const clean = stripWikiMarkup(dirty);
    for (const marker of ['{{', '[[', '<ref', '&lt;']) {
      expect(clean).not.toContain(marker);
    }
  });

  it('collapses whitespace left behind by stripping', () => {
    expect(stripWikiMarkup('a   {{x}}   b')).toBe('a b');
  });
});

describe('truncateText', () => {
  it('returns short text unchanged', () => {
    expect(truncateText('short', 400)).toBe('short');
  });

  it('cuts at a sentence boundary when one falls comfortably inside the limit', () => {
    const text = `${'a'.repeat(60)}. ${'b'.repeat(400)}`;
    const result = truncateText(text, 100);
    expect(result.length).toBeLessThan(100);
    expect(result.endsWith('.')).toBe(true);
  });

  it('falls back to a word-boundary ellipsis cut with no usable sentence break', () => {
    const text = 'word '.repeat(200);
    const result = truncateText(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('cleanDefinition / cleanExample', () => {
  it('produces a definition strictly under 400 characters', () => {
    const long = `${'x '.repeat(300)}<ref>cite</ref>`;
    const result = cleanDefinition(long);
    expect(result.length).toBeLessThan(400);
    expect(result).not.toContain('<ref');
  });

  it('caps a definition at MAX_DEFINITION_LENGTH', () => {
    expect(MAX_DEFINITION_LENGTH).toBeLessThan(400);
  });

  it('cleans an example the same way', () => {
    expect(cleanExample('She {{x}}ran to the store.')).toBe('She ran to the store.');
  });
});
