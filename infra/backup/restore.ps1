<#
.SYNOPSIS
  Restores a backup written by backup.ps1. Destructive: --clean drops
  every object in the target database before recreating it from the dump.

.EXAMPLE
  pwsh -File restore.ps1 -BackupDir 'D:\LabBackups\20260908-160000' -DbPassword $env:LABPORTAL_DB_PASSWORD
#>
param(
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [string]$PgBinDir = 'C:\Program Files\PostgreSQL\16\bin',
  [string]$DbHost = 'localhost',
  [int]$DbPort = 5432,
  [string]$DbName = 'labportal',
  [string]$DbUser = 'labportal',
  [Parameter(Mandatory = $true)][string]$DbPassword,
  [string]$LabDataRoot = 'D:\LabData',
  [switch]$Confirm
)

$ErrorActionPreference = 'Stop'
$dumpFile = Join-Path $BackupDir 'labportal.dump'
$zipFile = Join-Path $BackupDir 'labdata.zip'
if (-not (Test-Path $dumpFile)) { throw "No labportal.dump found in $BackupDir" }

if (-not $Confirm) {
  throw "This DROPS every object in database '$DbName' and overwrites $LabDataRoot before restoring. Re-run with -Confirm once you're certain."
}

$env:PGPASSWORD = $DbPassword
try {
  Write-Host "Restoring $dumpFile -> database '$DbName' (--clean --if-exists)"
  & "$PgBinDir\pg_restore.exe" -h $DbHost -p $DbPort -U $DbUser -d $DbName --clean --if-exists $dumpFile
  if ($LASTEXITCODE -ne 0) { throw "pg_restore exited with code $LASTEXITCODE" }
}
finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

if (Test-Path $zipFile) {
  Write-Host "Restoring $zipFile -> $LabDataRoot"
  New-Item -ItemType Directory -Force -Path $LabDataRoot | Out-Null
  Expand-Archive -Path $zipFile -DestinationPath $LabDataRoot -Force
} else {
  Write-Warning "No labdata.zip in $BackupDir - database restored, but media/recording files were not"
}

Write-Host "Restore complete."
