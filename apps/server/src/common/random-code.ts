import { randomInt } from 'node:crypto';

/** Excludes visually-confusable characters (0/O, 1/I) — these codes are read
 * out loud in a classroom and typed back in under time pressure. */
export const UNAMBIGUOUS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** CSPRNG-backed (`crypto.randomInt`), never Math.random — a join key is a
 * guessable shared secret. */
export function randomCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += UNAMBIGUOUS_ALPHABET[randomInt(UNAMBIGUOUS_ALPHABET.length)];
  }
  return code;
}

const NAME_SLUG_MAX = 20;
const NAME_SUFFIX_LENGTH = 4;

/** A batch code derived from a class name plus a short random suffix, e.g.
 * "Morning English 1" -> "MORNING-ENGLISH-1-K7QM". Always satisfies
 * zBatchCode (3-32 chars, starts with a letter/digit, only A-Z 0-9 - here):
 * the slug is capped at 20 chars and the suffix adds 5, so the total stays
 * well under 32. Uniqueness is the caller's job (retry on P2002). */
export function classroomCodeFromName(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_SLUG_MAX)
    .replace(/-+$/, '');
  return `${slug || 'CLASS'}-${randomCode(NAME_SUFFIX_LENGTH)}`;
}
