import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderPackHtml } from './builtin-content.service';

const PACKS = path.resolve(__dirname, '../../../content-packs');

describe('ready-made content packs (Ser 4)', () => {
  const slugs = readdirSync(PACKS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name);

  it('ships grade-wise and level-wise HTML content', () => {
    expect(slugs.length).toBeGreaterThanOrEqual(4);
    const packs = slugs.map((s) => JSON.parse(readFileSync(path.join(PACKS, s, 'pack.json'), 'utf8')));
    expect(new Set(packs.map((p) => p.gradeLevel)).size).toBe(packs.length);
    expect(new Set(packs.map((p) => p.cefrLevel)).size).toBeGreaterThanOrEqual(4);
    for (const p of packs) {
      for (const q of p.questions) {
        if (q.type === 'choice') expect(q.choices, `${p.title} ${q.id}`).toContain(q.answer);
      }
    }
  });

  it('renders a page with no inline script (the file route CSP forbids none, but the app-wide one does) and escapes text', () => {
    const html = renderPackHtml(
      {
        title: 'A <b>test</b>',
        gradeLevel: 'Grade 5',
        cefrLevel: 'A1',
        description: '',
        image: { file: 'picture.svg', caption: 'x' },
        sections: [{ paragraphs: ['1 < 2 & "quotes"'] }],
        glossary: [],
        questions: [],
      },
      true,
    );
    expect(html).not.toMatch(/<script>(?!<\/script>)/);
    expect(html).toContain('<script src="exercise-data.js"></script>');
    expect(html).toContain('A &lt;b&gt;test&lt;/b&gt;');
    expect(html).toContain('1 &lt; 2 &amp; &quot;quotes&quot;');
    expect(html).toContain('narration.wav');
  });
});
