<#
.SYNOPSIS
  Downloads every third-party installer this deployment needs into
  infra/offline/vendor/, for carrying onto the air-gapped lab network on
  removable media (see this directory's README.md).

.NOTES
  Run on a CONNECTED machine, never on-site. NOT executed as part of the
  Phase 5 build/verification pass that wrote this script - it downloads
  several gigabytes of real third-party binaries, which is exactly the
  kind of unprompted, heavy, outward-facing action this project holds off
  on doing without being asked (the same posture services/lab-agent-svc's
  elevated install steps take, for the same reason). Every URL below was
  verified live against each project's real GitHub Releases API / official
  download endpoint while writing this script (2026-09) - re-verify before
  relying on it for an actual deployment, since released versions and
  download URLs do change over time.
#>

$ErrorActionPreference = 'Stop'
$vendorDir = Join-Path $PSScriptRoot 'vendor'
New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null

function Get-LatestGitHubAsset {
  param([string]$Repo, [string]$AssetPattern)
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'lab-portal-offline-fetch' }
  $asset = $release.assets | Where-Object { $_.name -match $AssetPattern } | Select-Object -First 1
  if (-not $asset) { throw "No asset matching '$AssetPattern' found in $Repo latest release ($($release.tag_name))" }
  return $asset
}

function Save-File {
  param([string]$Url, [string]$OutFile)
  Write-Host "Downloading $Url -> $OutFile"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile
  $hash = (Get-FileHash -Path $OutFile -Algorithm SHA256).Hash
  Write-Host "  SHA256: $hash  (verify against the vendor's own published checksum before trusting this file)"
}

Write-Host "== LiveKit (Windows amd64) =="
$livekit = Get-LatestGitHubAsset -Repo 'livekit/livekit' -AssetPattern 'windows_amd64\.zip$'
Save-File -Url $livekit.browser_download_url -OutFile (Join-Path $vendorDir $livekit.name)

Write-Host "== Piper TTS (Windows amd64) =="
$piper = Get-LatestGitHubAsset -Repo 'rhasspy/piper' -AssetPattern 'windows_amd64\.zip$'
Save-File -Url $piper.browser_download_url -OutFile (Join-Path $vendorDir $piper.name)

Write-Host "== eSpeak-NG (Windows MSI) =="
$espeak = Get-LatestGitHubAsset -Repo 'espeak-ng/espeak-ng' -AssetPattern '\.msi$'
Save-File -Url $espeak.browser_download_url -OutFile (Join-Path $vendorDir $espeak.name)

Write-Host "== Caddy (Windows amd64) =="
Save-File -Url 'https://caddyserver.com/api/download?os=windows&arch=amd64' -OutFile (Join-Path $vendorDir 'caddy_windows_amd64.exe')

Write-Host "== Node.js LTS (Windows x64 MSI) =="
$nodeIndex = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
$nodeLts = $nodeIndex | Where-Object { $_.lts } | Select-Object -First 1
$nodeUrl = "https://nodejs.org/dist/$($nodeLts.version)/node-$($nodeLts.version)-x64.msi"
Save-File -Url $nodeUrl -OutFile (Join-Path $vendorDir "node-$($nodeLts.version)-x64.msi")

Write-Host ""
Write-Host "== Manual downloads (no stable direct-download URL - vendor gates these behind a form/click-through) =="
Write-Host "  PostgreSQL 16 (EnterpriseDB):  https://www.enterprisedb.com/download-postgresql-binaries"
Write-Host "  Memurai (Redis-compatible):    https://www.memurai.com/get-memurai"
Write-Host "  At least one Piper voice (e.g. en_GB-alba-medium): https://github.com/rhasspy/piper/blob/master/VOICES.md"
Write-Host "Save each into $vendorDir by hand once downloaded."

Write-Host ""
Write-Host "== Live translation weights (SeamlessStreaming, ~12GB) - ONLY if the lab server has an NVIDIA GPU =="
Write-Host "  Not fetched here: the checkpoints are gated behind Hugging Face model terms, so they need an"
Write-Host "  accepted license and an HF_TOKEN, and they only load inside the built translator image."
Write-Host "  Accept the terms at https://huggingface.co/facebook/seamless-streaming then run, on a connected machine:"
Write-Host "    docker compose --profile translation build translator"
Write-Host "    docker run --rm -e HF_TOKEN=hf_xxx -v `"`$PWD/models:/models`" ``"
Write-Host "      -v `"`$PWD/services/translator/scripts:/scripts:ro`" lab-portal/translator:latest ``"
Write-Host "      python /scripts/fetch_models.py --out /models"
Write-Host "  Then copy .\models into the translator-models volume on-site."
Write-Host "  Full procedure: services/translator/README.md. A server without a GPU needs none of this -"
Write-Host "  leaving TRANSLATOR_URL empty hides the feature entirely."

Write-Host ""
Write-Host "Done. See infra/offline/README.md's packaging checklist for what happens next."
