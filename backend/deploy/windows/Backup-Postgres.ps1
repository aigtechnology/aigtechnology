[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Database,
    [string]$BackupDirectory = "$env:ProgramData\AIGTechnology\Backups",
    [string]$PgDump = "pg_dump",
    [string]$PgRestore = "pg_restore"
)

$ErrorActionPreference = "Stop"
if ($Database -notmatch "^[A-Za-z0-9_]{1,63}$") {
    throw "Database name must be 1-63 ASCII letters, digits, or underscores."
}
New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $BackupDirectory "$Database-$stamp.dump"
if (Test-Path -LiteralPath $backup) { throw "Refusing to overwrite existing backup: $backup" }

& $PgDump --format=custom --no-owner --no-privileges --file=$backup --dbname=$Database
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE." }

& $PgRestore --list $backup
if ($LASTEXITCODE -ne 0) {
    throw "Backup archive verification failed. Preserve the file for investigation; do not treat it as a valid backup."
}
Write-Output "PASS: custom-format backup verified: $backup"
Write-Output "For a restore drill, use Restore-Postgres.ps1 with a new, empty target database name."
