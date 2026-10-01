<#
.SYNOPSIS
  Points the whole Docker stack at a new LAN IP in one step.

.DESCRIPTION
  HOST_IP (in .env) feeds two things that go stale if you only hand-edit
  .env: LiveKit's advertised node_ip (fixed by recreating containers,
  which `docker compose up -d` already does when .env changes) and the
  nginx self-signed TLS cert's SAN (which lives in a named volume and is
  only ever generated once — editing .env alone does NOT regenerate it).
  This script does both, and warns if the IP you gave it (or the one it
  auto-detects) belongs to a VMware/Hyper-V/WSL virtual adapter instead of
  a real LAN-facing one — that mistake is why this script exists.

.PARAMETER Ip
  The server's real LAN IP, reachable from the station PCs. Omit to
  auto-detect (picks the first non-virtual, non-link-local IPv4 address
  and prints which adapter it came from so you can override it with -Ip
  if it picked the wrong one).

.EXAMPLE
  .\set-host-ip.ps1 -Ip 192.168.29.60
.EXAMPLE
  .\set-host-ip.ps1
#>
param(
  [string]$Ip,
  [string]$EnvFile = (Join-Path $PSScriptRoot '.env')
)

$ErrorActionPreference = 'Stop'
$virtualAdapterPattern = 'VMware|VirtualBox|Hyper-V|vEthernet|Virtual|WSL|Loopback'

if (-not $Ip) {
  $candidate = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.PrefixOrigin -in @('Dhcp', 'Manual') -and
      $_.InterfaceAlias -notmatch $virtualAdapterPattern -and
      $_.IPAddress -notlike '169.254.*' -and
      $_.IPAddress -ne '127.0.0.1'
    } | Select-Object -First 1
  if (-not $candidate) { throw 'Could not auto-detect a LAN IP - pass -Ip explicitly (run Get-NetIPAddress to list your adapters).' }
  $Ip = $candidate.IPAddress
  Write-Host "Auto-detected LAN IP: $Ip (adapter: $($candidate.InterfaceAlias))"
} else {
  $match = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Ip -ErrorAction SilentlyContinue
  if ($match -and ($match.InterfaceAlias -match $virtualAdapterPattern)) {
    Write-Warning "$Ip is on adapter '$($match.InterfaceAlias)' - that looks like a VMware/Hyper-V/WSL virtual network, NOT reachable from other PCs on your LAN. Run Get-NetIPAddress and use your real WiFi/Ethernet IP instead."
  }
}

if (-not (Test-Path $EnvFile)) { throw "$EnvFile not found - copy .env.docker.example to .env first." }

$content = Get-Content $EnvFile -Raw
if ($content -match '(?m)^HOST_IP=') {
  $content = $content -replace '(?m)^HOST_IP=[^\r\n]*', "HOST_IP=$Ip"
} else {
  $content = $content.TrimEnd() + "`r`nHOST_IP=$Ip`r`n"
}
Set-Content -Path $EnvFile -Value $content -NoNewline
Write-Host "Updated $EnvFile -> HOST_IP=$Ip"

Push-Location (Split-Path $EnvFile)
try {
  Write-Host 'Recreating containers with the new HOST_IP (picks up LiveKit''s node_ip automatically)...'
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { throw "docker compose up -d failed (exit $LASTEXITCODE)" }

  # Belt-and-suspenders: 40-runtime-config.sh now self-heals the cert on a
  # HOST_IP/TLS_CN mismatch too, but forcing it here guarantees it even if
  # that detection ever misses an edge case.
  Write-Host 'Refreshing the self-signed TLS cert for the new address...'
  docker compose exec web sh -c 'rm -f /etc/nginx/certs/tls.crt /etc/nginx/certs/tls.key /etc/nginx/certs/tls.generated-san' | Out-Null
  docker compose restart web | Out-Null
}
finally {
  Pop-Location
}

Write-Host ''
Write-Host "Done. Point every station's LabPortal at: http://$Ip" -ForegroundColor Green
Write-Host 'Reminder: Windows Firewall on this PC must allow inbound TCP 80/443, TCP 7881, and UDP 7882-7892 from the LAN.' -ForegroundColor Yellow
