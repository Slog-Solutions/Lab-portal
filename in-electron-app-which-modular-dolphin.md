# Plan: Complete project documentation — `PROJECT_DOCUMENTATION.md`

## Context

The user wants one detailed, downloadable Markdown file that documents the
whole Digital Language Lab project: every technology used, and how the app
actually works. Confirmed choices:

- **Audience: internal team.** Full technical depth: exact versions, every
  API endpoint, data model, WebSocket events, local setup, dev seed
  accounts, and an honest known-gaps section.
- **Location: repo root, `PROJECT_DOCUMENTATION.md`**, next to `README.md`.
  The path is currently free.

What exists today is spread out: `README.md` (short status),
`docs/compliance-matrix.md` (a 63 KB tender-traceability log, not a guide),
`infra/*/README.md`, and design notes in code comments. No single document
explains the system end to end. This change is documentation only. No code,
config, or database changes, and no commit unless asked.

## Deliverable

One new file: `PROJECT_DOCUMENTATION.md` (roughly 1,500–2,500 lines). It
uses GitHub-flavoured Markdown with a linked table of contents, tables, and
`mermaid` diagrams (these render on GitHub and in VS Code preview, and stay
readable as plain text).

## Accuracy rules (apply throughout)

- **Source every fact from the code, not memory.** Take versions from each
  workspace's `package.json`, endpoints from the `*.controller.ts` files,
  models from `apps/server/prisma/schema.prisma`, and env vars from
  `apps/server/src/config/env.validation.ts`.
- **Describe the current state, not the historical one.** Student sign-in is
  now password-gated (`POST /stations/claim`), not the old passwordless
  claim. The live dev DB was cleaned on 2026-09-12 and now holds only
  `ADMIN-001`, with the 12 CEFR exercises and 3 curricula reassigned to it.
  `seed.ts` is unchanged and recreates the demo accounts if run.
- **Never write real secret values.** List env var *names* and non-secret
  defaults only. Leave out the `JWT_SECRET` value from `.env` and the full
  LiveKit key string from `infra/livekit/livekit.yaml` (just call it a
  dev-only key that must be regenerated). The dev seed passwords
  (`Admin@12345` / `Teacher@12345` / `Student@12345`) *are* included, since
  this is internal and they're already in `README.md`. Add a
  rotate-before-deployment warning next to them.
- **Label things that were never verified.** Examples: `fetch-vendor.ps1`
  never run, the native Win32 input hooks never built, packaged
  auto-update never exercised end to end.

## Document outline and sources

1. **Title + table of contents**
2. **Project overview.** What it is (on-prem, air-gapped language lab for
   ACTC, No 2 TRG BN, ASC Centre (South)), built against tender
   Annexure-I Ser 1–11. Covers 41 seats (1 teacher + 40 students), up to 6
   simultaneous group sessions, and CEFR courseware. Source: `README.md`,
   `docs/compliance-matrix.md`.
3. **Key concepts / glossary.**
   - A station is not a user; stations are identified by machineGuid.
   - Seat 1 is the teacher's seat.
   - Batch, enrollment, and join key.
   - Session → group → activity instance.
   - Claim, meaning student sign-in at a seat.
   - Desired-state snapshots vs one-shot commands (the two-plane model).
   - Lock as a lease, not a latch.
   - The **three token types**: dashboard JWT (8h), station token (12h,
     minted on every `station:hello`), and student JWT (minted at claim).
4. **System architecture.**
   - A mermaid component diagram: Electron seats and browser dashboard ↔
     Caddy (internal CA TLS) ↔ NestJS (REST `/api` + Socket.IO `/control`)
     ↔ PostgreSQL. Also shown: the LiveKit SFU (media), `LabData/` file
     storage, and `lab-agent-svc` over a named pipe.
   - How the single React bundle runs in two hosts (`app://` in Electron,
     http in a browser).
5. **Technology stack.** One table per layer with **exact versions** and the
   reason for each choice:
   - **Backend:** NestJS 12, Prisma 6.19.3, PostgreSQL 16, Socket.IO 4.8.3,
     livekit-server-sdk, bcryptjs, zod 4.5.4, helmet, throttler, exceljs,
     pdfkit, adm-zip, fast-xml-parser.
   - **Web:** React 19.2, Vite 8.2.2, Tailwind 4.3.3, Radix, TanStack
     Query, Zustand, react-router 7, livekit-client, lucide.
   - **Desktop:** Electron 44.2.0, electron-builder, electron-updater,
     tsup, nut.js.
   - **Tooling:** npm 11 workspaces, Turborepo 2.10.12, TypeScript 5.9.2,
     Vitest 5, ESLint 10, Node ≥24.14.
   - **Infra:** LiveKit server, Caddy, Redis (compose only), eSpeak-NG,
     Piper, and PowerShell backup scripts.
   - **Air-gap rationale:** exceljs/pdfkit instead of CDN-backed SheetJS,
     offline TTS/IPA, self-hosted LiveKit, and `createHashRouter`.
