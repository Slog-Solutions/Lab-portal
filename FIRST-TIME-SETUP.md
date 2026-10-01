# First-Time Setup

How to stand up the Digital Language Lab from scratch on a new set of machines:
one **server PC** running the Docker stack, and any number of **station PCs**
running the LabPortal desktop app.

Follow Part 1 once, Part 2 once, then Part 3 on every station.

---

## What you need

| | |
|---|---|
| **Server PC** | Windows 10/11, Docker Desktop installed, wired or Wi-Fi on the same network as the stations |
| **Station PCs** | Windows 10/11, same network as the server, administrator rights to install |
| **Build PC** (Part 2 only) | Node.js ≥ 24.14.0 and npm ≥ 11 — can be the same machine as the server |

All traffic stays on your LAN. No internet is required once the images are built.

---

## Part 1 — Server PC

### 1.1 Install Docker Desktop

Download from docker.com, install, reboot, and confirm it's running:

```powershell
docker --version
docker compose version
```

### 1.2 Get the code

Copy the project folder to the server PC (git clone, USB, or network share). All
commands below run from the project root — the folder containing
`docker-compose.yml`.

```powershell
cd "D:\Lab Management"
```

### 1.3 Find the server's real LAN IP

**This is the step that most often goes wrong.** You need the IP of the adapter
that actually connects to your network — *not* a VMware, VirtualBox, Hyper-V or
WSL virtual adapter. Those look like normal IPs but are unreachable from any
other PC.

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Select-Object IPAddress, InterfaceAlias, PrefixOrigin
```

Pick the address whose `InterfaceAlias` is your real **WiFi** or **Ethernet**
adapter. Ignore anything saying VMware, vEthernet, Hyper-V, WSL, or starting
with `169.254.`

Example — here `192.168.1.22` is correct and `192.168.131.1` is a trap:

```
IPAddress       InterfaceAlias                   PrefixOrigin
192.168.131.1   VMware Network Adapter VMnet1    Manual      <- WRONG (virtual)
192.168.230.1   VMware Network Adapter VMnet8    Manual      <- WRONG (virtual)
192.168.1.22    WiFi                             Dhcp        <- CORRECT
```

> **Strongly recommended:** give the server a fixed address — either a static IP
> on the adapter, or a DHCP reservation in your router keyed to its MAC. If the
> server's IP changes, every station stops connecting until you redo Part 1.8
> and re-run Part 3.2 on each station.

### 1.4 Create the `.env` file

```powershell
Copy-Item .env.docker.example .env
notepad .env
```

Fill it in:

```ini
# The IP you identified in 1.3 — stations and LiveKit media both use this.
HOST_IP=192.168.1.22
TLS_CN=lab.local

# Generate each of these separately (see command below). Minimum 32 characters.
POSTGRES_PASSWORD=<paste a generated value>
JWT_SECRET=<paste a generated value>
LIVEKIT_API_KEY=labkey
LIVEKIT_API_SECRET=<paste a generated value>

HTTP_PORT=80
HTTPS_PORT=443
MAX_UPLOAD_MB=500

# Leave false for now — Part 1.6 turns it on once, deliberately.
RUN_SEED=false
```

Generate each secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 1.5 Start the stack

```powershell
docker compose up -d --build
```

First run takes several minutes (it builds the API and web images). Database
migrations apply automatically on every start.

Check all five services are healthy:

```powershell
docker compose ps
```

You should see `postgres`, `redis`, `livekit`, `server` and `web` all `Up`.

### 1.6 Create the starting accounts (first boot only)

This creates the admin, teachers and 40 student accounts:

```powershell
docker compose exec server npx tsx prisma/seed.ts
```

Optionally also load the CEFR A1/A2/B1 course content:

```powershell
docker compose exec server npx tsx prisma/seed-cefr-content.ts
```

Default passwords are listed in Part 4. **Change them before real use.**

### 1.7 Open the firewall

Stations need to reach these ports on the server. Run **as Administrator**:

```powershell
New-NetFirewallRule -DisplayName "LabPortal HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80,443   -Action Allow
New-NetFirewallRule -DisplayName "LabPortal media TCP" -Direction Inbound -Protocol TCP -LocalPort 7881 -Action Allow
New-NetFirewallRule -DisplayName "LabPortal media UDP" -Direction Inbound -Protocol UDP -LocalPort 7882-7892 -Action Allow
```

Ports 80/443 carry the API, sign-in and LiveKit signalling. 7881/TCP and
7882-7892/UDP carry the actual audio and video — without them, students connect
but hear nothing.

### 1.8 Verify the server

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://192.168.1.22/healthz
```

