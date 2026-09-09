# lab-agent-svc

Elevated Windows service. Two kinds of things live here — install-time
actions (run once, elevated, machine-mutating) and a long-running IPC
surface (the actual reason this is a service and not a script):

## Install-time actions (`install.ts`)

1. **Input-lock GPO mitigation** (`src/gpo-policies.ts`) — Ctrl+Alt+Del
   cannot be intercepted by any user-mode process (that is the point of a
   Secure Attention Sequence), so the accepted mitigation
   (`docs/compliance-matrix.md`, tracked since Phase 1) is removing every
   option Windows offers *after* it's pressed: Task Manager, Lock, Sign
   out, Change password. Reasserted every 5 minutes by the running
   service (`src/daemon.ts`), not just written once at install, so a
   student session reverting one doesn't silently undo the mitigation
   until the next full re-image.
2. **Root CA import** (`src/root-ca.ts`) — trusts the lab's internal CA
   (`infra/caddy` — Caddy's own `tls internal` local CA as of Phase 5) so
   stations don't train 40 students to click through TLS warnings.
3. **Firewall scoping** (`src/firewall.ts`) — restricts the server's
   inbound rule to the lab subnet.

Plus the service registration itself (`src/service.ts`, via
`node-windows` — picked for the same "no C++ toolchain needed" reason
Phase 1 picked `@nut-tree-fork/nut-js` over the still-blocked native
input-lock hook addon).

## The running service's IPC surface (`agent-server.ts`) — Phase 5

The design doc's "single most important security control": a real Win32
named pipe (`\\.\pipe\labportal-agent`, `@lab/shared/agent`'s contract)
speaking a **closed verb set** — `shutdown`, `restart`, `resolve-launch`,
`apply-update` — with no "run arbitrary command" verb, by construction.
`apps/desktop`'s `agent-client.ts` is the normal-integrity caller; every
call falls back to the pre-Phase-5 direct `exec()` path if the agent
isn't installed, so a dev machine keeps working.

**Verified finding, replacing the design doc's own sketch**: the plan
called for authenticating the pipe's caller via
`GetNamedPipeClientProcessId`. Tested directly against a real running
pipe server — Node's `net` module exposes no usable HANDLE for a pipe
connection (`socket._handle.fd` is `-1`; the Win32 call fails with
`ERROR_INVALID_HANDLE`) and nothing else on the internal handle object
exposes one either. True process-identity binding needs a native addon
(blocked, same toolchain gap as the input-lock hooks) or a full Win32
pipe reimplementation over FFI — too large an undertaking for the auth
layer alone. Shipped instead: `token-store.ts`'s rotating capability
token (`%ProgramData%\LabPortal\agent.token`, ACL'd via `icacls` to
SYSTEM/Administrators-write, `Users`-read) — closes the actual
exploitable gap without the process-identity binding the original sketch
wanted. `resolve-launch`'s own allowlist authority lives in
`allowlist.ts` (`%ProgramData%\LabPortal\allowlist.json`) — the agent
resolves a `programId`, it does not spawn the process itself (a
LocalSystem/Session-0 service can't make a GUI program appear in the
student's interactive session without `CreateProcessAsUser`, a separate
undertaking this pass didn't need).

## Status: the pipe protocol is live-verified; install-time actions are not

`agent-server.ts`/`token-store.ts`/`allowlist.ts` were run for real this
pass (a genuine pipe server, real token rotation, real ACL set via
`icacls`, real verb dispatch — bad tokens rejected, unknown programIds
rejected, an `apply-update` path outside the staging dir rejected).
`install.ts`'s own actions remain unrun: every one is a real, elevated,
machine-mutating change (registry policy writes, a Trusted Root store
import, a firewall rule, a Windows service registration) — squarely the
"hard to reverse, outward-facing" category this project's own engineering
discipline keeps off a developer's own box, matching the honesty pattern
every other genuinely-untestable-here gap in this codebase already
follows (native-bridge's blocked input hooks, the unvendored
eSpeak-NG/Piper binaries). `gpo-policies.ts`'s registry *values* are real
and reviewable without executing anything; `install.ts` is what a real
station or server image runs.

## Running it for real

From an elevated (Administrator) PowerShell, on the actual machine being
imaged — never on a dev box:

```powershell
cd services/lab-agent-svc
npm run install:elevated -- --root-ca C:\path\to\LabCA.crt --subnet 10.0.0.0/24
```

To remove: `npm run uninstall:elevated`. Uninstalling does **not** revert
the GPO values or the CA import — see `uninstall.ts`'s doc comment.

## Wiring into the installer

`apps/desktop/build/installer.nsh` documents these steps but does not yet
invoke this package directly — doing so from NSIS means either bundling a
portable Node runtime into the installer or compiling `dist/daemon-entry.cjs`
+ this package's CLI scripts to a standalone `.exe` (e.g. via `pkg`) and
shipping that as an `extraResource`. Tracked as the next concrete step,
not silently skipped.