6. **Repository structure.** An annotated tree covering the 8 workspaces,
   `infra/`, `scripts/`, `docs/`, and `.github/`, plus each workspace's
   role and npm scripts.
7. **How the app works, by role** (the functional core):
   - **Admin:** `/admin/users` (create accounts with initial password,
     reset password, deactivate); `/admin/batches` and the detail page
     (join key, assign teachers, enrol students, delete rules); assigning
     unclaimed stations to seats; `POST /admin/backup`.
   - **Teacher:**
     - *Lab Control console:* the 41-tile grid, lifecycle colours,
       toolbar (lock, unlock, message, WoL, restart, shutdown,
       enable/disable), seat detail, release student, Broadcast panel,
       and remote control.
     - *Session Builder:* up to 6 groups, the 5 live activity types, seat
       chips, chairman/interpreter roles, arm → start → pause → end, and
       "Listen" group monitoring.
     - *Other pages:* Media Library (assets and SCORM/xAPI/HTML packages);
       Exercises (item bank, word-list import, randomized sampling, the
       pronunciation pipeline, assign to students with a target score);
       Study Library modules; Gradebook (audited score overrides); and
       Reports (XLSX/PDF).
   - **Student at the seat:** boot → auto-registration → full-screen sign-in
     → My Assignments / Study Library / My Batches → live activities →
     receiving locks, messages, and the "Instructor has taken control"
     indicator → sign out, plus the stale-claim release on boot.
   - **End-to-end flows as mermaid sequence diagrams:**
     1. Station first boot and seat assignment
     2. Student sign-in
     3. Teacher runs a session
     4. Assignment → attempt → server-side scoring → override
     5. Remote control
     6. Lock and the 30 s failsafe

   Source: this session's web/desktop exploration and `router.tsx`.
8. **Activities (Ser 2–10).** A registry table (config, response,
   mediaRoom, recording, chairman) from
   `packages/shared/src/activities/definitions.ts`. Then one paragraph per
   player covering what the student does, how recording works
   (`lib/activity-recorder.ts`), and how it's scored.
9. **Desktop client internals** (`apps/desktop/src`):
   - The role of each main-process file.
   - Every `CommandType` it executes, with its safeguards (shutdown `/a`
     then `/f`, the program allowlist, the http(s)-only rule for
     OPEN_URL).
   - The lock overlay: per-display, 250 ms re-topmost, 30 s lease.
   - Why it uses the `app://` protocol, the preload bridge
     (`__LAB__`, `__LAB_AGENT__`), and LAN auto-update.
10. **Elevated agent (`services/lab-agent-svc`).**
    - The closed verb set, and the capability token rotated on each start
      with icacls lock-down.
    - The `%ProgramData%` allowlist and the GPO values reasserted every
      5 min.
    - Root CA import, firewall rule, and install/uninstall behaviour.
11. **Backend reference.**
    - Module list; a **complete endpoint table** per module (method, path,
      role/guard, purpose).
    - The Socket.IO `/control` gateway: handshake, rooms, received and
      emitted events, and the `station:hello` sequence.
    - Guards and pipes, `CommandsService` outbox, `PresenceService`,
      `LockService`, and `SessionStateService`.
    - Timing constants: 5 s heartbeat, 15 s offline, 15 s lock heartbeat,
      30 s lease, 60 s command TTL.
    - LiveKit room naming.
12. **Data model.**
    - A mermaid ER diagram, and model tables grouped as Identity / Lab /
      Runtime / Content / Assessment / Governance.
    - Enums, and the plain-string status columns that need no migration.
    - Delete behaviour (cascade / restrict / set-null), drawn from the
      migration SQL.
    - The 3 migrations.
13. **Security.**
    - bcrypt cost 12, JWT lifetimes, and oracle-free login/claim errors.
    - A throttle table: global 100/min; login, claim, and batch join each
      5/min.
    - Audit logging (full action list in the appendix).
    - Answer-key stripping, zip-slip and path-traversal guards, CORS and
      helmet.
    - Station vs staff guards, and the agent's closed verbs.
    - **Known security limitations:** no JWT revocation; the lock overlay
      doesn't block OS input; `StationOrStaffGuard` has no own-vs-any
      scoping; the public content-package launch route.