Expect `200`. Then open `https://192.168.1.22/` in a browser — this is the
teacher/admin console. You'll get a certificate warning (the cert is self-signed
by default); click through it.

Teachers must use **https**. Browsers only expose the microphone and screen
sharing on a "secure context", and plain HTTP on a LAN IP is not one — those
features aren't degraded there, they're entirely absent. Visiting `http://<ip>/`
now redirects to HTTPS automatically so nobody lands on the broken version by
accident. (`http://localhost/` on the server itself is left alone: browsers
already count localhost as secure, so that one page needs no certificate.)

To get rid of the warning on a teacher's PC, import the server's certificate
once, as Administrator:

```powershell
docker compose cp web:/etc/nginx/certs/tls.crt .\lab-ca.crt      # on the server
Import-Certificate -FilePath .\lab-ca.crt -CertStoreLocation Cert:\LocalMachine\Root
```

> **If you ever change `HOST_IP` later**, don't just edit `.env` — the TLS
> certificate and LiveKit's advertised media address both need refreshing. Run
> this instead, from the project root:
> ```powershell
> .\set-host-ip.ps1 -Ip <new-ip>
> ```
> It updates `.env`, recreates the affected containers and regenerates the
> certificate in one step.

---

## Part 2 — Build the station installer

Only needed once, and only if you don't already have
`LabPortal Setup 0.1.0.exe`. Run on a machine with Node.js ≥ 24.14.0.

```powershell
cd "D:\Lab Management"
npm install
npm run dist:win --workspace=apps/desktop
```

The installer lands at:

```
apps\desktop\release\LabPortal Setup 0.1.0.exe
```

Copy that file to each station (USB or network share).

> If the build fails with `spawn UNKNOWN` on the NSIS step, simply run the
> command again — the first run occasionally fails while populating its cache.

> **Check the repo afterwards.** electron-builder's workspace handling has been
> observed deleting the root `package.json` during packaging. It's tracked in
> git, so check and restore it before committing anything:
> ```powershell
> git status --short        # look for "D package.json"
> git restore package.json  # if it was removed
> ```

---

## Part 3 — Each station PC

### 3.1 Install

Run `LabPortal Setup 0.1.0.exe` and accept the administrator prompt. It installs
to `C:\Program Files\LabPortal\` and sets the app to start automatically at login.

### 3.2 Point the station at the server

This is the **only** per-station configuration. In PowerShell:

```powershell
& "C:\Program Files\LabPortal\resources\set-server-ip.ps1" -Ip 192.168.1.22
```

Replace `192.168.1.22` with your server's IP from Part 1.3.

If PowerShell blocks the script, use:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Program Files\LabPortal\resources\set-server-ip.ps1" -Ip 192.168.1.22
```

The script writes `%AppData%\LabPortal\config.json` and restarts LabPortal if
it's already running. You can also edit that file by hand:

```json
{
  "serverUrl": "http://192.168.1.22"
}
```

Use plain `http://` here. The desktop app does not need HTTPS, and using it would
require installing the server's certificate on every station first. Only
`serverUrl` is needed — the LiveKit address is derived from it automatically.

### 3.3 Launch and check

Start LabPortal from the Start Menu. You should see the **Student sign in** screen
with an enabled **Sign in** button.

- The button reading *"Connecting to the lab server…"* for the first 1-2 seconds
  is normal — it enables once the station registers.
- The header reading **"Registering…"** is also normal. That's the seat label, and
  a station has no seat until a student signs in with a system number.

### 3.4 Label the machine

Write the system number (1-40) physically on the monitor. Students type it at
sign-in, and it must be unique per station — two machines using the same number
will be rejected with "already in use by another computer".

---

## Part 4 — Signing in

Seeded accounts and their default passwords:

| Service number | Password | Role |
|---|---|---|
| `ADMIN-001` | `Admin@12345` | Admin |
| `TCH-001`, `TCH-002`, `TCH-003` | `Teacher@12345` | Teacher |
| `STU-001` … `STU-040` | `Student@12345` | Student |

