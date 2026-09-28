import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** One row of the committed dictionary-sources.json (spec §4.1 — exact
 * version, download date and SHA-256 of every input, so a build is
 * auditable: "where did this data come from" has a written answer). */
export interface SourceInput {
  file: string;
  url: string;
  version: string;
  downloadedAt: string;
  sha256: string;
}

export type SourceKey = 'oewn' | 'wiktionary' | 'cmudict';
export type SourcesManifest = Partial<Record<SourceKey, SourceInput>>;

export function readSourcesManifest(sourcesManifestPath: string): SourcesManifest {
  if (!existsSync(sourcesManifestPath)) {
    throw new Error(`No dictionary-sources.json at ${sourcesManifestPath} — run "npm run fetch" on a connected machine first.`);
  }
  return JSON.parse(readFileSync(sourcesManifestPath, 'utf-8')) as SourcesManifest;
}

/** Refuses to build if a required input is unrecorded, missing on disk, or
 * its SHA-256 no longer matches what fetch-inputs.ts recorded — a build
 * must never silently run against a file that isn't the one it thinks it
 * is (spec §4.1). Throws with the first mismatch found. */
export function verifyInputs(sourcesManifestPath: string, inputsDir: string, required: SourceKey[]): SourcesManifest {
  const manifest = readSourcesManifest(sourcesManifestPath);
  for (const key of required) {
    const entry = manifest[key];
    if (!entry) {
      throw new Error(`dictionary-sources.json has no recorded input for "${key}" — run "npm run fetch" first.`);
    }
    const filePath = path.join(inputsDir, entry.file);
    if (!existsSync(filePath)) {
      throw new Error(`Input file missing: ${filePath} (recorded in dictionary-sources.json for "${key}")`);
    }
    const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex');
    if (actual !== entry.sha256) {
      throw new Error(
        `SHA-256 mismatch for "${key}" (${filePath}): expected ${entry.sha256}, got ${actual}. The file has changed since fetch-inputs.ts recorded it — re-fetch rather than build against it.`,
      );
    }
  }
  return manifest;
}