14. **Configuration.** A server env var table with defaults (no secret
    values), Electron env vars (`LAB_SERVER_URL`, `LAB_LIVEKIT_URL`), and
    key `livekit.yaml` settings (`use_external_ip: false`, `node_ip`,
    `auto_create: false`).
15. **Local development.**
    - Prerequisites (Node 24, npm 11, PostgreSQL 16 via Docker or winget,
      and the `CREATEDB` grant).
    - `npm install`, migrate, seed.
    - `dev`, `dev:web`, `dev:livekit`, `dev:all`, `dev:desktop`, and
      `sim` (including `--with-session`).
    - Typecheck, lint, test.
    - **Gotchas:** the esbuild/`npm dedupe` footgun, Prisma `EPERM` when
      the server is still running, LiveKit not started by `dev:web`, the
      hash-router URLs.
16. **Seed data and current DB state.** What `seed.ts` and
    `seed-cefr-content.ts` create: the admin, 3 teachers with ranks, 40
    students, batch `ACTC-B01`, CEFR A1/A2/B1 content, and 3 study modules.
    A clear note that the live dev DB currently holds only `ADMIN-001`.
17. **Build, packaging, deployment.**
    - `vite build`, `nest build`, `electron-builder --win` (NSIS,
      perMachine, no code signing yet).
    - The `/updates/win` feed, the Caddyfile, and the native Windows
      services table.
    - Backup/restore scripts, offline vendoring, and the pre-go-live
      checklist.
    - Source: `infra/README.md`, `infra/*/README.md`.
18. **Testing and verification.** Vitest scope (server + shared only), the
    CI workflow, the real-stack verification methodology, and the
    40-station load test result (266 ms snapshot fan-out).
19. **Project status and known gaps.** Phases 0–5 complete, plus student
    credential sign-in. The honest remaining list, limited to items the
    exploration confirmed:
    - Native-bridge Win32 hooks never built.
    - `installer.nsh` is a placeholder; no code-signing certificate.
    - `fetch-vendor.ps1` never run; packaged auto-update not exercised.
    - Caddy not a Windows service; `node_ip` and the LiveKit key need
      real LAN values.
    - `session:state` is declared but never emitted.
    - `openUrl`/`pushFile` exist in the API but aren't surfaced in the
      Lab Control UI.
    - `packages/ui` is unused.
    - No test/lint scripts in most workspaces.
20. **Appendices.** Audit action strings, `CommandType` list, lifecycle /
    session / role enums, LiveKit room names, and a glossary of
    abbreviations (SFU, CEFR, SCORM, xAPI, WoL, GPO, SAS).

## Implementation steps

1. Re-read the exact sources while writing each section, so versions,
   routes, and defaults are copied rather than recalled:
   - every workspace's `package.json`
   - `apps/server/src/modules/**/*.controller.ts`
   - `schema.prisma`
   - `env.validation.ts`
   - `packages/shared/src/activities/definitions.ts`
   - `apps/web/src/app/router.tsx`
   - `infra/README.md`
2. Write `PROJECT_DOCUMENTATION.md` at the repo root. Create it with Write
   for the first sections, then append later sections with Edit so each
   chunk stays reviewable.
3. Don't touch any other file. Leave `README.md` and
   `docs/compliance-matrix.md` unchanged. Don't commit.

## Verification

- **Endpoint coverage.** Count `@Get|@Post|@Patch|@Put|@Delete` decorators
  across `apps/server/src/modules/**/*.controller.ts` and confirm the doc's
  endpoint tables list the same number, with matching paths.
- **Version accuracy.** Run a small read-only node one-liner that prints
  every dependency version from each workspace `package.json`, then
  spot-check it against the doc's stack tables.
- **No leaked secrets.** Grep the new file for the `.env` `JWT_SECRET`
  value, `devsecret`, and the LiveKit key string. All must be absent.
- **Structure.** Every table-of-contents link matches a real heading
  anchor, code fences and mermaid blocks are balanced (even count of
  opening/closing fences), and it renders cleanly in VS Code Markdown
  preview.
- **Current-state spot checks.** The doc says the claim needs a password,
  the live DB holds only `ADMIN-001`, and the throttle on
  `/stations/claim` is 5/min.
- `git status` shows exactly one new untracked file:
  `PROJECT_DOCUMENTATION.md`.
