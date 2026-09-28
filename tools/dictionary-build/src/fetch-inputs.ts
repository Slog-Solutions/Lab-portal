import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceInput, SourceKey, SourcesManifest } from './verify-inputs.js';

/**
 * Downloads the Open English WordNet release into inputs/ and records its
 * version, URL, download date and SHA-256 into the COMMITTED
 * dictionary-sources.json (spec §4.1 "reproducible and auditable").
 *
 * Run on a CONNECTED machine, never on the lab network — the same posture
 * as infra/offline/fetch-vendor.ps1's own doc comment. Deliberately NOT
 * executed as part of writing this pipeline, for the same reason that
 * script gives: this downloads a real, non-trivial third-party file,
 * which is exactly the kind of unprompted, heavy, outward-facing action
 * this project holds off on doing without being asked.
 *
 * VERIFIED against the real GitHub Releases API on 2026-09-28: tag
 * `2025-edition` ("Open English Wordnet 2025"), asset
 * `english-wordnet-2025.xml.gz` (~11 MB). Re-check
 * https://github.com/globalwordnet/english-wordnet/releases if this is
 * ever stale — release tags and asset filenames do change over time.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUTS_DIR = path.resolve(HERE, '../inputs');
const SOURCES_MANIFEST_PATH = path.resolve(HERE, '../dictionary-sources.json');

const OEWN_VERSION = '2025-edition';
const OEWN_URL = 'https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.xml.gz';

async function fetchOewn(): Promise<void> {
  mkdirSync(INPUTS_DIR, { recursive: true });
  const fileName = path.basename(new URL(OEWN_URL).pathname);
  const filePath = path.join(INPUTS_DIR, fileName);

  // eslint-disable-next-line no-console
  console.log(`Downloading ${OEWN_URL} ...`);
  const res = await fetch(OEWN_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(filePath, buffer);

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const manifest: SourcesManifest = existsSync(SOURCES_MANIFEST_PATH)
    ? (JSON.parse(readFileSync(SOURCES_MANIFEST_PATH, 'utf-8')) as SourcesManifest)
    : {};
  const entry: SourceInput = { file: fileName, url: OEWN_URL, version: OEWN_VERSION, downloadedAt: new Date().toISOString(), sha256 };
  manifest.oewn = entry;
  writeFileSync(SOURCES_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log(`Saved ${filePath} (${buffer.length} bytes, sha256=${sha256})`);
  // eslint-disable-next-line no-console
  console.log('Recorded in dictionary-sources.json — commit that file alongside the release.');
}

async function main(): Promise<void> {
  const which = (process.argv[2] ?? 'oewn') as SourceKey;
  if (which !== 'oewn') {
    throw new Error(
      `Only "oewn" fetching is implemented (Phase 0 decision: v1 ships OEWN-only, spec §2.2). Fetching "${which}" is future work alongside adding it to the pipeline itself (cli.ts).`,
    );
  }
  await fetchOewn();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
