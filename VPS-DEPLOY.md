# Deploying to the VPS (72.60.204.211)

This is a copy-paste script for your SSH session on `srv1050518`, not
something run from here — I have no remote access to that machine. Every
command below was chosen to avoid the 13 services already on it
(`pm2 list` / `docker ps`: ports 8081, 8020, 5433, 1234, 5000, 8017, 5016,
8016, 9090, 9100 are all taken).

## Ports this stack uses

| Port | Purpose | Collision checked against your `docker ps`? |
|---|---|---|
| **8057/tcp** | HTTP — the Electron app's `serverUrl`, baked into the installer | Free |
| **8058/tcp** | HTTPS — teachers/admins in a browser (mic/screen-share need a secure context) | Free |
| 7881/tcp | LiveKit media (TCP fallback) | Free |
| 7882-7892/udp | LiveKit media (the actual audio/video) | Free |

Postgres and Redis are **not** published to the host — no conflict with
your existing `5433` Postgres, and nothing to check there.

## 1. Get the code onto the VPS

```bash
cd /opt   # or wherever you keep deployed apps
git clone https://github.com/Slog-Solutions/Lab-portal.git lab-management
cd lab-management
git checkout online-prod
```

(If it's already cloned: `cd /opt/lab-management && git fetch && git checkout online-prod && git pull`.)

## 2. Create the VPS `.env`

```bash
cp .env.docker.example .env
```

Generate three fresh secrets — **do not reuse** the ones from your dev
`.env`, this is a different, internet-facing machine:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Edit `.env`:
```ini
HOST_IP=72.60.204.211
TLS_CN=lab.local

POSTGRES_PASSWORD=<first generated value>
JWT_SECRET=<second generated value>
LIVEKIT_API_KEY=labkey
LIVEKIT_API_SECRET=<third generated value>

HTTP_PORT=8057
HTTPS_PORT=8058

MAX_UPLOAD_MB=500
RUN_SEED=true
```

`RUN_SEED=true` only for this first boot (creates the demo admin/teacher/student
accounts) — set it back to `false` right after, same as the local setup.

**Optional — live class translation (Azure, no GPU needed):** if you want
this on the VPS too, also set:
```ini
AZURE_SPEECH_KEY=<your key>
AZURE_SPEECH_REGION=centralindia
TRANSLATOR_URL=http://translator-azure:8080
```
and bring it up with `--profile translation-azure` in the command below.
Skip this entirely if you just want the core app running first.

## 3. Confirm nothing else already holds these ports

```bash
ss -tlnp | grep -E ':(8057|8058|7881)\b' || echo "all clear"
```
`docker ps` doesn't show host-level (non-Docker) services — this catches
those too, e.g. a system nginx. Empty output is good.

## 4. Bring it up

```bash
docker compose up -d --build
# with translation too:
# docker compose --profile translation-azure up -d --build
```

First run builds the server and web images — a few minutes. Then:
```bash
docker compose ps
```
All of `postgres`, `redis`, `livekit`, `server`, `web` should show `Up (healthy)`.

## 5. Open the firewall

```bash
ufw allow 8057/tcp
ufw allow 8058/tcp
ufw allow 7881/tcp
ufw allow 7882:7892/udp
ufw status
```

**If your VPS provider has its own cloud firewall / security group panel
(separate from `ufw`), these ports need opening there too** — I can't see
or check that from here. `ufw` alone is not sufficient if the provider
filters upstream of the VM.

One thing worth knowing: Docker manipulates `iptables` directly and is a
well-known case where `ufw deny` rules don't actually block
Docker-published ports. Practically this doesn't hurt you here (you *want*
these four reachable), but it does mean any **other** port one of your 13
existing containers publishes is also reachable from the internet
regardless of what `ufw status` claims — worth knowing even though it's
not something today's changes touch.

## 6. Verify

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8057/healthz
```
Expect `200`. Then from your own PC (not the VPS):
```
http://72.60.204.211:8057/     <- should show the login page (or redirect to :8058)
https://72.60.204.211:8058/    <- same, self-signed cert, click through
```

If a browser can't reach either, it's almost certainly the provider's
cloud firewall from step 5, not Compose.

## 6b. Dictionary (one-time copy)

The student dictionary needs `dictionary.db` (49 MB). It is gitignored, so
`git clone` never brings it and the server reports "Dictionary unavailable"
until it is copied onto the persistent data volume once. It survives
rebuilds after that.

From the Windows PC that has the repo (PowerShell):
```powershell
scp "D:\Lab Management\apps\server\LabData\dictionary\dictionary.db" "D:\Lab Management\apps\server\LabData\dictionary\dictionary.manifest.json" root@72.60.204.211:/tmp/
```

On the VPS:
```bash
cd ~/Lab-Management/Lab-portal
docker compose exec server mkdir -p /data/LabData/dictionary
docker compose cp /tmp/dictionary.db server:/data/LabData/dictionary/dictionary.db
docker compose cp /tmp/dictionary.manifest.json server:/data/LabData/dictionary/dictionary.manifest.json
docker compose restart server
docker compose logs server | grep -i dictionary
```
Expect `dictionary.db loaded from /data/LabData/dictionary/dictionary.db`.

## 7. The Electron side — already done, nothing to configure

`apps/desktop/build/server-config.json` is baked with
`http://72.60.204.211:8057` and the installer at
`apps/desktop/release/LabPortal Setup 0.1.0.exe` was rebuilt with it.
**A fresh install on any PC connects automatically — no `set-server-ip.ps1`,
no editing `config.json`, nothing.** That script still exists for
re-pointing an already-installed station somewhere else later.

## Rollback

If anything looks wrong before you trust it with real classes:
```bash
docker compose down        # stops and removes these 5 containers only
```
This never touches your other 13 services — different compose project,
different network, no shared containers or volumes.

## What I verified locally before writing this

- `docker compose config` resolves `EXTERNAL_HTTPS_PORT` correctly from `HTTPS_PORT`.
- With `HTTP_PORT=8057 HTTPS_PORT=8058` set, the HTTP->HTTPS redirect on
  this exact dev machine produced `location: https://<ip>:8058/` — the
  redirect previously hardcoded `:443` and would have failed silently on
  a remapped port; that bug is fixed as part of this.
- The installer's baked `server-config.json` round-trips through
  `resolveRuntimeConfig()` correctly (same mechanism verified earlier
  for the LAN deployment, just with a different URL baked in).

## What I could not verify (no access to the VPS)

- That `72.60.204.211` is bound directly to the VPS's own interface
  (true for most providers, but confirm with `ip addr` if LiveKit media
  behaves oddly — the same class of bug as the VMware-adapter issue
  from the LAN deployment, just impossible for me to check remotely).
- The provider's cloud firewall / security group settings.
- That ports 8057/8058/7881/7882-7892 are actually free on the live
  machine — `docker ps` only shows Docker-published ports, not
  host-level services. Step 3 above checks this for you.
