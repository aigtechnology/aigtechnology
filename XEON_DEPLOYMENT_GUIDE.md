# AIG Technology Xeon Deployment Guide

**Purpose:** Transfer the backend preparation bundle from the laptop to the Xeon PC. This is a staged, manual deployment procedure; the scripts do not install database servers, configure production integrations, modify Firebase/DNS, or start the backend automatically.

## Important gates and assumptions

- The Xeon PC's exact Windows edition, build, patch level, firmware, and hardware support have not been verified. The supported Windows Server 2022/2025 check is only an OS/build preflight, not a Microsoft or OEM certification of the Xeon E5-1603.
- The Xeon E5-1603 is not listed in the Windows 11 supported Intel processor page checked earlier. That is not by itself a Windows Server support determination. Confirm the exact model against the hardware maker's support matrix and Microsoft's current Server lifecycle and requirements before continuing. Do not bypass security checks.
- `PRE_INSTALL_CHECK.ps1` assumes a minimum of 8 GiB installed RAM, 4 GiB currently free RAM, 10 GiB install-volume space, and 20 GiB data/backup-volume space (30 GiB if both paths share a volume). These are configurable conservative planning thresholds, not benchmark results.
- This package assumes Python 3.11-3.13 x64. PostgreSQL and Windows-compatible Redis service products have not been selected or tested. Production is blocked until each is vendor-supported for the chosen Windows Server version and bound to loopback.
- A service wrapper must be separately obtained and validated. Setup currently accepts only an Authenticode-valid WinSW executable named `AigTechnologyBackend.exe`; if a supported signed release is unavailable, stop and choose an approved signed service host rather than bypassing signature checks.
- No migration, backup/restore, Windows service, firewall, Cloudflare Tunnel, or Cloudflare Access operation has been run on the Xeon PC.

## 1. Prepare and transfer the clean bundle

On the laptop, review [TRANSFER_MANIFEST.md](./TRANSFER_MANIFEST.md). Transfer only the listed files and directories. Use a new, empty staging directory on the Xeon PC; do not merge over an existing installation. Do not copy `.env`, `backend.env`, `.venv`, `.git`, caches, logs, backups, database files, Firebase service accounts, Cloudflare tunnel credentials, or payment credentials.

Keep the following on the laptop / in the existing website deployment:

- The Git repository metadata and local Python virtual environment.
- The real `backend/.env` and all personal/production configuration.
- Firebase and Razorpay credentials, Cloudflare tunnel credential JSON, database passwords, session secrets, backups, and customer data.
- The public website and Firebase product-admin panel. This package is backend-only; it does not replace the existing website or Firebase admin panel.

Transfer over an encrypted, access-controlled channel. Verify file names and, if your organization provides them, a signed checksum manifest before use. The manifest in this package is a file list, not a cryptographic signature.

## 2. Establish the host before installing software

