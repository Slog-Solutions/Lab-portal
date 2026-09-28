import { describe, expect, it } from 'vitest';
import { zBatchCode } from '@lab/shared';
import { UNAMBIGUOUS_ALPHABET, classroomCodeFromName, randomCode } from './random-code';

describe('randomCode', () => {
  it('returns the requested length using only the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = randomCode(8);
      expect(code).toHaveLength(8);
      for (const ch of code) expect(UNAMBIGUOUS_ALPHABET).toContain(ch);
    }
  });

  it('never emits the confusable glyphs 0, O, 1 or I', () => {
    expect(UNAMBIGUOUS_ALPHABET).not.toMatch(/[01OI]/);
  });

  it('is not constant (a fixed value would make a join key guessable)', () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomCode(8)));
    expect(seen.size).toBeGreaterThan(45);
  });
});

describe('classroomCodeFromName', () => {
  it('derives an uppercase slug plus a 4-char suffix', () => {
    expect(classroomCodeFromName('Morning English 1')).toMatch(/^MORNING-ENGLISH-1-[A-Z2-9]{4}$/);
  });

  it('always satisfies zBatchCode, including awkward names', () => {
    const names = ['x', '  ', '!!!', 'Área ñandú', 'a'.repeat(200), '---weird---', 'Class (Batch #2) / evening', '日本語のクラス'];
    for (const name of names) {
      const code = classroomCodeFromName(name);
      expect(zBatchCode.safeParse(code).success, `${JSON.stringify(name)} -> ${code}`).toBe(true);
    }
  });

  it('falls back to CLASS when the name has no usable characters', () => {
    expect(classroomCodeFromName('!!!')).toMatch(/^CLASS-[A-Z2-9]{4}$/);
  });

  it('does not leave a trailing hyphen where the slug was truncated', () => {
    const code = classroomCodeFromName('aaaaaaaaaaaaaaaaaaa bbbbbb');
    expect(code).not.toMatch(/--/);
  });
});
