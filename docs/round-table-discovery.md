# Round Table discovery (Phase 0)

Findings from reading the codebase before implementing `SPEC-round-table-discussion.md`.
Corrects spec section 3, which was written without access to `apps/*`.

## What exists

| Area | File | What it does today |
|---|---|---|
| Registration | `packages/shared/src/activities/definitions.ts` | Config (topic, chairmanAssignment, micRequestQueueEnabled) + response keyed by `studentId`. `playerComponent`/`authoringComponent` strings are never read by the web app. |
| Player | `apps/web/src/features/activities/RoundTableActivity.tsx` | Chairman's client holds the floor and queue locally, relays `mic_request` / `chairman_pass` over `activity:event`. Shows raw station ids. Records own mic. |
| Player lookup | `apps/web/src/features/activities/registry.tsx` | Hard-coded `switch (activity.type)`. |
| Relay | `apps/server/.../control/control.gateway.ts` (`activity:event`) | Re-emits to `grp:<id>` with `fromStationId`. No membership or role check. Dashboards never join `grp:` rooms. |
| Session build | `apps/server/.../sessions/sessions.service.ts` | `create` maps `chairmanStationId` to `SessionMember.role = CHAIRMAN`. `arm` creates one LiveKit room per group. `SessionGroup.chairmanId` is never written. |
| Snapshot | `apps/server/.../control/session-state.service.ts` | Group token via `mintToken` (every member can publish mic). `ActivityInstance.state` JSON is never used. |
| LiveKit | `apps/server/.../media/media.service.ts` | `RoomServiceClient` only. `updateParticipant` already used for screen-share promotion. No egress, no webhook controller. |
| Listen-in | `control.controller.ts` `monitor-group/:groupId/start` | Teacher token with `hidden: true`; listen only; no student-visible indicator; no batch check. |
| Recording | `apps/web/src/lib/activity-recorder.ts`, `recordings` module | Each seat records its own mic (`GROUP_DISCUSSION`) and uploads. |
| Attempts | `attempts.service.ts` | ROUND_TABLE deliberately rejected; `Attempt.exerciseId` is required, no response column. |
| Authoring | `apps/web/src/features/teacher/SessionBuilderPage.tsx` | Inline ROUND_TABLE branch; hard-codes `chairmanAssignment: 'manual'`. |

## Clause status

| Clause | Status | Notes |
|---|---|---|
| RT-1 groups | works | Up to 6 groups per session with a seat picker. |
| RT-2 chairman | partial | Stored as `SessionMember.role`, delivered as `snapshot.role`, but not shown to others. |
| RT-3 pass the mic | **missing** | Floor is client-decided; nothing gates LiveKit publish. |
| RT-4 meeting environment | works | Per-group LiveKit room. |
| RT-5 manual/automatic | **partial** | Config flag exists but is never used; no automatic split or chairman pick. |
| RT-6 participant list | **missing** | Raw station ids only. |
| RT-7 request button | partial | Button exists; queue is client-held and lost on reconnect. |
| RT-8 teacher listen-in | partial | Hidden listen-in exists; not student-visible; no batch check. |
| RT-9 teacher participates | **missing** | |
| RT-10 record + turns | **missing** | Per-seat audio exists; no turns, no review, no server clock. |

## Corrections to the spec

- Recording stays client-side per station (infra/README: Egress is Docker/Linux only). The server times turns; the review page plays seat recordings in sync.
- Results go in a new `RoundTableTurn` table, not Attempts.
- Teacher LiveKit identity stays `st:teacher:<userId>` (existing convention).
- No old-turn read adapter: no Round Table response was ever persisted.
- Floor state persists in the unused `ActivityInstance.state` column.
