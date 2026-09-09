# Digital Language Lab

An on-premise Digital Language Lab platform for ACTC, No 2 TRG BN, ASC
Centre (South), Bangalore — built against the FY 2026-27 tender's
Annexure-I technical specification. A LAN server plus a Windows client
give one instructor real-time audio, screen and control authority over 40
student stations partitioned into up to six simultaneous independent
sessions, plus a CEFR-aligned English courseware and assessment engine —
all functioning with **zero internet connectivity**.

See [`docs/compliance-matrix.md`](docs/compliance-matrix.md) for the
line-by-line mapping from the tender to what's built, and the plan file
this project was built from for the full architecture rationale.

## Stack

PostgreSQL + Prisma · NestJS 12 · self-hosted LiveKit · Socket.IO ·
React 19 + Vite + Tailwind · Electron 44 · npm workspaces + Turborepo.
Full rationale in the build plan (LiveKit vs mediasoup, why recording is
client-side, the native Windows control-agent design, the two-plane
media room topology).

## Repo layout

```
apps/server/    NestJS API + /control Socket.IO gateway + Prisma
apps/web/       React SPA — teacher/admin dashboard (shadcn/ui, Phase 3), student console
apps/desktop/   Electron shell — the student seat's client (.exe)
packages/shared/  Types, zod schemas, socket event contract, Activity Type Registry
packages/ui/      Shared component library — unused as of Phase 3 (shadcn primitives
                  live in apps/web/src/components/ui instead; see compliance matrix)
packages/native-bridge/  Win32 input-lock/remote-control N-API addon (Phase 1)
services/lab-agent-svc/  Elevated Windows service — a real Win32 named-pipe
                  server with a closed shutdown/restart/launch/apply-update
                  verb set (live-verified), GPO input-lock mitigation, root
                  CA import, firewall rule, service registration (Phase 5;
                  the elevated/machine-mutating install steps were not run
                  against any real machine — see that package's own README)
infra/          docker-compose.yml, LiveKit config, deployment notes,
                  offline/ (air-gapped vendoring plan, Phase 5)
tools/sim/      Headless N-station load-test harness (Phase 1+)
docs/           Compliance matrix, deployment runbooks
```

## Getting started (local dev)

```
npm install
docker compose -f infra/docker-compose.yml up -d
cp apps/server/.env.example apps/server/.env      # edit JWT_SECRET at minimum
npm run prisma:migrate --workspace=apps/server
npm run prisma:seed --workspace=apps/server        # admin/teacher/40 students, see console output for passwords
npm run dev
```

This starts the Nest API on `:3000` and the Vite dev server on `:5173`
(proxied to the API — see `apps/web/vite.config.ts`); the `docker compose`
step above (no service filter) also starts LiveKit alongside
Postgres/Redis, since screen/audio broadcast, remote-control and group
activities all need it. Sign in at `http://localhost:5173` with the
seeded admin (`ADMIN-001` / `Admin@12345`) or teacher (`TCH-001` /
`Teacher@12345`) account.

**No Docker / no virtualization available?** Install PostgreSQL natively
instead — this is also genuine dev-environment parity with the lab
server's own Docker-optional deployment path (`infra/README.md`):

```
winget install --id PostgreSQL.PostgreSQL.16 --silent \
  --accept-package-agreements --accept-source-agreements \
  --override "--mode unattended --superpassword <pw> --servicename postgresql-labportal --datadir C:\PgData\16 --serverport 5432"
```

Then create the `labportal` role/database (see `infra/README.md` for the
exact `psql` commands) and set `DATABASE_URL` in `apps/server/.env`
accordingly — `GRANT CREATEDB` on the role too, since
`prisma migrate dev` needs a shadow database.

Without the `docker compose` step, nothing starts LiveKit for you — run
`npm run dev:livekit` (launches the vendored native binary at
`infra/livekit/bin/livekit-server.exe` against `infra/livekit/livekit.yaml`,
no Docker needed) alongside `npm run dev:web`, or just run
`npm run dev:all` to start LiveKit + server + web together in one command.

To run the desktop client against the same dev server:

```
npm run dev --workspace=apps/desktop
```

## Deployment

The real deployment target is air-gapped: no internet, no cloud
services, TLS via an internal CA, LiveKit and every dependency running
natively on the lab server. See [`infra/README.md`](infra/README.md).

## Status

Phases 0-5 are built and verified against the real running stack (native
PostgreSQL, real LiveKit, a real Electron process, real script-driven
stations, a real browser driven end to end) — not just compiled.

Phase 3 (assessment & content) added the media library, SCORM/xAPI/HTML
import with a client-side SCORM API shim, exercise authoring + a
randomized item-bank engine, attempts/scoring, an audited gradebook,
XLSX/PDF reports, the offline eSpeak-NG/Piper pronunciation pipeline, and
closed the "stations have no JWT" gap tracked since Phase 1.

Phase 4 (courseware & self-study) added a self-study library reachable
with no teacher present or student claimed (Ser 1's literal requirement),
an original CEFR A1/A2/B1 seed pack across all four key skills, and
Model Imitation's master-track playback.

Phase 5 (interpreting & hardening) added Conference Interpreting's full
runtime (a session-wide interpreting room, per-role LiveKit publish
grants, client-side channel selection, per-track recording), closed Ser
3's last open gap ("teacher listens in on any group"), rate limiting, a
real elevated `services/lab-agent-svc` — a Win32 named-pipe server with a
closed shutdown/restart/launch/apply-update verb set, GPO input-lock
mitigation, root CA import, and firewall rules — LAN auto-update wired
end to end (a real `electron-builder --win` NSIS installer served
through the server's own `/updates/win/`, verified byte-for-byte), real
backup/restore tooling, a Caddy-based internal CA + TLS config (verified
against a real downloaded Caddy binary), a CI workflow, and a 40-seat
load test that arms a real 6-group session, not just connections. See
that package's own README and the compliance matrix's Phase 5 addendum
for exactly what was live-verified vs. built-and-reviewed.

See `docs/compliance-matrix.md` for the full row-by-row mapping,
including every scope decision made explicit rather than silently
assumed (self-paced assessment vs. live-session activities, xAPI serving
without a full LRS, why the seed pack is original rather than licensed
content, the capability-token trade-off in place of the design doc's
original named-pipe process-identity sketch, and which hardening steps
were live-verified vs. built-and-reviewed).

Remaining, honestly: native-bridge's Win32 input-lock hooks (no C++
toolchain on any build machine used so far); `infra/offline/fetch-vendor.ps1`
is written but not run (downloads several real GB of third-party
installers — a deliberate choice, not a limitation); a packaged app's
`autoUpdater` hasn't been exercised end to end against a real running
station; and the Week-1 native spikes (superseded by the real Phase 1/2
findings against native-bridge and LiveKit, never separately re-run).
