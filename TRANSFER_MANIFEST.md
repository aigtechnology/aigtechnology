# AIG Technology Xeon Transfer Manifest

This is the exact **backend-only** transfer set for a clean staging folder on the Xeon PC. Copy directory contents while preserving paths. Do not transfer the entire Git repository.

## Required files and directories

```text
XEON_DEPLOYMENT_GUIDE.md
TRANSFER_MANIFEST.md
SERVER_PREPARATION_REPORT.md
backend/
  .env.example
  README.md
  alembic.ini
  requirements.txt
  app/
    __init__.py
    auth.py
    business_models.py
    checkout.py
    config.py
    database.py
    firebase_auth.py
    flipkart.py
    main.py
    models.py
    payment_providers.py
    schemas.py
    sync.py
  migrations/
    env.py
    script.py.mako
    versions/
      20261107_01_website_checkout.py
  deploy/
    windows/
      Backup-Postgres.ps1
      PRE_INSTALL_CHECK.ps1
      Restore-Postgres.ps1
      Setup-AigBackend.ps1
      Test-AigBackendHealth.ps1
      cloudflared.config.example.yml
```

In the deployed application directory, the `backend/` directory above becomes the contents of:

```text
C:\Program Files\AIGTechnology\backend
```

The report and guide can live in a separate protected documentation folder or remain with the administrator; they are not application runtime dependencies.

## Explicitly excluded

Never copy these from the laptop or commit them to Git:

- `backend/.env`, any `backend.env`, other `.env` files, or secret/config files.
- `.venv/`, `.git/`, `__pycache__/`, `.pytest_cache/`, build output, editor state, or local caches.
- PostgreSQL data directories, database dumps, customer/order data, logs, or local backups unless transferring a specifically approved encrypted backup through the approved backup process.
- Firebase service-account keys, Cloudflare Tunnel credentials, Razorpay credentials, database passwords, session secrets, or admin passwords.
- `backend/scripts/init_database.py` and `backend/scripts/create_admin.py`; both call `Base.metadata.create_all()` and must not be used as the production schema/migration workflow.
- The public website, Firebase product-admin panel, or static admin frontend. Those remain separate from this backend package.

`backend/.env.example` is the only environment sample to transfer. It is placeholder-only and must never be treated as an actual configuration. The root `.gitignore` has an explicit exception to allow this one sample file while ignoring real `.env` files.

## Transfer procedure

1. Create a new empty staging folder on the Xeon PC, for example `C:\AIG-Transfer`.
2. Copy only the listed paths from the laptop, preserving the `backend\` layout. Do not use mirror/delete options and do not merge over an existing installation.
3. Check the staged directory against this manifest. Remove no pre-existing files; if the staging destination is not empty, stop and select a fresh folder.
4. Run the pre-install checks and follow [XEON_DEPLOYMENT_GUIDE.md](./XEON_DEPLOYMENT_GUIDE.md). Keep all generated `.venv`, logs, backups, data, and secrets outside the laptop transfer source.

The manifest is not a checksum or digital signature. Verify integrity with your organization's approved signed artifact process if available.
