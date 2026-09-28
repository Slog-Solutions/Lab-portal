# Decision: offline dictionary licence mode

**Date:** 2026-09-28
**Decided by:** project owner (Suraj), via direct instruction while executing `SPEC-offline-dictionary.md`.
**Status:** final for v1.

## The question (spec §2.2)

`SPEC-offline-dictionary.md` §2.2 requires a conscious, recorded choice
between two build modes before any code ships:

- `--sources=oewn` — Open English WordNet only. **CC BY 4.0**, attribution
  only, no share-alike obligation on the delivered `dictionary.db`.
- `--sources=oewn,wiktionary` — adds kaikki.org's English Wiktionary
  extract for IPA pronunciation and richer examples. The resulting
  `dictionary.db` becomes **CC BY-SA 4.0** (share-alike): any adapted
  version of that database file must itself be released under CC BY-SA
  4.0. This does not affect the application code, only the data file.

## Decision

**v1 ships `--sources=oewn` only.**

Reasoning:
- This is a defence-sector deployment (ACTC, Annexure-I). "No share-alike
  obligation on any delivered artefact" is the safer default the spec
  itself recommends (§2.2: "Make this flag a first-class option, and
  default to `oewn` — the safer choice").
- IPA pronunciation is a nice-to-have for a language lab, not a hard
  requirement; v1 accepts that most headwords will have no IPA rather than
  take on a share-alike data licence to get one.
- The pipeline still supports `--sources=oewn,wiktionary` as a flag and
  the schema's `sense.source`/`meta.licence_mode` columns exist and are
  populated either way — turning Wiktionary on later is a parser addition
  (`tools/dictionary-build`), not a schema migration or a server change.

## What would change if this is revisited

- `tools/dictionary-build/src/cli.ts`'s `--sources=oewn,wiktionary` path
  needs the actual kaikki.org JSONL parser and merge-by-headword+POS logic
  implemented (currently a clear "not implemented in v1" error).
- The delivered `dictionary.db` becomes CC BY-SA 4.0. The About screen,
  panel footer, and `THIRD-PARTY-NOTICES.md` must say so and note that
  adaptations of the database file must use the same licence (spec §9.4).
- No change is needed to `DictionaryModule`, the student panel, or the
  teacher controls — none of them are licence-mode-aware beyond displaying
  `meta.licenceMode`.

## Compliance tracking

See [docs/compliance-matrix.md](../compliance-matrix.md) for the running
build status of this feature.
