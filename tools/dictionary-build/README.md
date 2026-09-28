# @lab/dictionary-build

Build-time pipeline: open-data dictionary sources → `dictionary.db`, the
read-only SQLite file `DictionaryModule` serves from the central server
(see `SPEC-offline-dictionary.md`). Runs **once, on a connected build
machine, never on the lab network** — the same posture as
`infra/offline/fetch-vendor.ps1`.

## Phase 0 decision (recorded 2026-09-28)

v1 ships **OEWN-only** (`--sources=oewn`, CC BY 4.0, no share-alike). See
`docs/decisions/dictionary-licence.md`. `--sources=oewn,wiktionary` is
plumbed through the schema/CLI but not implemented — running it fails
fast with a clear message rather than silently building an OEWN-only
database under the wrong licence label.

## One-time setup, on a machine WITH internet

```
npm run fetch --workspace=tools/dictionary-build
```

Downloads the current Open English WordNet release into `inputs/`
(gitignored — large binaries don't belong in git) and records its exact
version, URL, download date and SHA-256 in the **committed**
`dictionary-sources.json`. **Verify the release URL/version in
`src/fetch-inputs.ts` first** — it is not guaranteed current; see that
file's own doc comment.

## Build (repeatable, verifies inputs against the recorded checksums)

```
npm run build --workspace=tools/dictionary-build
```

Writes `dist/dictionary.db` and `dist/dictionary.manifest.json`, then runs
the spec §4.4 quality gate. A non-zero exit means the gate failed — read
the printed failures; **it is not safe to ship a `dictionary.db` that
didn't pass the gate.**

Copy the resulting `dictionary.db` to the server at
`${LAB_DATA_ROOT}/dictionary/dictionary.db` (or set `DICTIONARY_DB_PATH`).

## Tests

```
npm test --workspace=tools/dictionary-build
```

Runs entirely against `fixtures/mini-oewn.xml` (a small, hand-written
WN-LMF document) — no internet or real OEWN download needed. **This does
not substitute for running the real build against the real release before
shipping**: the fixture cannot exercise the 50,000-headword threshold or
reveal an attribute-name mismatch against the actual OEWN XML shape (see
`src/oewn/parse-lmf.ts`'s "VERIFY-BEFORE-SHIP" note).

## Layout

| File | Role |
|---|---|
| `src/fetch-inputs.ts` | Connected-machine-only download + checksum step |
| `src/verify-inputs.ts` | Refuses to build against an unrecorded/changed input |
| `src/oewn/parse-lmf.ts` | WN-LMF XML → intermediate `ParsedEntry[]` |
| `src/rank.ts` | Merge, drop archaic/rare, cap at 5 senses, assign `freq_rank` |
| `src/inflect.ts` | Regular English inflection generation (irregulars come from the source itself) |
| `src/clean.ts` | Strip markup/HTML, cap definition length |
| `src/write-db.ts` | Writes the SQLite file (schema shared with the server via `@lab/shared`) |
| `src/manifest.ts` | Counts + checksums for the reproducible-build acceptance test (A12) |
| `src/quality-gate.ts` | Spec §4.4 pass/fail checks |
| `src/cli.ts` | Orchestrates the above end to end |
