import { DatabaseSync } from 'node:sqlite';

/**
 * Spec §4.4 — the build fails unless every one of these holds. Run against
 * the FINISHED `dictionary.db` file (not the in-memory pipeline state), so
 * it catches a write-db.ts bug too, not just an upstream data problem.
 */

export interface QualityGateOptions {
  dbPath: string;
  /** Default 50,000 (spec). Tests pass a small number against a fixture
   * DB so the gate's own PASS/FAIL logic is verified without needing the
   * real multi-hundred-MB OEWN release. */
  minHeadwords?: number;
  /** Spec: "when Wiktionary is enabled" — false (default) reports IPA
   * coverage without failing the build on it, since OEWN-only mode has no
   * IPA source of its own to speak of. */
  enforceIpaCoverage?: boolean;
  minIpaCoveragePct?: number;
  spotCheckWords?: string[];
}

export interface QualityGateReport {
  passed: boolean;
  failures: string[];
  headwordCount: number;
  senseCount: number;
  ipaCoveragePctTop10k: number;
  spotCheckFailures: string[];
}

const MARKUP_MARKERS = ['{{', '[[', '<ref', '&lt;'];

export function runQualityGate(options: QualityGateOptions): QualityGateReport {
  const { dbPath, minHeadwords = 50_000, enforceIpaCoverage = false, minIpaCoveragePct = 60, spotCheckWords = [] } = options;
  const failures: string[] = [];

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const headwordCount = (db.prepare('SELECT COUNT(DISTINCT headword_lc) AS n FROM entry').get() as { n: number }).n;
    if (headwordCount < minHeadwords) {
      failures.push(`Only ${headwordCount} distinct headwords, need >= ${minHeadwords}`);
    }

    const senses = db.prepare('SELECT definition, example FROM sense').all() as Array<{ definition: string; example: string | null }>;
    let emptyOrOverLong = 0;
    let markupFound = 0;
    for (const s of senses) {
      if (!s.definition || s.definition.trim().length === 0 || s.definition.length >= 400) emptyOrOverLong++;
      const combined = `${s.definition} ${s.example ?? ''}`;
      if (MARKUP_MARKERS.some((marker) => combined.includes(marker))) markupFound++;
    }
    if (emptyOrOverLong > 0) {
      failures.push(`${emptyOrOverLong} sense(s) have an empty or >=400-char definition`);
    }
    if (markupFound > 0) {
      failures.push(`${markupFound} sense(s) still contain raw markup ({{, [[, <ref, or &lt;)`);
    }

    const top10k = db
      .prepare(
        `SELECT headword_lc, MAX(CASE WHEN ipa IS NOT NULL AND ipa != '' THEN 1 ELSE 0 END) AS hasIpa
         FROM entry WHERE freq_rank <= 10000 GROUP BY headword_lc`,
      )
      .all() as Array<{ headword_lc: string; hasIpa: number }>;
    const ipaCoveragePctTop10k = top10k.length > 0 ? (top10k.filter((r) => r.hasIpa === 1).length / top10k.length) * 100 : 0;
    if (enforceIpaCoverage && ipaCoveragePctTop10k < minIpaCoveragePct) {
      failures.push(`IPA coverage of top 10k headwords is ${ipaCoveragePctTop10k.toFixed(1)}%, need >= ${minIpaCoveragePct}%`);
    }

    const spotCheckFailures: string[] = [];
    if (spotCheckWords.length > 0) {
      const byHeadword = db.prepare('SELECT 1 FROM entry WHERE headword_lc = ? LIMIT 1');
      const byForm = db.prepare('SELECT 1 FROM form WHERE form_lc = ? LIMIT 1');
      for (const word of spotCheckWords) {
        const lc = word.trim().toLowerCase();
        if (!lc) continue;
        const resolved = byHeadword.get(lc) ?? byForm.get(lc);
        if (!resolved) spotCheckFailures.push(word);
      }
      if (spotCheckFailures.length > 0) {
        failures.push(`${spotCheckFailures.length} spot-check word(s) did not resolve: ${spotCheckFailures.join(', ')}`);
      }
    }

    return {
      passed: failures.length === 0,
      failures,
      headwordCount,
      senseCount: senses.length,
      ipaCoveragePctTop10k,
      spotCheckFailures,
    };
  } finally {
    db.close();
  }
}
