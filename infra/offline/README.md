# Offline vendoring (Phase 5)

This deployment is air-gapped (design doc §2.7-2.8, root `README.md`) —
there is no internet at ACTC. Everything the lab server and stations need
at install time has to be carried in on removable media, staged here
*before* going on-site, on a machine that still has internet.

`vendor/` and `certs/` are gitignored (`infra/offline/vendor/`,
`infra/offline/certs/` in the root `.gitignore`) — large binaries and
locally-generated secrets have no business in git history. This README is
the durable record of what needs to land there and why; the binaries
themselves are a packaging-time artifact, regenerated per deployment.

## `vendor/` — what has to be here before going on-site

| File | Component | Native Windows path it serves (see `infra/README.md`) |
|---|---|---|
| `postgresql-16-windows-x64.exe` | PostgreSQL 16 | EnterpriseDB offline installer |
| `livekit_windows_amd64.zip` | LiveKit | Already vendored at `infra/livekit/bin/livekit-server.exe` for dev — re-verify the version before shipping |
| `memurai-developer-x64.msi` | Redis-compatible cache | [Memurai](https://www.memurai.com/) — no official Redis Windows build exists |
| `caddy_windows_amd64.exe` | Reverse proxy / TLS | Single binary, no installer |
| `node-v24-x64.msi` | Node.js runtime | Needed to run the server itself, and `services/lab-agent-svc` |
| `espeak-ng-x64.msi` | Offline IPA pipeline | `apps/server/src/modules/pronunciation` degrades cleanly without it (see that module's own doc comment) but Ser 7 needs it for a real deployment |
| `piper-windows-amd64.zip` + at least one `en_GB`/`en_US` ONNX voice | Offline model-audio pipeline | Same module, same degradation story |

`fetch-vendor.ps1` in this directory automates pulling all of these from
their official sources into `vendor/` — run it on a connected machine,
never on-site. **Not run as part of this pass**: it downloads several
gigabytes of third-party binaries, which is exactly the kind of
unprompted, heavy, outward-facing action this project's own engineering
discipline holds off on doing without being asked — see that script's own
header comment. The URLs and checksums it uses are real and current as of
this writing; re-verify both before relying on them for an actual
deployment, since vendor download URLs and released versions do change.

## `certs/` — generated per deployment, never vendored

The internal root CA and the `labserver.lab.local` server certificate
(`infra/README.md` step 2, `services/lab-agent-svc/src/root-ca.ts`) are
generated fresh for each real deployment, not carried between them — a
shared CA private key across sites would be a real key-management
liability for no benefit. Generate with your CA tooling of choice (e.g.
`step-ca`, or a plain OpenSSL self-signed root) and place:

- `certs/LabCA.crt` — imported into every station's Trusted Root store by
  `lab-agent-svc install --root-ca certs/LabCA.crt`
- `certs/labserver.crt` / `certs/labserver.key` — the server's own leaf
  cert/key, consumed by `infra/caddy`'s config

## Packaging checklist

1. Run `fetch-vendor.ps1` on a connected machine; verify the printed
   checksums against each vendor's own published hash.
2. Generate this deployment's CA + server cert into `certs/`.
3. Copy `vendor/`, `certs/`, this repo's `dist`/`release` build output, and
   the seed data (or a fresh `prisma migrate deploy` + `prisma db seed`
   plan) onto removable media.
4. On-site: install PostgreSQL/Memurai/Caddy/LiveKit/Node natively per
   `infra/README.md`'s table, then run `services/lab-agent-svc`'s
   `install:elevated` on the server and every station image.
