/**
 * Text sanitation (spec §4.2 step 6 — "Strip wiki markup, HTML, templates
 * and reference markers. No raw wikitext may reach the UI.") and length
 * capping (spec §4.4 quality gate — every definition under 400 chars).
 *
 * Matters even in OEWN-only mode: Princeton WordNet/OEWN glosses are
 * already plain text, but this is the one choke point every sense's
 * definition/example passes through before write-db.ts, so turning on
 * `--sources=oewn,wiktionary` later (which DOES carry real wikitext) adds
 * no new cleaning surface to get right under deadline.
 */

// Definitions must be strictly UNDER 400 chars (spec §4.4); the gate
// (quality-gate.ts) checks against this same constant so the two can
// never drift apart.
export const MAX_DEFINITION_LENGTH = 399;
export const MAX_EXAMPLE_LENGTH = 300;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** Strips {{templates}}, [[wiki links]] (kept as their display text),
 * <ref>...</ref> markers and any other HTML tag, decoding entities along
 * the way. Order matters: entities are decoded FIRST so a
 * double-encoded `&amp;lt;ref&amp;gt;` reveals itself as real markup
 * before the tag-stripping passes run, then decoded again afterwards as a
 * belt-and-braces pass, then any literal brace/bracket pair that survived
 * unbalanced/deeply-nested templates is stripped directly — the quality
 * gate's "zero `{{`, `[[`, `<ref`, `&lt;`" bar is a hard build failure,
 * not a best-effort one.
 */
export function stripWikiMarkup(raw: string): string {
  let t = decodeHtmlEntities(raw);

  for (let i = 0; i < 5 && t.includes('{{'); i++) {
    t = t.replace(/\{\{[^{}]*\}\}/g, '');
  }
  t = t.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
  t = t.replace(/\[\[([^\]]*)\]\]/g, '$1');
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  t = t.replace(/<ref[^>]*\/?>/gi, '');
  t = t.replace(/<[^>]+>/g, '');

  t = decodeHtmlEntities(t);
  t = t.replace(/\{\{|\}\}/g, '').replace(/\[\[|\]\]/g, '');

  return t.replace(/\s+/g, ' ').trim();
}

/** Cuts at the last sentence boundary under `maxLen` when there is one
 * comfortably into the text; otherwise a hard cut at the last word
 * boundary with a trailing ellipsis. Always returns a string strictly
 * shorter than `maxLen + 1`. */
export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const window = text.slice(0, maxLen);
  const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (sentenceEnd > maxLen * 0.5) {
    return window.slice(0, sentenceEnd + 1).trim();
  }
  const cut = window.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${base.trim()}…`;
}

export function cleanDefinition(raw: string): string {
  return truncateText(stripWikiMarkup(raw), MAX_DEFINITION_LENGTH);
}

export function cleanExample(raw: string): string {
  return truncateText(stripWikiMarkup(raw), MAX_EXAMPLE_LENGTH);
}
