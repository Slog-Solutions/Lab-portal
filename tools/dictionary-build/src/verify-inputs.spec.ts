import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyInputs } from './verify-inputs.js';

let dir: string;
let inputsDir: string;
let sourcesManifestPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dict-inputs-'));
  inputsDir = path.join(dir, 'inputs');
  sourcesManifestPath = path.join(dir, 'dictionary-sources.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seedInputFile(name: string, content: string): string {
  mkdirSync(inputsDir, { recursive: true });
  const filePath = path.join(inputsDir, name);
  writeFileSync(filePath, content);
  return createHash('sha256').update(content).digest('hex');
}

describe('verifyInputs', () => {
  it('throws when dictionary-sources.json does not exist', () => {
    expect(() => verifyInputs(sourcesManifestPath, inputsDir, ['oewn'])).toThrow(/dictionary-sources\.json/);
  });

  it('throws when a required source has no recorded entry', () => {
    writeFileSync(sourcesManifestPath, JSON.stringify({}));
    expect(() => verifyInputs(sourcesManifestPath, inputsDir, ['oewn'])).toThrow(/no recorded input for "oewn"/);
  });

  it('throws when the recorded file is missing on disk', () => {
    writeFileSync(
      sourcesManifestPath,
      JSON.stringify({ oewn: { file: 'missing.xml', url: 'https://example.test/x', version: '1', downloadedAt: 'x', sha256: 'deadbeef' } }),
    );
    expect(() => verifyInputs(sourcesManifestPath, inputsDir, ['oewn'])).toThrow(/Input file missing/);
  });

  it('throws when the file no longer matches its recorded SHA-256', () => {
    seedInputFile('oewn.xml', 'original content');
    writeFileSync(
      sourcesManifestPath,
      JSON.stringify({ oewn: { file: 'oewn.xml', url: 'https://example.test/x', version: '1', downloadedAt: 'x', sha256: 'wronghash' } }),
    );
    expect(() => verifyInputs(sourcesManifestPath, inputsDir, ['oewn'])).toThrow(/SHA-256 mismatch/);
  });

  it('passes when the file matches its recorded SHA-256', () => {
    const sha256 = seedInputFile('oewn.xml', 'original content');
    writeFileSync(
      sourcesManifestPath,
      JSON.stringify({ oewn: { file: 'oewn.xml', url: 'https://example.test/x', version: '1', downloadedAt: 'x', sha256 } }),
    );
    const manifest = verifyInputs(sourcesManifestPath, inputsDir, ['oewn']);
    expect(manifest.oewn?.file).toBe('oewn.xml');
  });
});
