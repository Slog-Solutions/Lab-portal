# Third-Party Notices

This installer includes data and software from the following third-party,
open-licensed sources. Attribution obligations here are mandatory, not
optional (SPEC-offline-dictionary.md §9).

---

## Open English WordNet

The offline dictionary feature's data (`dictionary.db`) is built from the
**Open English WordNet** (https://github.com/globalwordnet/english-wordnet),
which is itself derived from the **Princeton WordNet**
(https://wordnet.princeton.edu/).

- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0)
  — https://creativecommons.org/licenses/by/4.0/
- **Attribution (required wording):** "This work is based on WordNet,
  Princeton University, and on the Open English WordNet,
  https://github.com/globalwordnet/english-wordnet, licensed under CC BY
  4.0."

The exact source version, build date and full licence text this
deployment's `dictionary.db` was built from are shown live in-app, in the
dictionary panel's footer and the "About & licences" dialog reached from
it — read from that file's own `meta` table
(`tools/dictionary-build/src/write-db.ts`), so this document and the
running app can never silently drift apart.

**If this deployment's licence mode is `oewn,wiktionary`** (see
`docs/decisions/dictionary-licence.md` — not the default), the dictionary
database also includes data derived from **English Wiktionary** (via
kaikki.org), licensed under **CC BY-SA 4.0**. In that case, the
`dictionary.db` FILE ITSELF (not this application's own code) is licensed
under CC BY-SA 4.0, and any adapted version of that file must be released
under the same licence. Check the in-app About dialog's "Licence mode"
field to see which mode this deployment was built with.

---

## Charis SIL (planned)

The dictionary panel's IPA pronunciation text is intended to use a bundled
font with full IPA glyph coverage (Charis SIL, SIL Open Font License 1.1
— https://software.sil.org/charis/), per SPEC-offline-dictionary.md §6.3.

**Status: not yet vendored.** No font binary or `OFL.txt` licence file has
been added to this repository — the panel currently falls back to system
fonts (`Segoe UI`, `Noto Sans`) via `apps/web/src/styles/index.css`'s
`.font-ipa` rule. Verify IPA glyph coverage (`ɪ ʃ ð ŋ ɜː`) on the actual
deployed Windows 11 image before relying on this for a real rollout; if
coverage is incomplete, vendor Charis SIL's `.woff2` and its `OFL.txt`
into `apps/web/src/assets/fonts/`, wire an `@font-face` rule, and update
this section with its exact version and licence text.

---

*This file is maintained alongside `tools/dictionary-build/` and
`docs/decisions/dictionary-licence.md`. Update it whenever a new
open-data or open-font dependency is added to the dictionary feature.*
