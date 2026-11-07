# AIG Technology Windows Server Preparation Report

**Scope:** Prepare and document (not deploy) the FastAPI backend for the proposed dedicated Windows computer. No production service, database, Firebase catalogue, DNS, Cloudflare Tunnel, or payment configuration was changed.

## Executive status

**Decision: NOT READY TO DEPLOY.** The workspace now includes a backend-only transfer manifest, Xeon guide, read-only host preflight, guarded Windows setup, diagnostics, backup/restore tooling, and a Tunnel example. The intended target has not been inspected; no target dependency, Windows service, database, network route, Firebase, or payment configuration was changed.

| Area | Status | Evidence / remaining work |
|---|---|---|
| Application liveness/readiness | **PASS (code + isolated test)** | `/health/live` and `/health/ready` and `/api/` aliases are implemented. The readiness check reports only database/Redis status, not connection details. |
| Production host OS and Xeon support | **BLOCKED** | The target OS/build is unknown. The Xeon E5-1603 was not found on Microsoft's current Windows 11 supported Intel processor list. Do not bypass Windows hardware or security requirements. |
| Windows service setup | **NOT TESTED** | Scripted as opt-in preparation only; it has not been run on a supported Windows Server host. WinSW must be independently sourced and signature-verified. |
| PostgreSQL / Redis | **BLOCKED** | No target services or approved Windows Redis-compatible distribution were validated. Ports must remain loopback-only. |
| Backup / restore tooling | **NOT TESTED** | Scripts are present; no PostgreSQL target, backup, or restore drill was run for this request. |
| Cloudflare Tunnel / Access | **NOT TESTED** | Example routing only. No tunnel, DNS record, Access policy, firewall, or public website record was changed. |
| Isolated backend tests | **PASS** | 14 tests passed and Python compilation passed in test mode; repository `.env`, Firebase, Razorpay, PostgreSQL, and Redis were not used. |
| Transfer contents and secret exclusion | **PASS (inspection only)** | A backend-only manifest excludes `.env`, `.venv`, database files, backups, logs, credentials, the Firebase panel, and public website. `.env.example` is placeholder-only and explicitly exempted from the ignore rule; the real `backend/.env` remains ignored and untracked. |
| Xeon pre-install checks | **NOT TESTED ON TARGET** | Windows edition/build, elevation, RAM/free RAM, volume space, Python, PostgreSQL/Redis, and required port checks are scripted. Only PowerShell parser validation has been performed. |
| PowerShell code signing | **BLOCKED / NOT DONE** | The transferred scripts are not code-signed. Use an organization-approved signing and execution-policy process; do not bypass execution policy. |

## Host support findings

The development workstation inspected for this preparation is **Windows 11 Pro 25H2, build 26200.9711**, on an Intel Core i5-8265U. It is not the proposed Xeon server and is not evidence of the target's OS state. Windows 11 25H2 Pro is within Microsoft's published servicing period (through **2027-10-12** as reported in the source checked); the source's latest listed revision was 26200.9818, so the workstation patch level is behind that listing. This does not make Windows client an approved production service host.

The proposed **Intel Xeon E5-1603** generation/model does not appear on Microsoft's supported Windows 11 Intel processor list; the listed Xeon series begin with newer Xeon Scalable, D, E-2100, and W families. The actual server Windows edition, version/build, update level, and firmware state have not been supplied or inspected. Production preparation must stop until a supported Windows Server release and supported hardware/firmware combination are confirmed against Microsoft's current requirements and lifecycle pages. `Setup-AigBackend.ps1 -Mode Prepare` refuses Windows client editions and Server builds older than 20348 (Server 2022); this conservative gate is not a Microsoft hardware certification.

The read-only audit ran on the development workstation, **not the target**. It found a running local `postgresql-x64-18` service with listeners on `0.0.0.0:5432` and `[::]:5432`; the script flagged both as **BLOCKED** because they are not loopback-only. No configuration or firewall change was made. Verify whether this workstation is reachable from untrusted networks and restrict PostgreSQL before using it as a server; do not infer that the target has the same state.