**Students** sign in on the LabPortal desktop app with their service number,
password, and the system number written on the screen.

**Teachers and admins** sign in through a browser at `https://<server-ip>/`.

Rotate these passwords before putting the lab into real use. New users are created
from the admin console — only accounts that exist in the database can sign in.

---

## Part 5 — Verification commands

Run on the server PC, from the project root.

```powershell
# Are all containers up?
docker compose ps

# Which stations have connected? lastSeenAt refreshes every 5 seconds while a station runs.
docker compose --% exec postgres psql -U labportal -d labportal -c "SELECT hostname, \"seatNo\", \"lastSeenAt\" FROM \"Station\";"

# Which accounts exist?
docker compose --% exec postgres psql -U labportal -d labportal -c "SELECT \"serviceNumber\", \"fullName\", role FROM \"User\" ORDER BY role, \"serviceNumber\";"

# Watch server activity live (Ctrl+C to stop)
docker compose logs -f server

# Confirm the TLS certificate matches the current IP
docker compose exec web sh -c "openssl x509 -in /etc/nginx/certs/tls.crt -noout -text | grep -A2 'Subject Alternative Name'"
```

> The `--%` in the psql commands is required in PowerShell. Without it,
> PowerShell strips the quotes around the capitalised column names and the query
> fails with `relation "station" does not exist`.

---

## Part 6 — Troubleshooting

### Station shows the sign-in screen but never connects

Check what address it's actually using:

```powershell
Get-Content "$env:APPDATA\LabPortal\config.json"
```

If `serverUrl` says `http://CHANGE-ME-TO-SERVER-IP`, Part 3.2 was never run on
this machine. Run it.

Then confirm the station can reach the server at all:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://192.168.1.22/healthz
```

No response means a network or firewall problem, not an app problem — recheck
Part 1.3 (right IP?) and Part 1.7 (firewall open?).

### Everything worked yesterday, nothing connects today

The server's IP almost certainly changed (common with DHCP over Wi-Fi). Confirm
with Part 1.3, then on the server:

```powershell
.\set-host-ip.ps1 -Ip <new-ip>
```

and re-run Part 3.2 on each station. Assigning the server a static IP or DHCP
reservation prevents this permanently.

### Students connect but there's no audio or video

LiveKit media ports are blocked, or `HOST_IP` points at a virtual adapter. Recheck
Part 1.3 and Part 1.7. Signalling (sign-in, locking, commands) goes over port 80
and will keep working even when media is broken, so "it connects but nobody can
hear anything" is almost always this.

### Screen share or microphone missing for a teacher on another PC

Almost always because that PC opened the console over plain `http://<ip>/`.
Browsers only expose `getDisplayMedia`/`getUserMedia` on a secure context, so on
plain HTTP the buttons do nothing — it works on the server itself only because
`localhost` is special-cased as secure. Use `https://<ip>/` (the redirect in
Part 1.8 should take you there automatically) and import the certificate as
shown there. To confirm what a given machine sees, open DevTools on the console
page and run `window.isSecureContext` — it must be `true`.

### "System number N is already in use by another computer"

Two stations are configured with the same number. Each needs its own value from
1-40 (Part 3.4).

### Browser warns the certificate isn't trusted

Expected — the certificate is self-signed. Click through, or replace it by placing
your own `tls.crt`/`tls.key` into the `nginx-certs` Docker volume. The desktop
stations are unaffected; they use plain HTTP.

### Auto-update errors in the logs

`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND` just means no update has been published to
`/updates/win/` on the server yet. Harmless.

---

## Quick reference

| Thing | Where |
|---|---|
| Server config | `.env` in the project root — `HOST_IP` is the key setting |
| Change server IP | `.\set-host-ip.ps1 -Ip <ip>` from the project root |
| Station config | `%AppData%\LabPortal\config.json` |
| Point a station at the server | `C:\Program Files\LabPortal\resources\set-server-ip.ps1 -Ip <ip>` |
| Teacher/admin console | `https://<server-ip>/` |
| Installer output | `apps\desktop\release\LabPortal Setup 0.1.0.exe` |
| Ports to open | TCP 80, 443, 7881 · UDP 7882-7892 |
