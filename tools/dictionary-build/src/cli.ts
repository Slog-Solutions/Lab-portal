import { gunzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWnLmf } from './oewn/parse-lmf.js';
import { rankEntries } from './rank.js';
import { writeDictionaryDb } from './write-db.js';
import { writeManifest } from './manifest.js';
import { runQualityGate } from './quality-gate.js';
import { verifyInputs } from './verify-inputs.js';

/** The CLI's own `--sources` only ever accepts the two build-mode values
 * spec §2.2 defines; `cmudict` (verify-inputs.ts's broader SourceKey) is
 * an IPA-fallback INPUT some future `oewn,wiktionary` pass might record,
 * not a `--sources` value of its own. */
type CliSource = 'oewn' | 'wiktionary';

/**
 * Orchestrates the whole pipeline (spec §4.2): verify inputs -> parse ->
 * rank/clean/inflect -> write SQLite -> write manifest -> quality gate.
 * Runs once, on a connected build machine, never on the lab network.
 *
 * Usage:
 *   npm run build --workspace=tools/dictionary-build -- \
 *     --sources=oewn --inputs=./inputs --out=./dist/dictionary.db
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface CliArgs {
  sources: CliSource[];
  licenceMode: 'oewn' | 'oewn,wiktionary';
  inputsDir: string;
  outPath: string;
  manifestPath: string;
  buildDate?: string;
  minHeadwords: number;
}

function parseArgs(argv: string[]): CliArgs {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) flags.set(match[1]!, match[2]!);
  }

  const sourcesRaw = flags.get('sources') ?? 'oewn';
  const sources = sourcesRaw.split(',').map((s) => s.trim());
  for (const s of sources) {
    if (s !== 'oewn' && s !== 'wiktionary') {
      throw new Error(`Unknown --sources value "${s}" — expected "oewn" or "oewn,wiktionary" (spec §2.2)`);
    }
  }
  const cliSources = sources as CliSource[];
  const licenceMode = cliSources.includes('wiktionary') ? 'oewn,wiktionary' : 'oewn';

  const outPath = path.resolve(HERE, '..', flags.get('out') ?? 'dist/dictionary.db');
  return {
    sources: cliSources,
    licenceMode,
    inputsDir: path.resolve(HERE, '..', flags.get('inputs') ?? 'inputs'),
    outPath,
    manifestPath: flags.get('manifest') ?? `${outPath.replace(/\.db$/, '')}.manifest.json`,
    buildDate: flags.get('build-date'),
    minHeadwords: flags.has('min-headwords') ? Number(flags.get('min-headwords')) : 50_000,
  };
}

function readSpotCheckWords(): string[] {
  const filePath = path.resolve(HERE, '..', 'spot-check.txt');
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function readOewnXml(inputsDir: string, fileName: string): string {
  const filePath = path.join(inputsDir, fileName);
  const buffer = readFileSync(filePath);
  return fileName.endsWith('.gz') ? gunzipSync(buffer).toString('utf-8') : buffer.toString('utf-8');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // eslint-disable-next-line no-console
  console.log(`[dictionary-build] sources=${args.sources.join(',')} licenceMode=${args.licenceMode}`);

  if (args.sources.includes('wiktionary')) {
    // Phase 0 decision (2026-09-28): v1 ships OEWN-only. The --sources
    // flag and the CC BY-SA licence-mode plumbing are real (write-db.ts,
    // quality-gate.ts, meta.licence_mode) so turning this on later is a
    // parser addition, not a schema change — but the actual kaikki.org
    // Wiktionary join (spec §4.2 step 4) isn't implemented yet.
    throw new Error(
      '--sources=oewn,wiktionary is not implemented in v1 (Phase 0 decision: OEWN-only). Use --sources=oewn, or implement the Wiktionary merge in a follow-up pass first.',
    );
  }

  const sourcesManifestPath = path.resolve(HERE, '..', 'dictionary-sources.json');
  const manifest = verifyInputs(sourcesManifestPath, args.inputsDir, ['oewn']);
  const oewnEntry = manifest.oewn!;

  // eslint-disable-next-line no-console
  console.log(`[dictionary-build] parsing ${oewnEntry.file} (OEWN ${oewnEntry.version}) ...`);
  const xml = readOewnXml(args.inputsDir, oewnEntry.file);
  const parsed = parseWnLmf(xml);
  // eslint-disable-next-line no-console
  console.log(
    `[dictionary-build] parsed ${parsed.entries.length} lexical entries (${parsed.stats.synsetCount} synsets, ${parsed.stats.skippedPosCount} skipped for unrecognized POS)`,
  );

  const ranked = rankEntries(parsed.entries);
  // eslint-disable-next-line no-console
  console.log(
    `[dictionary-build] ranked ${ranked.entries.length} headword+POS entries ` +
      `(dropped ${ranked.stats.droppedArchaicOrRare} archaic/rare senses, ${ranked.stats.cappedBeyondFiveSenses} capped beyond 5)`,
  );

  const builtAt = args.buildDate ?? oewnEntry.downloadedAt;
  writeDictionaryDb(ranked.entries, {
    outPath: args.outPath,
    sources: args.sources,
    licenceMode: args.licenceMode,
    oewnVersion: oewnEntry.version,
    builtAt,
  });
  // eslint-disable-next-line no-console
  console.log(`[dictionary-build] wrote ${args.outPath}`);

  const manifestResult = writeManifest({
    dbPath: args.outPath,
    manifestPath: args.manifestPath,
    sources: args.sources,
    licenceMode: args.licenceMode,
    oewnVersion: oewnEntry.version,
    builtAt,
  });
  // eslint-disable-next-line no-console
  console.log(
    `[dictionary-build] manifest: ${manifestResult.headwordCount} headwords, ${manifestResult.senseCount} senses, ` +
      `${(manifestResult.fileSizeBytes / 1024 / 1024).toFixed(1)} MB, contentSha256=${manifestResult.contentSha256.slice(0, 12)}...`,
  );

  const gate = runQualityGate({
    dbPath: args.outPath,
    minHeadwords: args.minHeadwords,
    enforceIpaCoverage: args.licenceMode === 'oewn,wiktionary',
    spotCheckWords: readSpotCheckWords(),
  });
  // eslint-disable-next-line no-console
  console.log(`[dictionary-build] quality gate: ${gate.passed ? 'PASS' : 'FAIL'} (IPA coverage of top 10k: ${gate.ipaCoveragePctTop10k.toFixed(1)}%)`);
  if (!gate.passed) {
    for (const failure of gate.failures) {
      // eslint-disable-next-line no-console
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
