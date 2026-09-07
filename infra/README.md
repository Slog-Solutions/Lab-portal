# Infra

## Local development

```
docker compose -f infra/docker-compose.yml up -d
cp apps/server/.env.example apps/server/.env   # edit if needed
npm run prisma:migrate --workspace=apps/server
npm run prisma:seed --workspace=apps/server
npm run dev --workspace=apps/server
```

### No Docker / no virtualization

Some dev machines can't run Docker Desktop at all (WSL2 needs hardware
virtualization, which is unavailable inside some VMs and sandboxes — this
was the actual case building this project). Install PostgreSQL natively
instead (see the `winget` one-liner in the root `README.md`), then:

```
$env:PGPASSWORD = '<superpassword>'
psql -U postgres -h localhost -p 5432 -c "CREATE ROLE labportal WITH LOGIN PASSWORD 'labportal';"
psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE labportal OWNER labportal;"
psql -U postgres -h localhost -p 5432 -c "ALTER ROLE labportal CREATEDB;"   # prisma migrate dev needs a shadow db
```

Point `DATABASE_URL` in `apps/server/.env` at
`postgresql://labportal:labportal@localhost:5432/labportal?schema=public`
and proceed with the migrate/seed/dev steps above as normal. Redis and
LiveKit still need Docker (or their native-Windows paths below) for
anything past the control-plane/database layer.

## Lab server deployment (air-gapped, native Windows — design doc §2.7)

If Docker is not permitted on the lab server, every component here has a
native Windows path and only one capability is lost (Egress recording,
which is optional — see design doc §2.6):

| Component | Native Windows path |
|---|---|
| LiveKit | official `livekit_windows_amd64.zip` release + WinSW service wrapper, using this same `livekit/livekit.yaml` |
| PostgreSQL 16 | EnterpriseDB offline installer |
| Redis | [Memurai](https://www.memurai.com/) (native Windows service; no official Redis Windows build exists) |
| Reverse proxy / TLS | [Caddy](https://caddyserver.com/) single binary + service, terminating TLS with the internal CA (see `infra/caddy/`) |
| Egress (recording) | **Not available natively** — Docker/Linux only. Recording is client-side by design (see build plan), so this is a missing enhancement, not a missing requirement. |

Before going live on the real lab subnet:

1. Edit `livekit/livekit.yaml`: set `node_ip` to the server's real LAN IP,
   and regenerate the `keys` secret (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
2. Generate an internal CA and a cert for `labserver.lab.local` (see
   `infra/caddy/README.md`, once written in Phase 0 hardening) — `getUserMedia`/
   `getDisplayMedia` require a secure context, so this is not optional.
3. Confirm both lab switches and the server NIC are gigabit with a
   dedicated 1G inter-switch uplink (design doc §2.4) — broadcast to 40
   students puts real load on that link.
4. Vendor every installer used here into `infra/offline/vendor/` before
   going on-site — there is no internet at ACTC.