Sources checked:

- [Windows 11 release information and servicing dates](https://learn.microsoft.com/windows/release-health/windows11-release-information)
- [Microsoft supported Intel processors for Windows 11](https://learn.microsoft.com/windows-hardware/design/minimum/supported/windows-11-supported-intel-processors)
- [Windows Server release information](https://learn.microsoft.com/windows-server/get-started/windows-server-release-info)

Do not install an unsupported Windows build or bypass TPM, Secure Boot, CPU, or update checks. If the Xeon system cannot run a supported Windows Server release, select supported replacement hardware or a supported hosting platform before proceeding.

## Implemented files

- `backend/app/config.py` — supports `AIG_ENV_FILE` so a service can read an external environment file instead of the repository `.env`.
- `backend/app/main.py` — liveness and readiness endpoints; database and configured Redis checks are logged without returning secret-bearing error text.
- `backend/tests/test_checkout.py` — isolated health endpoint coverage; health probes use the fixture's temporary SQLite database.
- `backend/deploy/windows/Setup-AigBackend.ps1` — read-only audit, isolated test, guarded preparation, optional Python virtual environment creation, and opt-in service account/service registration paths.
- `backend/deploy/windows/PRE_INSTALL_CHECK.ps1` — host, RAM, disk, Python, database/cache readiness, listener binding, and port-conflict preflight.
- `backend/deploy/windows/Test-AigBackendHealth.ps1` — service, loopback listener, and HTTP health diagnostics.
- `backend/deploy/windows/Backup-Postgres.ps1` — non-overwriting PostgreSQL custom-format backup and archive-list verification.
- `backend/deploy/windows/Restore-Postgres.ps1` — restore to a new database only; refuses existing databases and never drops a database.
- `backend/deploy/windows/cloudflared.config.example.yml` — sample API/admin ingress; contains no tunnel credentials.
- `XEON_DEPLOYMENT_GUIDE.md` — fresh-host sequence, transfer instructions, migration/backup/restore, service identity, and rollback.
- `TRANSFER_MANIFEST.md` — exact backend-only transfer allowlist and exclusions.
- `backend/.env.example` — placeholder values only; not a usable production config.

## Files changed for the final transfer-preparation request

- `.gitignore` — explicitly permits only `backend/.env.example` while retaining the `.env` exclusion.
- `backend/.env.example` — replaced with placeholder-only values; real `backend/.env` was not opened or changed.
- `backend/README.md` and `DEPLOYMENT.md` — link to the transfer guide and manifest.
- `backend/deploy/windows/Setup-AigBackend.ps1` — Ready preflight gate, service-account/ACL protections, no-overwrite behavior, safe reruns, and restored test-process environment values.
- `backend/deploy/windows/PRE_INSTALL_CHECK.ps1` — read-only host and dependency checks.
- `backend/deploy/windows/Backup-Postgres.ps1` — validates database names before creating archives.
- `XEON_DEPLOYMENT_GUIDE.md` — staged install and rollback instructions.
- `TRANSFER_MANIFEST.md` — exact transfer allowlist/exclusions.
- `SERVER_PREPARATION_REPORT.md` — this updated report.

## Test evidence and limitations

PowerShell parser validation succeeded for all five `.ps1` scripts. `Setup-AigBackend.ps1 -Mode Test` completed with **14 tests passed** and Python compilation passed. `git diff --check` passed. The local virtual environment was missing the already-declared `redis==5.2.1` dependency; that package was installed into the existing workspace `.venv` only to enable the test run. No dependency manifest was changed. No PowerShell preparation, dependency installation, service registration, PostgreSQL migration, or backup/restore operation has been run on the intended Xeon computer. The new pre-install script was not executed on the laptop or Xeon PC.

The test mode in `Setup-AigBackend.ps1 -Mode Test` sets:

- `AIG_ENV_FILE` to a unique, nonexistent temporary file, so `backend/.env` is not loaded.
- SQLite in-memory database, mock payments, empty Razorpay/Flipkart credentials, and a fake Firebase project ID.
- It runs the available workspace `.venv` pytest and Python compilation only. It does not install dependencies or connect to Firebase, Razorpay, PostgreSQL, or Redis.

Run from the repository root:

```powershell
.\backend\deploy\windows\Setup-AigBackend.ps1 -Mode Test
```

Audit is read-only and does not print environment-file values:

```powershell
.\backend\deploy\windows\Setup-AigBackend.ps1 -Mode Audit
```

The audit only reports available commands, detected service states, and listening addresses. On the inspected workstation it reported PostgreSQL listening on wildcard IPv4 and IPv6 addresses. It cannot certify OS entitlement, hardware support, security configuration, or vendor support.

## Service and dependency preparation

Follow [XEON_DEPLOYMENT_GUIDE.md](./XEON_DEPLOYMENT_GUIDE.md) and [TRANSFER_MANIFEST.md](./TRANSFER_MANIFEST.md) for the staging and installation sequence. `PRE_INSTALL_CHECK.ps1 -Stage PreInstall` allows missing Python/PostgreSQL/Redis as warnings while checking the base host; `-Stage Ready` requires the supported Python, both data services, their expected loopback listeners, free API/admin ports, and PostgreSQL client tools before setup changes. The API health readiness endpoint is checked separately by `Test-AigBackendHealth.ps1` after the service is started. Thresholds (8 GiB installed RAM, 4 GiB free RAM, 10 GiB install space, 20 GiB data space) are conservative planning assumptions and can be overridden. If install/data paths share a volume, the script requires their thresholds combined.

`-Mode Prepare` requires a supported Server host and a passing Ready check before setup changes. It never copies or overwrites application files or an existing environment file. A new `.venv` is created only when absent; existing service registrations/config files are left untouched; new managed directories receive restricted ACLs; existing directories retain their ACLs with warnings. Use a new install root for a new release. `-CreateServiceAccount` prompts for a password and creates a standard local user, refusing administrator membership. Services are registered to run under a dedicated Windows service account, independently of the `OFFICE` interactive login. If a service registration already exists, rerunning registration reports it and makes no changes. The service is set for delayed automatic start and recovery, but setup does not start it.

The setup process does not install PostgreSQL or Redis-compatible server software. It can optionally create a new Python virtual environment and install the pinned runtime requirements from the configured package source. These behaviors have not been tested on the target.

## Portable package and secret handling

The transfer manifest is an allowlist, not a zip/archive generator. Transfer only the backend source, migrations, runtime requirements, deployment scripts, and placeholder `.env.example` listed there. Do not copy the repository wholesale or include the real `backend/.env`, `.venv`, databases, logs, backups, Firebase service-account keys, Cloudflare tunnel credentials, Razorpay credentials, or the public website/Firebase admin panel.

The root `.gitignore` now contains an explicit exception for `backend/.env.example`; real `.env` files remain excluded. Git ignore/tracking status was checked by filename only. The real `backend/.env` was not opened, copied, or modified. Every sample value is a `REPLACE_WITH_...` placeholder; never use the sample as a runnable or production config.

`PRE_INSTALL_CHECK.ps1` was parser-validated but not run. Its 64-bit Python 3.11-3.13 range, Windows Server 2022/2025 OS allowlist, minimum RAM/storage thresholds, service-name matching, and Redis unauthenticated `PING` check are assumptions that require verification against the actual Xeon OS, chosen server products, authentication settings, and vendor support. The OS preflight does not certify CPU/firmware support.

PowerShell scripts are not code-signed. Obtain authorized review/signing before transfer execution if required by the host's script policy. Do not bypass execution policy.

For service registration, first install the reviewed app and its virtual environment in the selected install root, create the external config at `C:\ProgramData\AIGTechnology\Config\backend.env`, and separately obtain a trusted, signature-valid WinSW executable named `AigTechnologyBackend.exe`. The opt-in `-RegisterService` path refuses to overwrite an existing XML configuration, registers the service with delayed automatic start, binds Uvicorn to `127.0.0.1:8000`, and configures restart recovery. It prompts for the service-account credential through a secure credential prompt; never put passwords in command arguments, scripts, logs, or this repository. The command does **not** start the service or validate live credentials/dependencies.

Example (run elevated only on the approved target after reviewing all paths and prerequisites):

```powershell
.\backend\deploy\windows\Setup-AigBackend.ps1 -Mode Prepare `
  -InstallRoot 'C:\Program Files\AIGTechnology\backend' `
  -InstallPythonDependencies -CreateServiceAccount
.\backend\deploy\windows\Setup-AigBackend.ps1 -Mode Prepare `
  -InstallRoot 'C:\Program Files\AIGTechnology\backend' `
  -CreateServiceAccount -RegisterService `
  -WinSWPath 'C:\Program Files\AIGTechnology\AigTechnologyBackend.exe'
```

The second command requires an existing service account, valid app/venv/config files, and signed WinSW. Run it only once the target prerequisites have been reviewed. Do not use the project checkout as the production installation tree.

### PostgreSQL

Install a currently supported PostgreSQL release using its official Windows distribution and follow its vendor-supported service instructions. Use a dedicated database role with only required privileges; configure a separate service identity if supported by the chosen installer. Set `listen_addresses = '127.0.0.1'` (and localhost IPv6 only if required), do not open TCP 5432 in Windows Firewall, and restrict `pg_hba.conf` to loopback and the application database role. Preserve a timestamped copy of each configuration file before editing, validate the configuration, then restart in a maintenance window and verify `Get-NetTCPConnection` reports loopback only. These steps have not been run.

Apply Alembic migrations from a backup and rehearsed test restore. The current expected revision is `20261107_01`. Do not use the application startup `create_all` path as a production migration mechanism. The setup script does not install PostgreSQL or alter its configuration automatically.

### Redis / rate limiting

The application uses Redis when `RATE_LIMIT_STORAGE_URI` is configured; production startup requires this setting. No supported native Windows Redis distribution was established for the target. Select a vendor-supported Redis-compatible service or another explicitly approved rate-limit store and validate its Windows support, license, security update process, persistence expectations, and compatibility before setting `RATE_LIMIT_STORAGE_URI`. Bind it only to loopback, use authentication/ACLs and a firewall deny rule for port 6379. Do not install an unofficial legacy Windows Redis build or assume a Redis service exists.

## API, HTTPS, Cloudflare Tunnel, and Access

The sample `cloudflared.config.example.yml` maps:

- `api.aigtechnology.in` to `http://127.0.0.1:8000`
- `admin.aigtechnology.in` to a separate local web origin at `http://127.0.0.1:8080`

The second origin is a placeholder for a reviewed static admin host/reverse proxy and must not be pointed at the API unless an explicit routing design is configured. Keep the Tunnel credential JSON outside the repository with ACLs restricted to the cloudflared service identity. Obtain Cloudflare Tunnel credentials through the account dashboard, validate tunnel health, and configure hostnames only through the approved Cloudflare process. This report does not create DNS records or change existing apex/root/www GitHub Pages records.

Enable Cloudflare Access with MFA and least-privilege identity policies on the private admin hostname and all private admin API routes. Review API route exposure so public checkout/order-customer endpoints remain reachable as intended while private operations routes are protected. Test both authorized and denied paths externally before release. Cloudflare Access is not a substitute for backend authentication, CSRF protection, or CORS.

Only publish through HTTPS. Keep Uvicorn, PostgreSQL, Redis, and the static admin origin bound to localhost. Do not create public inbound firewall rules for ports 8000, 5432, or 6379. Allow only the minimum required outbound connectivity for tunnel, updates, and configured providers. Run `Test-AigBackendHealth.ps1` after manual configuration:

```powershell
.\backend\deploy\windows\Test-AigBackendHealth.ps1 `
  -BackendServiceName AigTechnologyBackend `
  -PostgresServiceName '<verified PostgreSQL service name>' `
  -RedisServiceName '<approved Redis-compatible service name>'
```

## Environment and secret handling

Store `backend.env` outside the repository under a protected ProgramData configuration directory. Restrict its ACL to Administrators and the service identity (read only for the service). Populate and validate only after all providers and production approvals are available. At minimum configure `APP_ENV=production`, PostgreSQL `DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, exact HTTPS `ADMIN_ORIGIN`, `STOREFRONT_ORIGIN`, and `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_STORAGE_URI`, and an approved payment provider. Current production startup rejects mock payments and expects Razorpay test credentials until live-payment configuration is separately approved.

Never commit or echo database passwords, session secrets, Cloudflare credentials, Firebase credentials, or Razorpay secrets. Use a protected PostgreSQL service definition/password file or an approved secrets store for database client authentication; do not pass passwords as command-line options. Test and backup scripts rely on the PostgreSQL client’s secured service/password configuration.

Production API URL configuration belongs in the existing public frontend configuration and must be an HTTPS URL; changing it is a separate release and is intentionally not done here. Keep CORS limited to exact origins. Verify secure cookies only over HTTPS, CSRF checks on state-changing authenticated requests, rate limiting, security headers, authentication, logs, and errors before public traffic.

## Backup, restore, and rollback

Backups are non-overwriting custom-format archives. PostgreSQL client tools must be installed and use an approved secured connection configuration (`PGSERVICE`/`PGPASSFILE` or equivalent). Do not place credentials in arguments.

```powershell
.\backend\deploy\windows\Backup-Postgres.ps1 -Database aig_admin
.\backend\deploy\windows\Restore-Postgres.ps1 `
  -BackupFile 'C:\ProgramData\AIGTechnology\Backups\aig_admin-YYYYMMDD-HHMMSS.dump' `
  -TargetDatabase aig_restore_drill
```

Backup verification uses `pg_restore --list`. A successful restore creates a new database only; if restore fails, that database is retained for investigation and is not dropped. Verify the migration revision, expected tables/constraints, row counts, and application health against the restored database. Copy encrypted backups off-host according to the approved retention policy and periodically test an off-host restore. Neither backup nor restore has been run against the proposed server.

Rollback rehearsal: stop the API service; preserve logs and current config; restore the pre-change backup into a **new** database; validate it; point a reviewed config change to the restored database; start the API and run diagnostics. Revert application artifacts using the previously retained release package, not by resetting or deleting the working tree. Never drop or overwrite the original database as part of rollback. DNS/Tunnel and Firebase changes are outside this preparation and must have their own approved rollback steps.

## Remaining blockers before deployment

1. Confirm target Windows Server edition, version/build, current patches, firmware/TPM/Secure Boot status, and hardware compatibility. Xeon E5-1603 is not in the Windows 11 supported processor list; Windows 11 client is not accepted by the production setup script.
2. Select/validate supported Windows PostgreSQL and Redis-compatible service distributions and service identities; configure and verify localhost-only listeners and firewall rules.
3. Install/review the release into a dedicated install directory, create protected production configuration and non-admin service account, verify a signed WinSW release, then register/start services only under deployment approval.
4. Run target-host test mode, service diagnostics, PostgreSQL migration rehearsal, backup/restore verification, and failure/recovery tests.
5. Configure Cloudflare Tunnel and Access policies manually; verify protected admin routes and public checkout flows without changing root/www records.
6. Supply approved test provider credentials and verify Razorpay test transactions/webhooks separately. No production payment credentials have been used.
7. Complete security, monitoring, log retention, firewall, disaster-recovery, and cutover approvals. No deployment is authorized by this report.
