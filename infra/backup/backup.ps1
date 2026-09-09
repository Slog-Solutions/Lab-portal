<#
.SYNOPSIS
  Backs up the lab server's database + LabData files to a timestamped
  directory (Phase 5 - "backup/restore" was named in the build plan
  alongside the other Phase 5 hardening items and had nothing built yet).

.DESCRIPTION
  Two artifacts per run, both needed to restore a working install:
    - <timestamp>/labportal.dump  - pg_dump custom format (compressed,
      supports selective pg_restore, unlike a plain .sql script dump)
    - <timestamp>/labdata.zip     - everything under LAB_DATA_ROOT
      (media assets, recordings, content packages) - the DB only stores
      metadata + relative paths, so a DB-only backup is not a working
      backup.

.PARAMETER BackupRoot
  Where timestamped backup folders are written. Point this at a second
  disk or a mapped network share for a real deployment - a backup that
  lives on the same disk as what it backs up survives a bad update but
  not a dead disk.

.EXAMPLE
  # Nightly via Task Scheduler (see this directory's README):
  pwsh -File backup.ps1 -DbPassword $env:LABPORTAL_DB_PASSWORD
#>
param(
  [string]$BackupRoot = 'D:\LabBackups',
  [string]$PgBinDir = 'C:\Program Files\PostgreSQL\16\bin',
  [string]$DbHost = 'localhost',
  [int]$DbPort = 5432,
  [string]$DbName = 'labportal',
  [string]$DbUser = 'labportal',
  [Parameter(Mandatory = $true)][string]$DbPassword,
  [string]$LabDataRoot = 'D:\LabData'
)

$ErrorActionPreference = 'Stop'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$targetDir = Join-Path $BackupRoot $timestamp
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$env:PGPASSWORD = $DbPassword
try {
  $dumpFile = Join-Path $targetDir 'labportal.dump'
  Write-Host "Dumping database '$DbName' -> $dumpFile"
  & "$PgBinDir\pg_dump.exe" -h $DbHost -p $DbPort -U $DbUser -F custom -f $dumpFile $DbName
  if ($LASTEXITCODE -ne 0) { throw "pg_dump exited with code $LASTEXITCODE" }
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

if (Test-Path $LabDataRoot) {
  $zipFile = Join-Path $targetDir 'labdata.zip'
  Write-Host "Archiving $LabDataRoot -> $zipFile"
  Compress-Archive -Path (Join-Path $LabDataRoot '*') -DestinationPath $zipFile -Force
} else {
  Write-Warning "LabDataRoot '$LabDataRoot' does not exist - skipping file backup (media/recordings will be missing from this backup)"
}

Write-Host "Backup complete: $targetDir"
