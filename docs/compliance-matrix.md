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
| Preset language learning activities | Activity Type Registry (`packages/shared/src/activities`) | 🚧 | 0/2-3 |
| Screen transfer features | LiveKit `lab:broadcast` room + per-group rooms — rooms/tokens ✅ verified live; UI to actually publish/view a screen track not yet built | 🚧 | 1 |
| Audio and text communication tools | Control-plane messages ✅ (verified: teacher→station broadcast); mic-audio intercom rooms exist (tokens minted) but no client-side audio UI yet | 🚧 | 1 |
| Web browsing / program launch | `LAUNCH_PROGRAM` / `OPEN_URL` commands, server target-resolution + client-side allowlist enforcement (`apps/desktop/src/main/command-handler.ts`) | ✅ | 1 |
| File functions | `PUSH_FILE` command envelope exists; transfer mechanism not yet built | ⬜ | 3 |
| Classroom management/control | `DesiredStationState` + `CommandEnvelope`, `ControlController` REST surface, teacher console UI (`StatusBoardPage`) | ✅ | 0/1 |
| Six independent, simultaneous sessions | `ClassSession` → `SessionGroup` (max 6) — ✅ verified live: created a 2-group session, armed it, confirmed per-group LiveKit rooms + correctly-scoped tokens for each group's members | ✅ (backend) / ⬜ (builder UI) | 1 |
| Lock student screen | Full-screen always-on-top overlay (`apps/desktop/src/main/lock-overlay.ts`) — ✅ verified live end-to-end: REST lock → snapshot push → client lock state → heartback → status board reflects LOCKED | ✅ (screen only) | 1 |
| Lock student keyboard and mouse | `SetWindowsHookEx` WH_KEYBOARD_LL/WH_MOUSE_LL native addon — **blocked**, no C++ toolchain on the build machine (no `cl.exe`/CMake/VS installed); `native-bridge` stays the documented stub | ⬜ | 1 (blocked) |
| ⚠️ **Gap:** Ctrl+Alt+Del cannot be blocked | WEKF unavailable on Windows 11 Pro (Annexure-III's specified OS) — mitigated via GPO policy keys (DisableTaskMgr etc.), documented as an accepted limitation | ⚠️ | 1 |
| Remote control of student computer | Data-channel input replay + nut.js `SendInput` — needs the LiveKit client screen-share wiring first; nut.js itself needs no compiler (prebuilt N-API) so unblocked once media UI lands | ⬜ | 1 |
| Shutdown student computer | `SHUTDOWN` command → `shutdown.exe /s /t 5` (no elevation needed), built in `command-handler.ts`; outbox+ack wired and reachable via the console's Shutdown button | ✅ (code) / 🚧 (not runtime-fired) | 1 |
| Send instructor screen/audio/video/text to consoles | Broadcast room + token minting ✅ verified; actual publish/subscribe UI not yet built | 🚧 | 1 |
| Broadcast any student's screen to others | `MediaService.promoteScreenShare` (server-granted `canPublishSources`) — endpoint built, not runtime-tested (needs a real screen-share publisher to test against) | 🚧 | 1 |
| Disable student stations | `stationEnabled` in `DesiredStationState` + `/control/disable` endpoint + console button — wired end to end via `resolveAndPush`, not yet runtime-fired | ✅ (code) / 🚧 (untested) | 1 |
| Individual / group / whole-class intercom | LiveKit room topology (two-plane model) — rooms/tokens ✅ verified; mic-audio UI not yet built | 🚧 | 1 |
| Media library, multi-teacher sharing | `MediaAsset.scope` (PRIVATE/DEPARTMENT/INSTITUTION) | ✅ (schema) / ⬜ (UI) | 0/3 |
| Self-study content library, teacher absent | `StudyModule`, `SELF_STUDY` activity | ✅ (schema+registry) / ⬜ (player) | 0/4 |
| Group/pair discussion with recording | `ROUND_TABLE` activity, client-side recording | ✅ (schema) / ⬜ (runtime) | 0/2 |

## Ser 2 — Model Imitation

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Listen-and-repeat with recorded student track | `MODEL_IMITATION` activity descriptor, dual-track (master+student) | ✅ (schema) / ⬜ (player) | 0/2 |
| Readymade or manual pause handling | `pausePoints` config + `pauseLog` response, `{masterOffsetMs, wallClockMs}` | ✅ (schema) / ⬜ (runtime) | 0/2 |

## Ser 3 — Round Table Discussion

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Chairman-led groups, manual/automatic assignment | `chairmanAssignment` config, `SessionRole.CHAIRMAN` | ✅ (schema) / ⬜ (UI) | 0/2 |
| Mic-passing, request-to-speak queue | `micRequestQueueEnabled`, `activity:event` mic_request | ✅ (schema) / ⬜ (runtime) | 0/2 |
| Teacher listens in on any group, can join | Pre-connected teacher rooms, `hidden` grant | ⬜ | 1 |

## Ser 4 — Content Exercise

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Launch HTML content with text/image/audio | `CONTENT_EXERCISE` activity, `ContentPackage` (SCORM/xAPI/HTML import) | ✅ (schema) / ⬜ (player+importer) | 0/3 |
| Report tool: view, edit, save scores | `ScoreOverride` model, audited | ✅ (schema) / ⬜ (UI) | 0/3 |
| Grade-wise, level-wise, Britannica-linked content | `Curriculum.cefrLevel`, engine + import path (no third-party courseware shipped — see build plan "known gaps") | ✅ (schema) / ⬜ (seed pack) | 0/4 |

## Ser 5 — Vocabulary Test

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Manual entry or word-list import | `zVocabularyTestConfig`, `items[]` | ✅ (schema) / ⬜ (importer+UI) | 0/3 |
| Create/launch/save tests, collect results | `Attempt`, `ItemResponse` | ✅ (schema) / ⬜ (UI) | 0/3 |
| Display individual results, mark correct/incorrect | `VocabularyTestResponse.answers[].correct` | ✅ (schema) / ⬜ (UI) | 0/3 |

## Ser 6 — Telephone Activity

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Student-to-student calls | `TELEPHONE` activity, ephemeral `call:<id>` LiveKit room | ✅ (schema+room helper) / ⬜ (runtime) | 0/2 |

## Ser 7 — Pronunciation Activity

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Any text → pronunciation exercise | eSpeak-NG (IPA) + Piper (model audio) offline pipeline | ✅ (schema) / ⬜ (pipeline) | 0/3 |
| Separate student-side pronunciation app/flow | `PronunciationPlayer` component slot | ⬜ | 3 |

## Ser 8 — Conference Interpreting

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Interpreter / Delegate / Observer roles | `SessionRole` enum, `zConferenceInterpretingConfig.roles[]` | ✅ (schema) | 0 |
| Listener selects floor or a specific interpreter | Server-driven `updateSubscriptions`, `interp:selectChannel` event | ✅ (contract) / ⬜ (runtime) | 0/5 |
| Interpretation recordings collected | Per-track client-side recording | ⬜ | 5 |

## Ser 9 — Presentation Recording

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Screen capture + audio, teacher or student | `PRESENTATION_RECORDING` activity | ✅ (schema) / ⬜ (runtime) | 0/2 |

## Ser 10 — English Content

| Requirement | Feature | Status | Phase |
|---|---|---|---|
| Skill-based: listening, speaking, reading, grammar | `SkillProgress.skill`, activity registry spans all four | ✅ (schema) | 0 |
| Pronunciation / IPA / minimal pairs / stress & rhythm | Offline eSpeak-NG pipeline + `PRONUNCIATION` activity | ✅ (schema) / ⬜ (seed content) | 0/4 |
| Named third-party products (Britannica, "Rhythm from Rain Land", 600-item bank) | **Not shipped** — see build plan "known gaps": engine + SCORM/xAPI import + original seed pack instead | ⬜ | licensing decision + 4 |
| Result tracking, follow-up quiz, large randomized test bank | `Attempt`, `ItemBank`/`Item` (per-attempt randomization) | ✅ (schema) / ⬜ (UI) | 0/3 |
| Teacher-tailored courses: exercises + hours + target score | `Assignment.targetScore`, `.allocatedHours` | ✅ (schema) / ⬜ (UI) | 0/4 |
| CEFR-aligned worksheets across 4 key skills | `Curriculum.cefrLevel`, original seed pack | ⬜ | 4 |

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

**Known, deliberate gap:** `packages/native-bridge`'s real Win32 hooks
(keyboard/mouse lock, `SendInput` remote control) are blocked — this
build machine has no C++ toolchain (`cl.exe`, CMake, VS Build Tools all
absent, only Python). `native-bridge` stays the documented
`NotImplementedNativeBridge` stub; screen-lock works today because it's
pure Electron API, but the OS-level input block does not yet exist.
Remote control (data-channel input replay) is additionally blocked
behind the not-yet-built LiveKit screen-share client UI.

**Not yet built:** the actual screen-broadcast/intercom client UI
(publish/subscribe against the already-working LiveKit rooms/tokens),
the session/group builder UI (backend is done and verified, no teacher
UI to compose one yet), and every live-activity player (Phase 2).
