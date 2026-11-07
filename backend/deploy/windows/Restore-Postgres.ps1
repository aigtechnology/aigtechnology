[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BackupFile,
    [Parameter(Mandatory = $true)][string]$TargetDatabase,
    [string]$PgRestore = "pg_restore",
    [string]$Psql = "psql"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) { throw "Backup file does not exist: $BackupFile" }
if ($TargetDatabase -notmatch "^[A-Za-z0-9_]{1,63}$") { throw "Target database name must be 1-63 ASCII letters, digits, or underscores." }

& $PgRestore --list $BackupFile | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Backup archive is invalid or unreadable." }

$existing = & $Psql --no-psqlrc --tuples-only --no-align --dbname=postgres --command="SELECT 1 FROM pg_database WHERE datname = '$TargetDatabase'"
if ($LASTEXITCODE -ne 0) { throw "Could not check the target database. Restore was not attempted." }
if ($existing -match "1") { throw "Target database already exists. Restore refuses to overwrite or drop databases." }

& $Psql --no-psqlrc --dbname=postgres --command="CREATE DATABASE `"$TargetDatabase`""
if ($LASTEXITCODE -ne 0) { throw "Could not create the new target database." }

& $PgRestore --exit-on-error --no-owner --no-privileges --dbname=$TargetDatabase $BackupFile
if ($LASTEXITCODE -ne 0) {
    throw "Restore failed. The newly created target database was retained for investigation and was not dropped."
}
Write-Output "PASS: restored into new database '$TargetDatabase'. Verify migrations and application queries before any cutover."
