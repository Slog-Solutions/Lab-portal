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

## Noto Sans

The application's interface typeface. **Vendored, not loaded from a CDN** —
this deployment is air-gapped, so no Google Fonts or other network request
is made at runtime.

- **Licence:** SIL Open Font License 1.1
  — https://openfontlicense.org/
- **Source:** https://fonts.google.com/noto/specimen/Noto+Sans (Google
  Fonts, version v42), https://github.com/notofonts/latin-greek-cyrillic
- **Files:** four variable `.woff2` subsets (`wght 100–900`) in
  `apps/web/src/assets/fonts/` — roman and italic × `latin` and
  `latin-ext` — declared with matching `unicode-range` in
  `apps/web/src/styles/index.css`.

The OFL requires the licence text to accompany the font binaries. Add
`OFL.txt` alongside them in `apps/web/src/assets/fonts/` before shipping
an external release.

---

## Storyset "Mobile login" illustration

`apps/web/src/assets/illustrations/mobile-login.svg`, used on the login
page. Illustration by Storyset (https://storyset.com), a Freepik
Company project, used under the Storyset free licence, **which requires
attribution**. The credit line "Illustration by Storyset" is rendered on
the login page's illustration panel; keep it there, or acquire a Freepik
premium licence before removing it.

Modified from the original: the accent colour `#407BFF` was recoloured to
the brand's `#0A6B51`, and a `prefers-reduced-motion` rule was added to
the embedded animation.

---

## Charis SIL (planned)

The dictionary panel's IPA pronunciation text is intended to use a bundled
font with full IPA glyph coverage (Charis SIL, SIL Open Font License 1.1
— https://software.sil.org/charis/), per SPEC-offline-dictionary.md §6.3.

**Status: not vendored, and likely no longer required.** The `.font-ipa`
rule in `apps/web/src/styles/index.css` now leads with the bundled Noto
Sans above, whose `latin-ext` subset spans `U+0100–02BA` and therefore
covers IPA Extensions (`U+0250–02AF`). Verify the glyphs the spec calls
out (`ɪ ʃ ð ŋ ɜː`) render from Noto Sans rather than a system fallback on
the deployed Windows 11 image; only if coverage proves incomplete, vendor
Charis SIL's `.woff2` and its `OFL.txt` into
`apps/web/src/assets/fonts/`, wire an `@font-face` rule, and update this
section with its exact version and licence text.

---

*This file is maintained alongside `tools/dictionary-build/` and
`docs/decisions/dictionary-licence.md`. Update it whenever a new
open-data or open-font dependency is added to the dictionary feature.*
