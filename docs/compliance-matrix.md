# Annexure-I Compliance Matrix

Every row of Annexure-I ("Technical Specification: Audio Visual Tools for
English") mapped to the feature that satisfies it, its build status, and
the demo step that proves it. This is the running acceptance artifact for
Ser 11 ("Demo if reqd by the customer should be done and each above
functionality should be shown").

Status legend: ✅ built · 🚧 in progress · ⬜ planned · ⚠️ partial/gap (see note)

## Ser 1 — Digital Language Lab Control / Communication System

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Preset language learning activities | Activity Type Registry (`packages/shared/src/activities`) — ✅ finally consumed, not just defined: `ExercisesService.create/update` validates every authored `config` against the type's own `configSchema` (verified live: a real invalid config gets a real 400 with the zod issue list) | ✅ | 0/3 |
| Screen transfer features | LiveKit `lab:broadcast` room; `BroadcastPanel` (teacher publish) + `StudentConsole` (subscribe/render) — ✅ verified live: real Electron student joined, LiveKit session negotiated end to end | ✅ | 1 |
| Audio and text communication tools | Mic toggle in both `BroadcastPanel` and `StudentConsole`; `MESSAGE` command renders as an in-app toast on the student console — ✅ built and wired, mic audio path not separately load-tested | ✅ | 1 |
| Web browsing / program launch | `LAUNCH_PROGRAM` / `OPEN_URL` commands, server target-resolution + client-side allowlist enforcement (`apps/desktop/src/main/command-handler.ts`) | ✅ | 1 |
| File functions | `POST /api/control/push-file` → `CommandType.PUSH_FILE` → the station downloads its own `MediaAsset` from `/media-assets/:id/file` using its own station token and saves to Desktop/Downloads (`apps/desktop/src/main/command-handler.ts`) — ✅ verified live end to end this pass: a real script-station received a real `PUSH_FILE` envelope and downloaded the exact asset bytes with its own token (closing the Phase 3 "not runtime-fired" gap, and catching the MediaAssetsController bug below along the way) | ✅ | 3/5 |
| Classroom management/control | `DesiredStationState` + `CommandEnvelope`, `ControlController` REST surface, teacher console UI (`StatusBoardPage`) | ✅ | 0/1 |
| Six independent, simultaneous sessions | `ClassSession` → `SessionGroup` (max 6) — ✅ verified live end to end, backend AND UI: `SessionBuilderPage` composes groups/activities/station assignment, `POST /sessions` → `arm` create real per-group LiveKit rooms with correctly-scoped member tokens | ✅ | 1 |
| Lock student screen | Full-screen always-on-top overlay (`apps/desktop/src/main/lock-overlay.ts`) — ✅ verified live end-to-end: REST lock → snapshot push → client lock state → heartbeat → status board reflects LOCKED | ✅ (screen only) | 1 |
| Lock student keyboard and mouse | `SetWindowsHookEx` WH_KEYBOARD_LL/WH_MOUSE_LL native addon — **blocked**, no C++ toolchain on the build machine (no `cl.exe`/CMake/VS installed); `native-bridge` stays the documented stub for *blocking* input (generating input, i.e. remote control, is unblocked — see below) | ⬜ | 1 (blocked) |
| ⚠️ **Gap:** Ctrl+Alt+Del cannot be blocked | WEKF unavailable on Windows 11 Pro (Annexure-III's specified OS) — mitigated via GPO policy keys (DisableTaskMgr etc.), documented as an accepted limitation | ⚠️ | 1 |
| Remote control of student computer | LiveKit data channel (`ctrl:<stationId>` room, teacher-only token) + `@nut-tree-fork/nut-js` replay — **✅ verified live, the real deliverable of this pass**: a script acting as the teacher sent a `move` event through the real LiveKit server to a real Electron student process, which replayed it via nut.js — the actual OS mouse cursor moved to the exact commanded pixel (`{x:1152,y:216}` on a 1536×864 screen, matching normalized (0.75, 0.25)). `RemoteControlView` (teacher UI: view + mouse/keyboard capture) built; `codeToNutKeyName` maps browser key codes to nut.js's `Key` enum | ✅ | 1 |
| Shutdown student computer | `SHUTDOWN` command → `shutdown.exe /s /t 5` (no elevation needed), built in `command-handler.ts`; outbox+ack wired and reachable via the console's Shutdown button | ✅ (code) / 🚧 (not runtime-fired) | 1 |
| Send instructor screen/audio/video/text to consoles | Broadcast room + token minting + `BroadcastPanel`/`StudentConsole` publish-subscribe — ✅ verified live | ✅ | 1 |
| Broadcast any student's screen to others | `MediaService.promoteScreenShare` (server-granted `canPublishSources`) — endpoint built, not runtime-tested (needs a real screen-share publisher to test against) | 🚧 | 1 |
| Disable student stations | `stationEnabled` in `DesiredStationState` + `/control/disable` endpoint + console button — ✅ verified live: a real station's snapshot flipped `stationEnabled: false` the instant `/control/disable` was called, and back to `true` on `/control/enable` | ✅ | 1/5 |
| Individual / group / whole-class intercom | LiveKit room topology (two-plane model) — ✅ rooms/tokens verified live; mic toggle UI built in both consoles | ✅ | 1 |
| Media library, multi-teacher sharing | `MediaAssetsController`/`Service` — upload (multer, size-limited), range-request streaming (206/seeking), PRIVATE/DEPARTMENT/INSTITUTION visibility, `MediaLibraryPage` UI — ✅ verified live: real upload → real file on disk → real authenticated stream-back, in a real browser (Playwright-driven against the real server) | ✅ | 3 |
| Self-study content library, teacher absent | `StudyModulesController`/`Service` (curated exercise bundles) + `StudyLibraryPanel` on the student console + `StudyModulesPage` teacher authoring UI — ✅ verified live: a real station browsed the real CEFR seed pack's modules with no claimed student and no live session, started a bank-mode grammar exercise, submitted it, and got a real server-graded score. A live-session `SELF_STUDY` `ActivityInstance` (a teacher formally scheduling a self-study block into a group) is a deliberate scope cut — see Phase 4 close-out | ✅ | 0/4 |
| Group/pair discussion with recording | `ROUND_TABLE` activity, client-side recording | ✅ | 2 |

## Ser 2 — Model Imitation

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Listen-and-repeat with recorded student track | `ModelImitationActivity` — ✅ verified live end to end this pass: a real session-authored `masterTrackAssetId` streamed back to a real station over its own token (`GET /media-assets/:id/file`) and played through a real `<audio>` element, alongside the pre-existing verified record→upload→stream half | ✅ | 2/4 |
| Readymade or manual pause handling | Manual "Mark Pause" now logs the master track's real `audio.currentTime` as `masterOffsetMs` (was a hardcoded `0` placeholder before playback existed) — ✅ | ✅ | 2/4 |

## Ser 3 — Round Table Discussion

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Chairman-led groups, manual/automatic assignment | `SessionBuilderPage` chairman picker → `SessionsService` → `SessionRole.CHAIRMAN` — ✅ verified live: connected as both roles and confirmed each socket's own snapshot correctly reports `role: CHAIRMAN` / `role: MEMBER` | ✅ | 1/2 |
| Mic-passing, request-to-speak queue | `RoundTableActivity` + `ControlGateway`'s `activity:event` relay — ✅ verified live: a member's `mic_request` was relayed to the chairman's socket with the correct `fromStationId`, over the group's own room | ✅ | 2 |
| Teacher listens in on any group, can join | `POST /control/monitor-group/:groupId/start` mints a hidden, subscribe-only teacher token for whichever room that group's activity actually lives in (`mediaRoomForActivity`) + `GroupMonitorButton` on `SessionBuilderPage` — ✅ verified live: the minted token's grant decoded to `hidden: true, canSubscribe: true` for the exact room the group's own members were connected to | ✅ | 1/5 |
| Recording | Every member records their own mic locally for the activity's duration (client-side, matching design doc §2.6 — no central "the recording") | ✅ | 2 |

## Ser 4 — Content Exercise

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Launch HTML content with text/image/audio | `ContentPackagesService` (SCORM 1.2/2004 `imsmanifest.xml` parsing, zip-slip-guarded extraction, xAPI/HTML entry-point heuristic) + `ContentExercisePlayer` (client-side SCORM API shim — `window.API`/`API_1484_11` on the parent window, the standard `findAPI()` convention, so a package's own `LMSSetValue`/`Terminate` calls genuinely grade it) — ✅ verified live end to end against a real synthetic SCORM 1.2 package: import → manifest-resolved `entryPoint` → served with correct MIME → path-traversal blocked (403). **Scope cut, stated plainly**: this is a launcher, not a full SCORM RTE or an xAPI LRS — see `content-packages.service.ts`'s doc comment | ✅ | 3 |
| Report tool: view, edit, save scores | `GradebookService.override` — audited (`AuditLog` records old→new before every overwrite, since `ScoreOverride` itself is `@unique(attemptId)` and only holds the current value), `GradebookPage` UI — ✅ verified live: real override recorded, real audit trail, real UI round trip (Playwright-driven) | ✅ | 3 |
| Grade-wise, level-wise, Britannica-linked content | `Curriculum.cefrLevel`, engine + import path + an original CEFR A1/A2/B1 seed pack (`seed-cefr-content.ts`) across Listening/Speaking/Reading/Grammar, bundled into browsable `StudyModule`s — ✅ verified live (see Phase 4 close-out). No third-party courseware ships (Britannica, "Rhythm from Rain Land" — see build plan "known gaps"); this is deliberately original content proving the engine, not a licensed replacement | ✅ | 0/4 |

## Ser 5 — Vocabulary Test

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Manual entry or word-list import | `ExercisesController`'s item bank (`PUT :id/items`, `POST :id/items/import-text` — `word-list-parser.ts`, unit-testable independent of transport) + `ExerciseDetailPage` authoring UI — ✅ verified live: real word-list text → real `Item` rows → visible in the real UI | ✅ | 3 |
| Create/launch/save tests, collect results | `AttemptsService.start/submit`, item-bank randomized sampling (Fisher-Yates, `sampleSize`) with a served-order snapshot (`Attempt.itemOrder`) for reproducible grading — ✅ verified live end to end: real student picks a real answer, server-side grading (never trusts a client-submitted correctness flag), real score computed | ✅ | 3 |
| Display individual results, mark correct/incorrect | `ItemResponse.correct`, persisted per served item (bank mode) — ✅ verified live | ✅ | 3 |

## Ser 6 — Telephone Activity

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Student-to-student calls | `TelephoneActivity` — reuses the pair's own already-provisioned group room rather than a separate `call:<id>` room (a 2-member group room *is* isolated 1:1 audio; no extra server plumbing needed). Scenario prompt, countdown timer, and per-participant local recording built | ✅ | 2 |

## Ser 7 — Pronunciation Activity

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Any text → pronunciation exercise | `PronunciationService` wraps real eSpeak-NG (`--ipa`) and Piper (stdin text → wav) binaries via `child_process`, filed into the Media Library as `MediaAsset`s. Neither binary is vendored into this dev box — confirmed live via `GET /pronunciation/status` correctly reporting `{ipa:false, voice:false}` and degrading cleanly (no crash), the same honesty pattern as native-bridge's own platform gap. Real installers are `infra/offline/`'s job at deployment time | ✅ (code) / ⚠️ (binaries not installed on this dev box) | 3 |
| Separate student-side pronunciation app/flow | `PronunciationPlayer` — record via the same verified `ActivityRecorder` pipeline (now with `RecordingKind.PRONUNCIATION`), self-assessed 1-5 rating at submit, teacher assessment overlays via the gradebook's audited `ScoreOverride` — ✅ built, typechecked; the record→submit round trip is exercised by the same `AttemptsService` path verified live for vocabulary tests, not separately fired end-to-end for this specific activity in this pass | ✅ (code) / 🚧 (not separately runtime-fired) | 3 |

## Ser 8 — Conference Interpreting

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Interpreter / Delegate / Observer roles | `SessionRole` enum, `zConferenceInterpretingConfig.roles[]`, mirrored into real `SessionMember.role` at session creation (the same fix pattern Ser 3's `chairmanStationId` got in Phase 2) — ✅ verified live: three real stations connected with `role: INTERPRETER/DELEGATE/OBSERVER` exactly as authored | ✅ | 0/5 |
| Listener selects floor or a specific interpreter | All three roles share ONE session-wide LiveKit room (`interpretingRoom(sessionId)`, not per-group — `mediaRoomForActivity`), with per-role publish grants (`MediaService.mintInterpretingToken`: interpreter/delegate publish, observer subscribe-only) and client-side channel selection (`ConferenceInterpretingActivity` attaches exactly one selected participant's track at a time) reported via `interp:selectChannel` — ✅ verified live end to end: real per-role JWT grants decoded correctly (observer `canPublish: false`, interpreter/delegate `true`), and a real `interp:selectChannel` emission relayed to a real connected teacher dashboard socket | ✅ | 0/5 |
| Interpretation recordings collected | Interpreter and delegate each record their own mic locally via the same verified `ActivityRecorder` pipeline (`RecordingKind.INTERPRETATION`), matching every other activity's "no central recording" design | ✅ | 5 |

## Ser 9 — Presentation Recording

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Screen capture + audio, teacher or student | `PresentationActivity` — `getDisplayMedia` capture (auto-resolved with no OS picker on the real Electron seat, same path as broadcast) + manual start/stop + local preview, uploaded via the verified recording pipeline | ✅ | 2 |

## Ser 10 — English Content

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Skill-based: listening, speaking, reading, grammar | `SkillProgress.skill`, activity registry spans all four | ✅ (schema) | 0 |
| Pronunciation / IPA / minimal pairs / stress & rhythm | Offline eSpeak-NG pipeline + `PRONUNCIATION` activity + the CEFR seed pack's per-level Speaking exercises (original sentences, A1→B1) | ✅ (engine + seed content) / ⚠️ (binaries not installed on this dev box, same tracked gap as Phase 3) | 0/4 |
| Named third-party products (Britannica, "Rhythm from Rain Land", 600-item bank) | **Not shipped, by design** — see build plan "known gaps": engine + SCORM/xAPI import + an original seed pack instead (Phase 4) | ⬜ (deliberate scope cut) | licensing decision |
| Result tracking, follow-up quiz, large randomized test bank | `Attempt`/`ItemBank`/`Item` — per-attempt Fisher-Yates sampling with a served-order snapshot; `SkillProgress` now actually written (was schema-only since Phase 0 — every `SCORED` attempt records a percentage row) — ✅ verified live | ✅ | 3 |
| Teacher-tailored courses: exercises + hours + target score | `Assignment.targetScore`/`.allocatedHours`, `GradebookService.createAssignments` (fan-out studentIds × exerciseIds), `AssignmentsPanel` on the student console (self-paced — see Phase 3 close-out's scope note) — ✅ verified live: real assignment → real student sees it → starts → submits → teacher reviews | ✅ | 3 |
| CEFR-aligned worksheets across 4 key skills | `Curriculum.cefrLevel` engine + an original A1/A2/B1 seed pack spanning Listening/Speaking/Reading/Grammar, bundled into `StudyModule`s a station can browse with no teacher present — ✅ verified live: real seeded content served, attempted, and server-graded through the real running stack | ✅ | 4 |

## Ser 11 — Demo

| Requirement | Feature | Status |
|---|---|---|
| Each functionality above demonstrable on request | This matrix + `tools/sim` (40-station headless harness) doubles as the demo rig | 🚧 |

---

**As of this writing (Phase 0 foundation):** monorepo, Prisma schema
covering every entity above, the full Activity Type Registry with
per-activity zod schemas, JWT auth + RBAC, station registration + seat
binding, the `/control` Socket.IO gateway with presence/heartbeat and
snapshot push, a web dashboard shell (login + live status board), and an
Electron desktop shell (privileged `app://` scheme, station identity,
control-client connecting to `/control`) all build and typecheck cleanly.

**This has been verified against a real, running stack**, not just
compiled: a native PostgreSQL 16 instance (Docker/WSL2 was unavailable —
this dev machine has no virtualization support, itself a useful signal
for the air-gapped deployment's own Docker-optional posture), a real
migration applying the full schema, seeded users, a live server process,
and `tools/sim` driving 41 concurrent real Socket.IO connections through
`station:hello` → ack → `session:snapshot`. That run caught two real bugs
that a type-check alone could not have:

1. `JwtAuthGuard`/`RolesGuard`, registered globally via `APP_GUARD`, also
   intercept the WS gateway's message handlers — and unconditionally
   calling `context.switchToHttp().getRequest()` threw on a WS execution
   context, silently breaking `station:hello` for every station. Fixed by
   short-circuiting both guards on `context.getType() !== 'http'`.
2. `ControlGateway.handleConnection` disconnected any socket without a
   valid dashboard JWT — which is every station, since station auth is
   deliberately deferred to Phase 1. No station could ever have connected
   in a real deployment. Fixed to fall through to station identification
   via `station:hello` instead of hard-disconnecting.

Both are now fixed and reverified.

**Phase 1 (classroom control) — built and partially verified live.**
Sessions/Groups CRUD with the DRAFT→ARMED→RUNNING⇄PAUSED→ENDED state
machine, LiveKit integration (`MediaService`: token minting, room
create/delete, screen-share promotion), the lock lease + 15s
server-heartbeat failsafe (`LockService` + `ControlGateway`), the
imperative command outbox with redelivery-on-reconnect (`CommandsService`),
Wake-on-LAN magic-packet sending, the `/api/control/*` REST surface, and
a working teacher console (`StatusBoardPage`: seat selection + lock/
unlock/message/wake/restart/shutdown/enable/disable buttons wired to
real endpoints). On the desktop side: a pure-Electron lock overlay (no
native hooks needed) and a command handler for shutdown/restart/launch/
openUrl/message, each gated by a local allowlist or scheme check.

**Verified against the real running stack** (native PostgreSQL, LiveKit
run as a native Windows binary — `infra/livekit/bin/livekit-server.exe`,
no Docker needed per the design's own "Docker optional" finding, and a
real Electron process launched with `ELECTRON_RUN_AS_NODE` unset since
this sandbox sets it globally):

- Created a real two-group session via REST, armed it, and confirmed in
  the LiveKit server's own logs that both per-group rooms were created
  with the exact `sess:<id>:grp:<id>` naming the design specifies.
- Reconnected as a real group member and decoded its minted JWT: `role:
  STUDENT`, `canPublishSources: ["microphone"]` only (no screen), `room`
  grant scoped to exactly that group — the cryptographic isolation the
  design calls for, not just a client-side convention.
- Launched a real Electron window (not simulated) that registered with
  the server, received a `session:snapshot`, and reconnected with the
  same persisted `machineGuid` across restarts.
- Locked that real station via REST and watched the exact designed round
  trip happen: `session:snapshot` with `lock` pushed to the one socket →
  client updates local lock state → next heartbeat reports it → the
  teacher-facing status board reflects `LOCKED`.

That last check caught a third real bug: `/api/stations/status-board`
hardcoded `lock`/`mic`/`screenSharing` to `null`/`false` and never
consulted `PresenceService` at all — only the Socket.IO delta path was
ever wired to live data, so the REST endpoint a page's first load
depends on was silently always wrong. Fixed by moving the endpoint to
`ControlController` (`GET /api/control/status-board`), which merges
`StationsService`'s DB truth with `PresenceService`'s live state —
avoiding a `StationsModule` ↔ `ControlModule` circular import by putting
the merge where both dependencies already live.

## Phase 1 close-out (2026-09-08)

Screen broadcast, intercom, the session/group builder, and remote
control — the remaining Phase 1 gaps from the prior pass — are now built
and live-verified. Highlights:

- **`@nut-tree-fork/nut-js` genuinely works here**, contrary to the
  original plan's caution: it needs no C++ toolchain (prebuilt N-API
  binary, confirmed by unpacking the package and finding
  `build/Release/libnut.node` already inside it), and it moved this
  machine's real OS cursor under both plain Node and inside a real
  Electron process. **Correction to the design doc's terminology**: nut.js
  cannot *block/suppress* input (that still needs the real Win32 hook
  addon — blocked, no toolchain), but it can *generate* input, which is
  all remote control requires. `packages/native-bridge`'s
  `NutjsNativeBridge` is real, not a stub.
- **A real architectural bug was caught and fixed**: `/student` was
  gated behind a human login (`ProtectedRoute roles={['STUDENT']}`),
  contradicting the design's own "zero login friction" principle (the
  *station* is the identity, not a user account) — and silently meaning
  the student runtime (control socket, remote-control listener,
  broadcast subscription) never even connected on an idle seat with
  nobody logged in. Fixed: `/student` now mounts unconditionally, and the
  Electron app's default route is `/student` directly.
- **A real token-permission bug was caught and fixed**: the remote-control
  student token reused `mintToken`'s generic mic-only STUDENT grant, so
  LiveKit correctly rejected the screen-share publish with "insufficient
  permissions" — a real rejection from a real server, not a mock. Fixed
  with a dedicated `mintRemoteControlStudentToken` grant.
- **A real build-time bug was caught and fixed**: once desktop's main
  process imported `@lab/native-bridge`, tsup's bundler tried to
  statically resolve native-bridge's intentionally-conditional
  `require('.../lab_native.node')` and failed at *build* time instead of
  letting the try/catch handle it at *runtime*. Fixed by keeping
  `@lab/native-bridge` external to the bundle.
- **A real type-drift bug was caught and fixed**: `LabRuntimeConfig` was
  independently duplicated in `apps/web` and `apps/desktop`, and the
  desktop copy had already fallen out of sync (missing fields the web
  side had gained). Moved to `@lab/shared` so this class of bug can't
  recur.

**Still blocked:** `native-bridge`'s real Win32 hooks for *blocking*
keyboard/mouse input (as opposed to remote-control's *generating* input,
which works) — this build machine has no C++ toolchain (`cl.exe`, CMake,
VS Build Tools all absent, only Python). Screen-lock works today because
it's pure Electron API; the OS-level input block does not yet exist.

**Not yet built (as of the Phase 1 pass):** `promoteScreenShare`'s runtime
path (a student broadcasting to the whole class — the endpoint exists,
untested), file push, and every live-activity player.

## Phase 2 close-out (2026-09-08)

Four of Annexure-I's five live activities now have real, working
players — round table (Ser 3), telephone (Ser 6), presentation recording
(Ser 9), and model imitation's recording half (Ser 2). Content exercise
and vocabulary test stay Phase 3 (they're assessment, not live-activity,
scope). Every recording flows through one real, verified pipeline:
create the row before capture starts → client-side `MediaRecorder` →
upload → stream back — proven end to end with a real file (create →
upload → `status: ready` with correct path/size/duration → metadata
fetch → byte-identical stream-back).

**Architectural finding, not a gap:** the telephone activity needed no
new server plumbing at all — a 2-member session group's own room (Phase
1's per-group LiveKit room) already *is* an isolated 1:1 call. The
design doc's original `call:<callId>` ephemeral-room sketch turned out
to be redundant with the group mechanism already built.

This pass caught and fixed three more real bugs:

1. **`chairmanStationId` was silently ignored** — `SessionsService`
   hardcoded every group member to `role: 'MEMBER'`, so Ser 3's
   chairman-led discussion could never actually have a chairman, in code
   that had already been marked "done" in the schema. Fixed, and
   verified live: two real sockets connected to the same group each
   correctly received their own `CHAIRMAN`/`MEMBER` role.
2. **Group/session room membership was wrongly gated on having a seat
   number assigned** — `station:hello`'s room-join logic only ran
   `if (seatNo)`, so any station without an assigned seat could be a
   real, correctly-configured session member (right role, right activity
   in its own snapshot) and *still* never actually join its group's
   Socket.IO room — silently breaking the mic-request relay and anything
   else scoped to it. Caught by the first end-to-end relay test timing
   out with no error on either side. Fixed by decoupling room membership
   from seat assignment entirely.
3. **A static-property side-effect anti-pattern** in an early draft of
   `RoundTableActivity` (mutating `Component.handleRelay` during render
   to hand data to a parent) was caught before it shipped and replaced
   with a proper `lastActivityEvent` prop from `StudentConsole` — the
   original would have broken the moment two round-table groups were
   ever active on screen at once.
4. **Recording endpoints would have been unreachable, not merely
   insecure** — `RecordingsController` had no `@Public()` marker, and
   the global `JwtAuthGuard` blocks *any* unmarked route regardless of
   role. Since stations still have no JWT (the same tracked Phase 1
   gap), every recording call would have 401'd. Fixed by marking the
   controller `@Public()`, matching the existing `/stations/register`
   posture, with the access-control gap stated plainly in code rather
   than papered over.

**Not yet built:** content exercise and vocabulary test players (Phase
3), conference interpreting (Ser 8, Phase 5), `promoteScreenShare`'s
runtime path, and file push.

## Phase 3 close-out (2026-09-08)

Media library, SCORM/xAPI/HTML import, exercise authoring with a real
randomized item bank, attempts/scoring, an audited gradebook, XLSX/PDF
reports, the offline pronunciation pipeline, and file push are all built
and **verified against the real running stack at every layer**: native
PostgreSQL, the real Nest server (built + booted, not `ts-node`), a real
Electron main process (registered, authenticated, received a snapshot),
and a real headless Chrome driven end to end (login → every sidebar page
→ upload → create → import → assign → grade → override → download) — not
mocked, not just typechecked. `npx turbo run typecheck` is green across
all 7 workspaces.

**The headline architectural gap this pass closed**: stations had no JWT
since Phase 1 (`RecordingsController` was `@Public()` because of it, and
the compliance matrix tracked it as a known gap through Phase 2).
`AuthService.mintStationToken` + `station:hello`'s ack now hand every
station a real, short-TTL, `kind: 'station'` credential — verified live:
a script holding a genuine **teacher** token got a real `403` from
`/stations/claim`, and a script holding the station's own token succeeded,
claimed a roster identity, started a graded attempt, and had its answer
scored server-side.

**Six real bugs caught by testing against the real stack, not by
type-checking** (the same discipline every prior phase followed):

1. **A real security bug this pass would have shipped**: `VOCABULARY_TEST`
   was 100% dead code through Phase 2 (verified by grep — the registry's
   `configSchema` had never been run against real data), so nobody had
   noticed that `SessionStateService.getDesiredState` forwards
   `ActivityInstance.config` to the student's own snapshot completely
   unmodified. The moment this pass built a real player, an inline vocab
   item's `answer` field would have been sitting in the browser's own
   snapshot object — the exact question the student is about to be
   tested on. Fixed by stripping answer keys at the one choke point every
   live-session activity config passes through
   (`session-state.service.ts`'s `sanitizeConfigForWire`), not by
   trusting every future player to remember not to render `config.answer`.
2. **`zItemResponseDto.itemId` required a strict cuid2**, which rejected
   every inline-mode item id (`"inline:0"`, the placeholder
   `AttemptsService.prepareServe` hands out for manually-authored items
   that have no `Item` row to point a real id at) — caught by a real
   attempt submission getting a real 400, not by any type check (both
   shapes were valid TypeScript strings).
3. **`gradebook-api.ts` built its query string with
   `new URLSearchParams({exerciseId: undefined, ...})`**, which
   JavaScript stringifies as the literal text `"undefined"`, not an
   omitted parameter — the Gradebook page rendered a plausible-looking
   *empty* table instead of erroring, and only a real browser session
   with real seeded attempts exposed it (an isolated unit test with an
   explicit `exerciseId` would never have hit this path).
4. **Two Express-5-specific findings, verified against the actually
   installed `express@5.2.1`/`path-to-regexp@8.4.2` rather than assumed
   from older docs**: a named wildcard route (`:id/files/*path`) yields
   `req.params.path` as a **string array** of segments, not a joined
   string — confirmed with a throwaway server before writing the real
   handler; and a plain `<iframe src>` cannot carry an `Authorization`
   header, which would have made the SCORM player's own launch route
   unreachable — resolved by making only that one route `@Public()`
   (content packages are shared teaching material, not per-student
   secrets — a deliberately lower-stakes trade-off than the recordings
   gap this same pass closed).
5. **A stale-build false negative caught the hard way**: widening
   `GET /users` from ADMIN-only to TEACHER+ADMIN (the gradebook's
   "assign to students" picker needs a roster) typechecked and looked
   correct, but the *running* server process had been built before the
   edit — real browser testing caught two real `403`s the source code no
   longer produced, which is its own small lesson about this verification
   method: a green typecheck on disk says nothing about the process
   actually listening on the port.
6. **`RecordingsService`'s multer temp storage used `os.tmpdir()`**,
   typically a different Windows volume than `LAB_DATA_ROOT` (meant to
   become `D:\LabData` per the design doc) — `fs.rename` across volumes
   throws `EXDEV`. Not yet triggered on this single-volume dev box, but
   real enough that every Phase 3 upload path (media assets, content
   packages) was built against a shared `StorageService` whose temp dir
   lives under `LAB_DATA_ROOT` itself, and the pre-existing recordings
   path was retrofitted to match rather than left as a latent trap.

**Scope decisions made explicit, not silently assumed:**

- **Assessment activities (`VOCABULARY_TEST`, `CONTENT_EXERCISE`,
  `PRONUNCIATION`) run through a standalone "My Assignments" panel on the
  student console, independent of the live `ClassSession`/`ActivityInstance`
  machinery** — `Attempt.exerciseId` is required, and Phase 1/2's
  `ActivityInstance` has no `Exercise` link, so bridging the two would
  have meant touching the already-verified Sessions module. Given Ser 10
  itself describes these as "teacher-tailored courses" (assigned,
  self-paced), not synchronized real-time activities the way round-table/
  telephone inherently are, this is treated as the correct primary
  mechanism, not a stopgap. A live-session `ActivityInstance` of these
  three types still renders (honestly) as "no player built yet" —
  bridging them is a scoped follow-up, not a silent gap.
- **SCORM/xAPI import is a launcher, not a full runtime.** The client-side
  API shim (`ContentExercisePlayer`) genuinely captures a real package's
  `LMSSetValue`/`Terminate` calls — verified against a real synthetic
  SCORM 1.2 zip — but there is no server-side SCORM data model and no
  xAPI Learning Record Store. A package that doesn't call the standard
  API (or an xAPI package expecting a real LRS endpoint) launches and
  displays but won't self-report a score; a teacher's `ScoreOverride`
  covers that case, same as pronunciation's human-assessed score.
- **`packages/ui` was not adopted.** Its `./styles.css` export already
  pointed at a file that doesn't exist, and Tailwind v4's source
  detection skips `node_modules`/workspace symlinks by default — wiring
  it in properly was a larger yak-shave than the one consumer (`apps/web`)
  justified this pass. shadcn/ui primitives live in
  `apps/web/src/components/ui` instead; consolidating into `packages/ui`
  once a second consumer exists is a tracked follow-up, not forgotten.
- **`GET /users` was widened from ADMIN-only to TEACHER+ADMIN** — a
  read-only roster listing, needed for the gradebook's student picker,
  judged not to be a privilege teachers shouldn't already effectively
  have (they see every station/session/exercise already).

**Not yet built:** SCORM/xAPI's own server-side RTE data model and a real
xAPI LRS (deliberate scope cut, above), `ModelImitationActivity` actually
wiring its `masterTrackAssetId` to a real Media Library fetch (the
dependency now exists; the wiring is a small follow-up), and the Week-1
native spikes remain formally unrun (superseded by the real Phase 1/2
findings against native-bridge and LiveKit).

## Phase 4 close-out (2026-09-08)

Self-study library, the CEFR seed pack, and Model Imitation's master-track
playback are built and **verified against the real running stack**: native
PostgreSQL, a real `nest build` + `node dist/main.js` server process (not
`ts-node`), real LiveKit, and real stations driven the same way
`tools/sim` already does (genuine `socket.io-client` connections through
the real `station:hello`/heartbeat/snapshot protocol) rather than mocked —
a one-off verification script exercised every claim below against that
stack, then was deleted (its findings are recorded here, matching every
prior phase's practice of not keeping throwaway test scripts in the repo).

**What's new:**

- **Self-study library** (`StudyModulesController`/`Service`,
  `StudyLibraryPanel`, `StudyModulesPage`) — a StudyModule is a named,
  ordered bundle of already-authored exercises; browsing needs no claimed
  student and no live session at all, the literal Ser 1 requirement.
  Starting an exercise from it reuses the exact same `AttemptsService`
  path "My Assignments" already verified — no new grading logic, only
  curation and a station-authenticated `GET /study-modules/library`.
- **An original CEFR A1/A2/B1 seed pack** (`seed-cefr-content.ts`, run
  from `prisma/seed.ts`) spanning Listening/Speaking/Reading/Grammar per
  level, each level bundled into its own `StudyModule`. Deliberately
  small and hand-written — see the build plan's "known gaps": no
  Britannica, no "Rhythm from Rain Land", no purchased 600-item bank,
  because licensing that was never this project's call to make. This
  proves the CEFR engine with real content instead of leaving
  `Curriculum.cefrLevel` schema-only.
- **`ModelImitationActivity` now really plays the master track** —
  `config.masterTrackAssetId` streams from `/api/media-assets/:id/file`
  the same way `PronunciationPlayer`'s model audio already did, and
  "Mark Pause" logs the audio element's real `currentTime` instead of a
  hardcoded `0` placeholder.
- **Listening-skill items can now carry real audio.**
  `Item.mediaAssetId` existed in the schema since Phase 0 but nothing
  served or rendered it — `attempts.service.ts`'s `ServedItem` now
  forwards it (bank mode only; inline-authored items have no media
  field), and `VocabularyTestPlayer` renders an authenticated `<audio>`
  for any item that has one. The seed pack's own Listening items ship
  *without* audio (see "known gaps" below) — this is the durable
  capability a teacher uses today by attaching a real recording to any
  item via `PUT /exercises/:id/items`.
- Extended `SessionBuilderPage` to compose `MODEL_IMITATION` (a media-asset
  picker) directly, closing the last of the three activity types that
  comment used to say needed Phase 3's CMS first.

**Two real bugs caught by testing against the real stack, not by
type-checking:**

1. **`MediaAssetsController`'s two read routes were blanket
   `@Roles(TEACHER, ADMIN)`** — meaning `GET /media-assets/:id/file` 403'd
   for any station token, always. This wasn't a Phase 4 regression: it's
   been there since Phase 3 built the controller, and it silently meant
   `PronunciationPlayer`'s model-audio playback (shipped in Phase 3) could
   never actually have worked from a real station either — the compliance
   matrix's own Ser 7 note ("not separately runtime-fired") was more
   right than anyone knew. Caught the moment this pass's
   `ModelImitationActivity` rewrite tried the same fetch for real. Fixed
   the same way `RecordingsController` had already solved the identical
   shape of problem in Phase 3: `StationOrStaffGuard` on the two read
   routes, write routes stay teacher/admin-only.
2. **`zItemDto`'s `cefrTag`/`mediaAssetId`/`choices` were `.optional()`
   (undefined-only)**, but Prisma serializes an unset nullable column as
   `null` and an unset scalar-list column as `[]` — never an absent key.
   A teacher's own "fetch an existing item bank, then PUT it back"
   round trip (exactly what attaching a `mediaAssetId` to an existing
   seeded item requires) was a guaranteed 400 for any item that had never
   set those fields. Fixed with `z.preprocess` collapsing `null`/`[]` to
   `undefined` before the existing `.optional()` checks run.

**Scope decision made explicit:** a live-session `SELF_STUDY`
`ActivityInstance` (a teacher formally scheduling a self-study block into
a session group) is not built this pass — the standalone library above is
the primary and, for now, only self-study delivery mechanism, matching
Ser 1's literal wording ("self-study... when teacher not present") more
directly than a teacher-scheduled block would, and mirroring Phase 3's own
precedent of running assessment activities standalone rather than through
the live `ActivityInstance` machinery. `ActivityPlayer`'s registry still
renders the honest "no player built yet" fallback for `SELF_STUDY` inside
a live session — not silently dropped, just not this pass's mechanism.

**Not yet built:** the seed pack stops at B1 (extending to A1-C2, or
importing a licensed bank, is the same StudyModule/Curriculum machinery,
not a rework); its Listening items ship as text transcripts, not real
audio (the eSpeak-NG/Piper binaries this would need aren't vendored on
this dev box — the same tracked gap Phase 3's pronunciation pipeline
already carries); and there's no inline "author an exercise while
building a study module" flow yet — a teacher authors exercises on the
Exercises page first, same as building a session group's config today.

## Phase 5 close-out (2026-09-08)

Conference interpreting's runtime, the teacher group-monitor gap, and a
first hardening pass (rate limiting, an elevated station-agent service,
offline-vendoring tooling) are built. Interpreting and the group monitor
are **verified against the real running stack** the same way as Phase 4
above (real Postgres/LiveKit/server, real script-driven stations); the
hardening pieces are honestly split between what was actually run and
what was deliberately not run against a developer's own machine — see
below, the same discipline every native-bridge/pronunciation gap in this
document already follows.

**Conference Interpreting (Ser 8), verified live:**

- All three roles (`INTERPRETER`/`DELEGATE`/`OBSERVER`) share **one
  session-wide LiveKit room** (`interpretingRoom(sessionId)`), not a
  per-group room — a new `mediaRoomForActivity(sessionId, groupId,
  activityType)` helper is the single place both `SessionsService`
  (room create/delete) and `SessionStateService` (token minting) make
  this decision, so the two can't independently disagree about a room
  name the way leaving the choice in two places would invite.
- Per-role LiveKit grants (`MediaService.mintInterpretingToken`): a real
  interpreter and a real delegate's tokens decoded to `canPublish: true`
  (the delegate's mic *is* the floor channel, an interpreter's mic *is*
  their language channel); a real observer's decoded to `canPublish:
  false` — listen-only, verified by decoding the actual minted JWTs, not
  by reading the code that mints them.
- `ConferenceInterpretingActivity` — interpreter/delegate publish +
  record locally (`RecordingKind.INTERPRETATION`, the same
  `ActivityRecorder` pipeline every other activity uses, closing Ser 8's
  "recordings collected" row); every role gets a channel picker ("Floor"
  + one button per interpreter's language) that attaches exactly one
  selected participant's track at a time — `StudentConsole` deliberately
  does NOT auto-attach this one room's tracks the way every other room's
  mic tracks are, specifically so channel selection has something to
  select between rather than everyone always hearing everyone.
  `interp:selectChannel` (declared in the contract since Phase 0, never
  wired to a handler) now relays to a teacher's dashboard socket — verified
  by a real observer's channel switch arriving at a real connected
  teacher socket.
- **Ser 3's last open gap, "teacher listens in on any group, can join,"**
  closed the same pass: `POST /control/monitor-group/:groupId/start`
  mints a hidden, subscribe-only teacher token for whichever room a
  group's activity actually lives in — proven against the interpreting
  room specifically (the one case where "which room" isn't the obvious
  per-group default), and a `GroupMonitorButton` on `SessionBuilderPage`.

**Hardening:**

- **Rate limiting** (`@nestjs/throttler`, a generous global default —
  100/min, sized for legitimate dashboard polling — with `@Throttle()`
  overrides tightening `/auth/login` to 5/min and `/stations/claim` to
  10/min, the two routes where guessing a credential/identifier alone has
  any effect). Registered as a fourth global `APP_GUARD` alongside
  `JwtAuthGuard`/`RolesGuard` — which meant it also ran in front of every
  `ControlGateway` `@SubscribeMessage` handler and would have hit the
  *exact* bug Phase 0's close-out already documents for those two guards
  (`context.switchToHttp().getRequest()` throwing on a WS execution
  context, silently breaking `station:hello` for every station). Caught
  before it shipped this time, not after an outage: `HttpThrottlerGuard`
  wraps the built-in guard with the same one-line short-circuit.
- **`services/lab-agent-svc`** (new workspace — `services/*` wasn't even
  in the root `package.json`'s `workspaces` glob before this pass, despite
  the README describing it since Phase 1) — real, reviewable
  implementations of every step `apps/desktop/build/installer.nsh` has
  documented as a placeholder since Phase 1: the input-lock GPO policy
  values (`gpo-policies.ts` — pure, individually-testable registry-value
  data, closing the loop on Ser 1's accepted Ctrl+Alt+Del mitigation),
  root CA import, a lab-subnet firewall rule, and Windows service
  registration via `node-windows` (picked for the same "no C++ toolchain
  needed" reason Phase 1 picked `@nut-tree-fork/nut-js`). **Not executed
  against any real machine this pass** — every action is a real, elevated,
  machine-mutating change (registry policy writes, a Trusted Root import,
  a firewall rule, a service registration), squarely the "hard to
  reverse, outward-facing" category this project's own engineering
  discipline keeps off a developer's own box. Same honesty pattern as
  native-bridge's blocked hooks: the gap is stated, not hidden behind a
  green checkmark.
- **`infra/offline/`** — a README enumerating every vendor binary a real
  air-gapped install needs (PostgreSQL, LiveKit, Memurai, Caddy, Node.js,
  eSpeak-NG, Piper) and `fetch-vendor.ps1` to pull them, with every URL in
  it verified live against each project's real GitHub Releases API /
  official download endpoint while writing it. **Not run this pass** —
  it downloads several real gigabytes of third-party binaries, an
  unprompted heavy external action this pass held off on for the same
  reason lab-agent-svc's install wasn't run.
- Deliberately **not fired**: the real `SHUTDOWN` command. File push and
  disable/enable were fired for real against a script-driven station
  because both are safe, reversible, and local to the test (a download,
  a boolean flag). Actually calling `shutdown.exe /s` against whatever
  machine hosts the verification would not have been reversible in the
  same sense — the command-dispatch and client-receipt path is the same
  well-tested code as every other command type, but the OS call itself
  was deliberately left unfired, a judgment call rather than an oversight.

**Two real bugs/gaps caught by building and testing this against the real
stack:**

1. **`zConferenceInterpretingConfig.roles[]` was keyed by `studentId`**
   since Phase 0, but a session is authored against *stations*, and a
   student isn't necessarily claimed onto any station at authoring time
   (`StationsService.claim` happens at runtime) — the exact class of bug
   Phase 2's `chairmanStationId` fix already caught once for round table.
   Renamed to `stationId` before it ever shipped a runtime path, and
   `SessionsService.create()` now mirrors the assigned role into a real
   `SessionMember.role` (the same treatment chairman got), which is what
   `SessionStateService` actually reads to decide LiveKit publish grants —
   real DB state, not something re-derived from `activity.config` at
   every call site.
2. **Adding `@nestjs/throttler` broke every `tsup` build in the monorepo**
   (`packages/shared`, `apps/desktop`, the new `lab-agent-svc`) with a
   `Cannot find module 'esbuild'` thrown from inside `bundle-require` —
   an npm workspace hoisting side effect: `bundle-require` sits at the
   repo's root `node_modules` and resolves `esbuild` by walking up from
   there, but adding a new dependency anywhere in the tree shifted npm's
   dedupe outcome so no compatible `esbuild` was hoisted to root anymore
   (each of `tsup`/`tsx`/`vite`'s own conflicting version requirements got
   nested under themselves instead). Not caused by anything in this
   pass's own source changes, and not fixed by pinning `esbuild` as a
   root `devDependency` either — that reintroduced the exact peer conflict
   with `vite`'s newer required range that caused the imbalance in the
   first place. Fixed with `npm dedupe`, verified by a full
   `npx turbo run build typecheck` going green across all 8 workspaces
   afterward. Worth remembering: the next dependency addition anywhere in
   this repo can trigger the same thing, and `npm dedupe` is the fix, not
   a fresh `npm install`.

**Not yet built (as of this pass):** native-bridge's Win32 input-lock
hooks remain blocked (still no C++ toolchain on this machine — unchanged
since Phase 1); `promoteScreenShare`'s runtime path (a student
broadcasting to the whole class) remains built-but-untested, unchanged
since Phase 1, since it needs a real screen-share publisher this pass
didn't add one. Everything else this section originally listed as
outstanding — the real native agent, `installer.nsh` invoking it, the
internal CA/Caddy config, CI, backup/restore, and an actual load-tested
offline installer — is closed below.

## Phase 5 close-out, continued — the plan-fidelity gaps (2026-09-08)

A direct re-read of the original build plan (not just this matrix's own
phase framing, which graded some of the above more leniently than the
plan's specific line items warranted) found six concrete gaps between
what the plan asked for and what actually existed. All six are now built
and, except where stated, **verified against the real running stack** —
a real booted server, real Postgres/LiveKit, and for several of these, a
genuinely downloaded/executed third-party binary (Caddy, the actual
`electron-builder` NSIS toolchain), not just code review.

1. **The real native agent — named pipe + closed verb set.** The earlier
   Phase 5 pass built `lab-agent-svc`'s GPO/CA-import/firewall pieces but
   left `shutdown`/`restart`/`LAUNCH_PROGRAM` going straight from the
   unprivileged Electron process to `exec()`, bypassing the design doc's
   "single most important security control" entirely. Closed for real:
   `agent-server.ts` is a genuine Win32 named pipe server
   (`\\.\pipe\labportal-agent`) speaking a **closed verb set** —
   `shutdown`, `restart`, `resolve-launch`, `apply-update` — with no
   "run arbitrary command" verb, by construction. `apps/desktop`'s
   `agent-client.ts` tries the agent first and falls back to the old
   direct-exec path only if the agent isn't installed (a dev machine
   keeps working, honestly degraded — the same posture every other
   optional-dependency gap in this codebase already has).

   **A real, verified finding replacing the design doc's own sketch**:
   the plan called for authenticating the pipe's caller via
   `GetNamedPipeClientProcessId` + `QueryFullProcessImageName`. Tested
   directly — Node's `net` module exposes no usable HANDLE for a pipe
   connection (`socket._handle.fd` is `-1`; `GetNamedPipeClientProcessId`
   on it fails with `ERROR_INVALID_HANDLE`, confirmed live) and no other
   property on the internal handle object exposes one either. True
   process-identity binding would need a native addon (blocked, same
   toolchain gap) or a full Win32 pipe reimplementation over FFI with
   overlapped I/O — judged too large an undertaking for an auth layer
   alone. Shipped instead: a random capability token
   (`token-store.ts`), rotated per service start, written to
   `%ProgramData%\LabPortal\agent.token` with an `icacls`-set ACL
   (SYSTEM/Administrators write, `Users` read) — closes the actual
   exploitable gap (nothing off-machine can guess it) without the
   process-identity binding the original sketch wanted. Stated as a
   trade-off, not hidden behind a green checkmark.

   Verified live (a real running `agent-server.ts`, not mocked): a real
   token mismatch is rejected; `resolve-launch` genuinely reads
   `allowlist.json` and rejects an id that isn't in it;
   `apply-update` genuinely rejects an installer path outside the
   update-staging directory. `shutdown`/`restart` were deliberately
   **not** live-fired even to immediately abort — they share the exact
   same token-check-then-`execFile` dispatch path already proven by the
   other two verbs, and this pass's own safety tooling separately
   declined to run a real OS shutdown call during testing, which is the
   right call, not a gap.

2. **LAN auto-update, end to end.** `electron-updater` had been a
   dependency since Phase 1 with zero wiring. `apps/desktop/src/main/updater.ts`
   now calls `autoUpdater.checkForUpdates()` (packaged builds only) with
   `autoInstallOnAppQuit: false` — on `update-downloaded` it stages the
   file and waits for an explicit `CommandType.APPLY_UPDATE`, which goes
   through the agent's `apply-update` verb instead of electron-updater's
   own UAC-prompting install path. Server-side,
   `apps/server/src/main.ts` now actually serves `WEB_DIST_PATH` and a
   new `UPDATES_DIR` at `/updates/win/*` — **a real finding along the
   way**: `WEB_DIST_PATH` had been declared in `env.validation.ts` since
   Phase 0 with nothing ever serving it (dev mode's separate Vite server
   masked the gap completely; a "production" boot of this server alone
   never served the SPA at all until this pass).

   **Verified live, completely for real**: ran `electron-builder --win`
   for the first time this project has ever produced a packaged build —
   a genuine 118 MB `LabPortal Setup 0.1.0.exe` (NSIS, `@nut-tree-fork`
   correctly unpacked from asar, the web dist correctly bundled into
   `resources/web`) plus a real `latest.yml` manifest. Copied both into a
   `UPDATES_DIR`, pointed the real running server at it, and confirmed
   `GET /updates/win/latest.yml` and `GET /updates/win/LabPortal Setup 0.1.0.exe`
   serve the exact real file (byte-identical size) through the actual
   Nest server — proving the whole feed shape electron-updater expects is
   real, not just plausible-looking config. (One real debugging detour:
   the mount path `/updates/win` supplies the `win` URL segment itself —
   files belong directly in `UPDATES_DIR`, not in a `UPDATES_DIR/win/`
   subfolder. Caught by testing, not assumed, and now stated explicitly
   in `main.ts`'s own comment.) Not verified: a packaged app's
   `autoUpdater` actually downloading and applying this in place — that
   needs running the packaged `.exe` as a real station, a further step
   left for actual deployment rehearsal.

3. **Backup/restore.** Named in the plan's Phase 5 line item, nothing
   existed. `infra/backup/backup.ps1` dumps the database (`pg_dump`,
   custom format) and archives `LAB_DATA_ROOT` to a timestamped folder;
   `restore.ps1` is the inverse, gated behind `-Confirm` since `--clean`
   drops every object in the target database first. `POST /api/admin/backup`
   (new `AdminModule`, ADMIN-only) triggers the same script server-side
   with the server's own `DATABASE_URL`/`LAB_DATA_ROOT`, so a manual and
   a scheduled backup can never drift onto different databases. **Verified
   live**: fired the real endpoint against the real dev database and got
   back a genuine `pg_dump` custom-format archive (spot-checked read-only
   with `pg_restore --list` — 151 real TOC entries) and a real
   `labdata.zip`. `restore.ps1` was not fired destructively against the
   only database this session had been building against all day — a
   judgment call, not an oversight, stated in that script's own README.

4. **CI.** Named explicitly in the plan's "Phase 0 — Foundation" line
   item; no workflow file existed at all. `.github/workflows/ci.yml` now
   runs `npx turbo run build typecheck lint test` on every push/PR — the
   exact same commands verified locally throughout this pass, not a
   different, untested path. Structurally valid; not verified by an
   actual GitHub Actions run (no way to trigger one from here).

   **Two more real findings surfaced getting `lint`/`test` to actually
   run for the first time** (both scripts had existed since Phase 0 with
   no working tooling behind them): no `eslint` dependency or config
   existed anywhere in the repo despite every workspace's `package.json`
   having a `lint` script; and `jest`/`ts-jest` (present since Phase 0)
   cannot run this codebase at all — NestJS 12 genuinely ships
   `"type": "module"`, and while plain `node dist/main.js` works
   transparently (Node 22+'s `require(esm)` interop, this repo pins
   `node >=24`), jest-runtime's own module system doesn't get that
   interop for free and fails with a real
   `SyntaxError: Cannot use import statement outside a module` the
   moment a test touches `@nestjs/common`. Fixed: a real
   `eslint.config.mjs` (flat config, shared across every workspace) and
   a switch to `vitest` (`apps/server`, `packages/shared`) — verified by
   writing and passing 33 real unit tests across three files: the
   Activity Type Registry (including a regression test for this pass's
   own `studentId`→`stationId` rename), `zItemDto`'s null-handling fix,
   the word-list parser, and `AttemptsService`'s actual scoring logic
   (case/whitespace-insensitive grading, partial credit, the Phase 3
   answer-leak regression, ownership/status guards) via a fake
   `PrismaService` rather than a live database — real unit-level
   confidence, not the integration-level "real running stack" testing
   this project otherwise relies on, and explicitly not a replacement for
   it (see `vitest.config.mts`'s own doc comment).

5. **Internal CA + Caddy TLS.** `infra/caddy/` had been referenced since
   Phase 0 ("once written in Phase 0 hardening") and stayed empty.
   `infra/caddy/Caddyfile` uses Caddy's own built-in local CA
   (`tls internal`) — genuinely the "internal CA" the plan calls for, not
   a placeholder — serving `labserver.lab.local` (proxied to the Nest
   server) and `livekit.labserver.lab.local` (proxied to LiveKit's WS
   signaling; the UDP RTC media ports are never proxied, by design).
   **Verified live**: downloaded the real Caddy v2.11.4 Windows binary,
   ran it against this exact Caddyfile with the real server and real
   LiveKit already running, and confirmed full certificate verification
   (no `-k`/insecure flag — Windows curl's schannel backend needed
   `--ssl-no-revoke` since a local CA has no CRL endpoint, which is
   expected and unrelated to certificate validity) against three real
   requests: the SPA at `/`, a real 401 through the `/api` proxy path,
   and LiveKit's own response through the subdomain proxy.

6. **41-seat load test with a real session, not just connections.**
   `tools/sim` had proven 40 real concurrent connections since Phase 0
   but never a real session touching every seat — `--with-session` now
   arms a genuine 6-group session (a real mix of
   CONFERENCE_INTERPRETING/ROUND_TABLE/TELEPHONE/VOCABULARY_TEST) across
   every connected station and times the full snapshot fan-out. **Verified
   live**: 40 real stations, real per-role LiveKit tokens minted for the
   interpreting group, all 40 stations received their post-arm snapshot
   in 266ms, session ended cleanly, zero server-side errors.

## Student credential sign-in on the Electron seat (2026-09-12)

A real student login was added at the seat — a student now signs in with
their own service number + password, sees only their own assignments, and
admin retains exclusive rights to create student accounts and set/reset
passwords via the existing `/admin/users` page. This deliberately
overturns the Phase 3 "roster pick, not a login" design (`StationsService.
claim` — see its earlier doc comment) in favour of a real credential
check, per an explicit product decision.

**What changed:** `POST /stations/claim` (still `StationAuthGuard`-gated,
so the caller must be a genuine station) now also requires a `password`
and runs it through the same `AuthService.authenticate` a dashboard login
uses — unknown service number, deactivated account, wrong password, and a
valid non-student account (e.g. a teacher's own credentials typed at a
seat by mistake) are all indistinguishable to the caller: one "Invalid
credentials" response, matching `POST /auth/login`'s own oracle-free
behaviour. On success it also mints a real STUDENT JWT
(`AuthService.issueUserToken`) so the student has an independent session,
and audits `station.claim_failed` with a `reason` on every failure path
(`invalid_credentials` / `not_a_student` / `already_claimed`) — closing
the "no audit on a failed credential check here" gap that existed before
(mirroring `BatchesService.joinByCode`'s `batch.join_failed` pattern).
Throttle tightened from 10/min to 5/min to match `/auth/login`, now that
the route accepts a real password. `/attempts/*` and
`/study-modules/library` are unchanged — they still resolve "which
student" from `Station.currentUserId`, set at claim time, using the
station's own token, not the new STUDENT JWT.

On the seat, `AssignmentsPanel`'s old "type your service number, no
password" claim card is gone, replaced by a full-screen
`StudentSignInScreen` that only covers the content area — `StudentConsole`
still always mounts and always connects `StationControlClient` regardless
of sign-in state, matching the router's documented lesson that gating
`/student` itself once broke server-initiated features on an idle seat.
A live teacher-run activity (station/group-scoped, identity-free by
design) still renders above the gate even while signed out. A new
`useStudentSession` store (sessionStorage, not `useAuthStore`'s
`localStorage` — a seat is shared hardware) holds the signed-in student;
`apiFetch`/`apiUpload` fall back to it when there's no dashboard login, so
`JoinBatchPanel` (self-join, needs a real STUDENT JWT) now actually works
from a real seat instead of always rendering `null`. A boot-time check
releases any claim the server still remembers from a previous occupant
who didn't sign out cleanly, rather than silently resuming their identity
the way the old passwordless recovery-on-refresh did — that resume was
fine before because there was no credential to bypass; now it would be.

**Verified against the real running stack**, not mocks or typechecking
alone: `npx turbo run build typecheck` green across all 8 workspaces; a
built server + real Postgres exercised via `socket.io-client` "stations"
and plain `fetch` confirmed the failure oracle (wrong password, unknown
service number, and valid teacher credentials all return byte-identical
401s, each audited with a distinct `reason` and never the password
itself), the 409 conflict on re-claiming an already-claimed student
(and that releasing frees it), the 5/min throttle, and that a STUDENT JWT
is correctly rejected with 403 on `/attempts/*` (still station-only). A
full lifecycle was run end to end through the real HTTP API: a teacher
account creates an assignment, a student signs in with real credentials
at a station, sees exactly that assignment, starts an attempt (served
items carry no answer keys), submits, and is scored. Then a real
Playwright/Chromium session against the real Vite dev server
(`localhost:5173/#/student` — `createHashRouter`, so the hash prefix is
required) confirmed the actual UI: the sign-in gate renders when signed
out and hides the assignments panel; a wrong password shows an inline
error and leaves the seat signed out; correct credentials sign in, show
the student's own name on "My Assignments", and reveal `JoinBatchPanel`
for the first time on a real seat; sessionStorage survives a reload; and
signing out returns to the gate. Finally, confirmed the regression this
design exists to avoid did not recur: the browser console logged the
station attempting to join its LiveKit broadcast room *while still on the
sign-in screen*, and `GET /control/status-board` (queried live, as
ADMIN-001) showed that same station's `lastSeenAt` current and heartbeat
active while signed out — the gate is a render-level overlay, not a route
guard, and the station runtime never stops.
