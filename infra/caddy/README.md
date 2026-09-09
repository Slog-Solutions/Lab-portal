# Caddy (internal CA + TLS termination)

Phase 5 — this directory was referenced by the root `README.md`/`infra/README.md`
since Phase 0 ("generate an internal CA and a cert... see `infra/caddy/README.md`,
once written in Phase 0 hardening") but stayed empty until now.

## What `tls internal` actually is

`Caddyfile` uses Caddy's own built-in local CA (`tls internal`) rather than
a separately-generated OpenSSL/PowerShell certificate — this **is** the
"internal CA" the build plan calls for, not a placeholder for one. On
first run, Caddy:

1. Generates a root CA key/cert once, stored under its data directory
   (`pki/authorities/local/root.crt` — the Windows service default is
   `C:\Windows\System32\config\systemprofile\AppData\Local\Caddy\`, since
   the service runs as LocalSystem; running Caddy interactively instead
   uses the logged-in user's own `%AppData%\Caddy\`).
2. Mints and auto-renews leaf certificates for every hostname in the
   Caddyfile, signed by that root — `labserver.lab.local` (the Nest
   server) and `livekit.labserver.lab.local` (LiveKit's WS signaling,
   reverse-proxied separately from the RTC media ports, which are UDP and
   never go through an HTTP(S) proxy).
3. Serves real HTTPS immediately, satisfying the build plan's
   `getUserMedia`/`getDisplayMedia` secure-context requirement.

That `root.crt` is exactly the file
`services/lab-agent-svc/src/root-ca.ts` imports into every station's
Trusted Root store (`lab-agent-install --root-ca <path to root.crt>`) —
once that runs, every station trusts both subdomains with no per-station
certificate to manage.

## Verified this pass, for real

Ran the actual downloaded Caddy v2.11.4 binary against this exact
`Caddyfile` (real Nest server + real LiveKit already running on this dev
box) and confirmed, with full certificate verification against Caddy's
own generated root (no `-k`/insecure flag):

- `https://labserver.lab.local/` → 200, the real built SPA
- `https://labserver.lab.local/api/control/status-board` → 401 (proves
  the `/api` path reverse-proxies correctly; 401 is the correct
  unauthenticated response, not a proxy failure)
- `https://livekit.labserver.lab.local/` → 200, proxied to LiveKit's
  `:7880`

(Windows curl's schannel backend refuses to verify a CA with no CRL
distribution point by default — expected for a local-only CA with no
revocation infrastructure — so verification used `--ssl-no-revoke`, not
`-k`; the certificate chain itself was genuinely validated.)

## Not done this pass

- Caddy is not registered as a Windows service here (`lab-agent-svc`
  registers itself as one via `node-windows`; wiring Caddy the same way,
  or via NSSM/WinSW, is a small follow-up, not attempted this pass).
- `node_ip`/`bind_addresses` in `infra/livekit/livekit.yaml` and this
  Caddyfile's hostnames still need editing to the real lab server's LAN
  IP/hostname before an actual on-site deployment — this was verified on
  `127.0.0.1`, which is stated plainly, not silently generalized.