1. Confirm with the PC/OEM provider that the Xeon E5-1603 system and firmware are supported for the intended Windows Server release. Install a supported Windows Server edition (2022 or 2025 is the script's preliminary allowlist), apply current security updates and firmware, and enable supported Secure Boot/TPM protections where hardware supports them.
2. Use a named administrative account for installation only. Do not run services as the `OFFICE` login or as an interactive user. The setup creates a separate standard local service account.
3. Configure Windows Update, Defender/endpoint protection, time synchronization, and a documented recovery method. Do not create public inbound rules for API, PostgreSQL, or Redis ports.
4. Open elevated PowerShell in the bundle under your organization's approved script execution policy and run the initial read-only preflight:

   ```powershell
   .\backend\deploy\windows\PRE_INSTALL_CHECK.ps1 -Stage PreInstall
   ```

   This checks edition/build, elevation, installed/free RAM, free disk space, Python, PostgreSQL/Redis presence/readiness, listener addresses, and API/admin port conflicts. On a fresh machine, missing Python, PostgreSQL, and Redis are expected warnings at this stage; install them in the next step. OS, resource, permission, and port-conflict failures must be resolved. The command does not install or configure software.

   The transferred PowerShell files are not code-signed in this workspace. They may be blocked by a restrictive execution policy or download-origin marking. Have the responsible administrator review and sign the approved scripts or use the organization's documented script execution process. Do not use `ExecutionPolicy Bypass` or weaken machine policy to run them.

## 3. Install and configure prerequisites

Install products only from their trusted publisher and only after confirming support/licensing for the Xeon PC's exact Windows Server release:

1. Install 64-bit Python 3.11, 3.12, or 3.13. Put the intended interpreter on the system PATH for administrator setup; the API service itself will use its install-local virtual environment.
2. Install a supported PostgreSQL release as a Windows service. Use a dedicated database role with only application permissions. Bind PostgreSQL to `127.0.0.1` (and `::1` only if deliberately needed), limit `pg_hba.conf` to loopback, and do not expose TCP 5432 through Windows Firewall.
3. Select and install a vendor-supported Windows Redis-compatible service. The supported product for this host is currently **unselected and unverified**; do not install an unofficial/legacy port. Bind it to loopback, configure authentication/ACLs as supported, keep TCP 6379 closed to remote clients, and ensure the approved client can verify the service. If the Windows service name is nonstandard, pass `-RedisServiceName`.
4. Configure PostgreSQL and the Redis-compatible server to run as Windows background services under dedicated vendor-supported service identities, not the `OFFICE` user. Confirm automatic start/recovery using each vendor's supported procedure. The application setup script does not install PostgreSQL, Redis, or their service binaries.
5. Run the preflight again after both data services are configured:

   ```powershell
   .\backend\deploy\windows\PRE_INSTALL_CHECK.ps1 -Stage Ready
   ```

   Ready mode requires both database services running, PostgreSQL `pg_isready`, Redis `PING`, loopback-only listeners, free API/admin ports, and the other preflight gates. For Redis requiring ACL credentials, do not place a password on a command line; validate it using the provider's secure method and resolve the check before deployment. A failed gate means stop.

## 4. Stage application files without overwriting existing data

1. Create a new, empty install directory, for example `C:\Program Files\AIGTechnology\backend`. Populate it only with the backend files listed in `TRANSFER_MANIFEST.md`, preserving the directory layout. Do not use `robocopy /MIR`, archive extraction that merges over an existing install, or commands that delete destination files.
2. Confirm `app\main.py`, `requirements.txt`, `alembic.ini`, and `migrations\` are present. Keep the laptop `.env` and `.venv` out.
3. Use the setup script to create a fresh virtual environment, install the pinned runtime dependencies, and create the dedicated service account and protected managed directories in one run. This step requires access to the configured, approved Python package source and does not install OS services:

   ```powershell
   .\backend\deploy\windows\Setup-AigBackend.ps1 -Mode Prepare `
     -InstallRoot 'C:\Program Files\AIGTechnology\backend' `
     -InstallPythonDependencies -CreateServiceAccount
   ```

   The command refuses to modify an existing `.venv`. If it fails after creating the new virtual environment, preserve it for review and use a new, empty install directory for a fresh attempt.

4. If you did not create the account during step 3, create the dedicated local service identity and managed data folders:

   ```powershell
   .\backend\deploy\windows\Setup-AigBackend.ps1 -Mode Prepare `
     -InstallRoot 'C:\Program Files\AIGTechnology\backend' `
     -CreateServiceAccount
   ```

   This requires the preflight to pass, prompts for the service-account password securely, and does not add that account to Administrators. Services run under Windows Service Control Manager rather than the `OFFICE` desktop session. On a repeated run, existing accounts and folder contents are retained; existing ACLs are not replaced and are explicitly warned for manual review.

   The local service account is configured with a non-expiring password so scheduled password expiry cannot silently stop the service. Store and rotate that password under the organization's service-account policy, updating the service logon credential through approved Windows administration; never record it in this package.

5. If an install/config/data directory already exists, stop and review it first. Do not point setup at an existing application, database, or user-data directory merely to reuse space.

## 5. Configure secrets and database

The only transferable environment file is `backend\.env.example`. Every value is a placeholder; it is not a runnable or usable production configuration.

1. Create `C:\ProgramData\AIGTechnology\Config\backend.env` from the sample **only if that destination does not already exist**. If it exists, preserve it and have its owner review/update it; do not overwrite it. Example guarded copy:

   ```powershell
   $sample = 'C:\Program Files\AIGTechnology\backend\.env.example'
   $destination = 'C:\ProgramData\AIGTechnology\Config\backend.env'
   if (Test-Path -LiteralPath $destination) {
       throw "Existing configuration preserved; review it manually."
   }
   Copy-Item -LiteralPath $sample -Destination $destination
   ```

2. Set restrictive ACLs on the external config file and directory: only `SYSTEM`, local Administrators, and the backend service identity should be able to read it; the application account should not be able to edit it. Setup restricts newly created Config folders, but if the folder existed, it preserves its ACL and requires manual review.
3. Replace every `REPLACE_WITH_...` field with approved values using a secure editor or secret-management workflow. Never paste secrets into commands, chat, source control, or logs. Keep test credentials isolated. Mock payments are development-only; production startup rejects mock payments.
4. Choose a database name and an existing, verified backup. Configure PostgreSQL client authentication through a protected service definition or protected `PGPASSFILE`, not a password command argument or plaintext command history.
5. Verify the backup archive before restore. `Backup-Postgres.ps1` verifies new dumps with `pg_restore --list`; for a transferred backup, run `pg_restore --list <backup-file>` first. Restore only into a **new database name**:

   ```powershell
   .\backend\deploy\windows\Restore-Postgres.ps1 `
     -BackupFile 'C:\ProgramData\AIGTechnology\Backups\verified-source.dump' `
     -TargetDatabase aig_restore_drill
   ```

   The restore script refuses an existing target database and never drops a database. On restore failure, it retains the new partial database for investigation. Verify schema, Alembic revision, constraints, row counts, and application queries before any configuration/cutover. Do not restore or migrate production data without explicit authorization.

6. For a genuinely new empty database, apply the reviewed Alembic migration only after a separate database backup/restore rehearsal and approval:

   ```powershell
   Push-Location 'C:\Program Files\AIGTechnology\backend'
   $previousEnvFile = $env:AIG_ENV_FILE
   $env:AIG_ENV_FILE = 'C:\ProgramData\AIGTechnology\Config\backend.env'
   try {
     .\.venv\Scripts\alembic.exe upgrade head
     if ($LASTEXITCODE -ne 0) { throw "Alembic migration failed; stop and inspect before retrying." }
   }
   finally {
     if ($null -eq $previousEnvFile) { Remove-Item Env:\AIG_ENV_FILE -ErrorAction SilentlyContinue }
     else { $env:AIG_ENV_FILE = $previousEnvFile }
     Pop-Location
   }
   ```

   Expected revision is `20261107_01`. Do **not** run `scripts\init_database.py` or `scripts\create_admin.py`; those scripts call `Base.metadata.create_all()` and are not the controlled production migration path. Admin creation requires a separately reviewed, migration-safe procedure.

## 6. Register (do not automatically start) the backend service

1. Independently obtain a supported, Authenticode-valid WinSW release, verify its publisher/signature and hash using trusted release information, and place it in a protected Program Files directory as `AigTechnologyBackend.exe`. The script rejects unsigned/unverified binaries.
2. Review the external environment file, service account ACLs, database readiness, and migration state. Then register:

   ```powershell
   .\backend\deploy\windows\Setup-AigBackend.ps1 -Mode Prepare `
     -InstallRoot 'C:\Program Files\AIGTechnology\backend' `
     -RegisterService `
     -WinSWPath 'C:\Program Files\AIGTechnology\AigTechnologyBackend.exe'
   ```

   If the local Redis service has a nonstandard name, add `-RedisServiceName '<service-name>'`. The service is registered for delayed automatic start and recovery, but is **not started** by setup. Existing service registrations/config files are never replaced; a rerun reports an existing service and leaves it unchanged.
3. Before manually starting the service under an approved change window, verify its `AIG_ENV_FILE` points to the external protected config, its working directory is the install root, and Uvicorn binds to `127.0.0.1:8000`. Start and stop it through Services/approved service-control tooling, not an `OFFICE` shell.
4. Run diagnostics after the service and dependencies are started:

   ```powershell
   .\backend\deploy\windows\Test-AigBackendHealth.ps1 `
     -BackendServiceName AigTechnologyBackend `
     -PostgresServiceName '<actual-postgresql-service-name>' `
     -RedisServiceName '<actual-redis-service-name>'
   ```

   The script checks health responses and listeners. Investigate every failure; never expose database or Redis listeners publicly.

## 7. Cloudflare and public website boundaries

The transferred `cloudflared.config.example.yml` is only a placeholder. It contains no tunnel credential and does not create DNS. Configure a tunnel and Access policies manually under the approved Cloudflare account, require MFA for private admin routes, and test authorization/denial. Install/configure Cloudflare Tunnel using its official Windows service procedure and a dedicated service identity, not the `OFFICE` login. Keep `api.aigtechnology.in` mapped only to the loopback API and point `admin.aigtechnology.in` at a separately reviewed static-admin origin. The local static admin host is not included in this backend bundle.

Do not modify existing apex/root/www DNS records, Firebase products, Razorpay production credentials, or the public website as part of this transfer. Do not open 8000, 5432, or 6379 inbound in Windows Firewall.

## 8. Rollback

1. Stop the backend service. Do not delete the service, database, config, or data directories as an automatic rollback action.
2. Preserve current logs, service configuration, and a copy of the external configuration with secrets kept in approved protected storage. Record the current binary/version and database name.
3. Restore a verified pre-change backup into a **new** database name using `Restore-Postgres.ps1`. Verify the restored Alembic revision, relations/constraints, and representative data before changing application config.
4. Revert to the previously retained application release directory (do not overwrite or delete the current one). Point the service's protected external config to the validated restored database using an approved, reviewed edit.
5. Start the prior service version and run `Test-AigBackendHealth.ps1`. Keep the failed release/database for investigation. Never drop the original database or overwrite an existing backup as rollback cleanup.
6. Roll back Cloudflare Tunnel/Access separately in its dashboard under an approved change. Do not alter root/www GitHub Pages DNS records.

## Remaining deployment blockers

- Xeon-specific Windows Server and hardware support are unverified.
- Supported PostgreSQL/Redis Windows distributions, service configuration, and loopback binding have not been tested on the target.
- The Windows service wrapper signature/availability and account service-logon policy are untested.
- The pre-install script has parser validation only; target-host execution is still required.
- Database restore/migration, backend Windows service startup/recovery, Cloudflare Access, and test-payment journeys remain untested.
- Production remains blocked until all prerequisites and approvals above pass. No deployment is authorized by this guide.
