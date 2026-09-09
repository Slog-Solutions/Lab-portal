import { ItemType, type ItemDto } from '@lab/shared';

/**
 * Word-list import (Ser 5 "manual entry or import a word list"). Line
 * format, one item per line:
 *   prompt = answer
 *   prompt = answer | choice2 | choice3 | choice4
 * A line with `|`-separated extras after the answer becomes an MCQ item
 * (the answer is folded into the choices list and shuffled at serve
 * time, not at import time — so re-importing the same file is
 * deterministic). Blank lines and lines starting with `#` are skipped.
 *
 * Deliberately a standalone pure function (no upload/HTTP concerns) so it
 * can be unit-tested directly, per zImportWordListDto's own doc comment.
 */
export function parseWordListText(text: string): ItemDto[] {
  const items: ItemDto[] = [];
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) {
      throw new Error(`Line is missing "=" between prompt and answer: "${line}"`);
    }
    const prompt = line.slice(0, eq).trim();
    const rest = line.slice(eq + 1).trim();
    if (!prompt || !rest) {
      throw new Error(`Line has an empty prompt or answer: "${line}"`);
    }

    const parts = rest.split('|').map((p) => p.trim()).filter(Boolean);
    const answer = parts[0]!;
    const extraChoices = parts.slice(1);

    if (extraChoices.length > 0) {
      const choices = Array.from(new Set([answer, ...extraChoices]));
      if (choices.length < 2) {
        throw new Error(`MCQ line needs at least one distinct extra choice: "${line}"`);
      }
      items.push({ type: ItemType.MCQ, prompt, answer, choices: choices.slice(0, 6) });
    } else {
      items.push({ type: ItemType.SHORT_ANSWER, prompt, answer });
    }
  }

  if (items.length === 0) {
    throw new Error('No items found — expected one "prompt = answer" per line');
  }
  return items;
}
