<#
.SYNOPSIS
  Points this installed LabPortal station at the lab server, and restarts
  LabPortal so it takes effect immediately.

.DESCRIPTION
  LabPortal reads its server address from config.json in its per-user data
  folder (%AppData%\LabPortal\config.json) - this script is the simple way
  to set that without hand-editing JSON. Run it once per station, after
  installing LabPortal.

.PARAMETER Ip
  The lab server's LAN IP (e.g. 192.168.29.60) - the address
  set-host-ip.ps1 printed when run on the server, or whatever HOST_IP is
  in that machine's .env. A full http(s):// URL also works if you need a
  non-default port.

.EXAMPLE
  .\set-server-ip.ps1 -Ip 192.168.29.60
#>
param(
  [Parameter(Mandatory = $true)][string]$Ip
)

$ErrorActionPreference = 'Stop'
$configDir = Join-Path $env:APPDATA 'LabPortal'
$configPath = Join-Path $configDir 'config.json'
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

$serverUrl = if ($Ip -match '^https?://') { $Ip } else { "http://$Ip" }
$config = [ordered]@{
  _comment  = 'Edited by set-server-ip.ps1. livekitUrl is derived from serverUrl automatically - no need to set it separately.'
  serverUrl = $serverUrl
}
$config | ConvertTo-Json | Set-Content -Path $configPath
Write-Host "Set $configPath -> serverUrl = $serverUrl"

$proc = Get-Process -Name 'LabPortal' -ErrorAction SilentlyContinue
if ($proc) {
  Write-Host 'Restarting LabPortal so it picks up the new address...'
  $exePath = ($proc | Select-Object -First 1).Path
  $proc | Stop-Process -Force
  Start-Sleep -Seconds 1
  Start-Process -FilePath $exePath
  Write-Host 'Done.'
} else {
  Write-Host 'LabPortal is not currently running - just launch it normally and it will use this address.'
}
