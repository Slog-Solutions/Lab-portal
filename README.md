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
apps/web/       React SPA — teacher/admin dashboard, student console
apps/desktop/   Electron shell — the student seat's client (.exe)
packages/shared/  Types, zod schemas, socket event contract, Activity Type Registry
packages/ui/      Shared component library (Phase 1+)
packages/native-bridge/  Win32 input-lock/remote-control N-API addon (Phase 1)
services/lab-agent-svc/  Elevated Windows service (Phase 1)
infra/          docker-compose.yml, LiveKit config, deployment notes
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
(proxied to the API — see `apps/web/vite.config.ts`). Sign in at
`http://localhost:5173` with the seeded admin (`ADMIN-001` /
`Admin@12345`) or teacher (`TCH-001` / `Teacher@12345`) account.

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

To run the desktop client against the same dev server:

```
npm run dev --workspace=apps/desktop
```

## Deployment

The real deployment target is air-gapped: no internet, no cloud
services, TLS via an internal CA, LiveKit and every dependency running
natively on the lab server. See [`infra/README.md`](infra/README.md).

## Status

Phase 0 (foundation) is built and verified: monorepo, full Prisma schema,
Activity Type Registry, JWT auth + RBAC, station registration/seat
binding, the `/control` gateway with presence tracking, a web dashboard
shell, and an Electron desktop shell — all build and typecheck cleanly.
See the compliance matrix for what's demoable today versus what Phase 1+
adds.
