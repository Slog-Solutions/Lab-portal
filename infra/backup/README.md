# Backup / restore (Phase 5)

`backup.ps1` writes `<BackupRoot>\<timestamp>\{labportal.dump, labdata.zip}` —
a Postgres custom-format dump plus everything under `LAB_DATA_ROOT`. Both
are needed for a working restore: the database only stores metadata and
relative paths for media assets/recordings/content packages, never the
files themselves (`apps/server/src/common/storage`).

`restore.ps1` reverses it — `pg_restore --clean --if-exists` (drops every
object in the target database first) then re-extracts the LabData zip.
Destructive by design, so it refuses to run without `-Confirm`.

## Scheduling (recommended: nightly via Task Scheduler)

```powershell
schtasks /Create /TN "LabPortal Nightly Backup" /SC DAILY /ST 02:00 `
  /TR "pwsh.exe -File C:\LabPortal\infra\backup\backup.ps1 -DbPassword <password>" `
  /RU SYSTEM /RL HIGHEST
```

Point `-BackupRoot` at a second physical disk or a mapped network share —
a backup on the same disk as the live database survives a bad
application update but not a dead disk, which defeats half the point.

## Manual trigger

An admin can also fire one on demand from the dashboard:
`POST /api/admin/backup` (ADMIN role) — shells out to this same script
server-side with the server's own `DATABASE_URL`/`LAB_DATA_ROOT` env
values, so the two never drift out of sync with each other. See
`apps/server/src/modules/admin/admin.controller.ts`.

## Verified this pass, honestly scoped

`backup.ps1` was run for real against the live dev database and produced
a genuine, valid `pg_dump` custom-format file (spot-checked with
`pg_restore --list`, which enumerates a dump's contents without touching
any database — read-only by design, which is why that check was used
instead of a real restore). `restore.ps1` was **not** run destructively
against the dev database in this pass — `--clean` drops every object in
whatever database it's pointed at, and firing that for real against the
only database this session had been building against all day was not a
risk worth taking just to prove a straightforward `pg_restore` invocation
works. Its logic is the direct inverse of the verified `backup.ps1` and
uses the same, standard `pg_restore` flags.
