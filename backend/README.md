# AIG Technology API

This FastAPI service provides the private admin API and customer checkout/payment API. It is deployed separately from the static GitHub Pages site. PostgreSQL is required for production inventory row locking and order/payment storage.

## Setup

1. Create a PostgreSQL database and copy `.env.example` to `.env`.
2. Set `DATABASE_URL`, a long random `SESSION_SECRET`, `ADMIN_ORIGIN`, `STOREFRONT_ORIGIN`, and `FIREBASE_PROJECT_ID`. In production, set exact HTTPS origins, `CORS_ALLOWED_ORIGINS`, a private Redis `RATE_LIMIT_STORAGE_URI`, and Razorpay test-only credentials. Mock payments are development-only.
3. Install runtime dependencies with `pip install -r requirements.txt` (include `requirements-dev.txt` for tests).
4. Initialize a new database with `python scripts/init_database.py`, then run `alembic upgrade head`. Back up an existing database before applying migrations.
5. Start with `uvicorn app.main:app --reload --port 8000`.
6. To run the static storefront locally, serve the repository root on port 5500; localhost uses the local API URL automatically. For a deployment, set `PRODUCTION_API_BASE_URL` in the public `assets/js/api-config.js` to the HTTPS API URL ending in `/api`.

## Checkout catalog and admin

The Firebase admin product editor remains separate from the backend operations dashboard. For a catalog mapping, review `FIREBASE_PRODUCT_MAPPING_REPORT.md`, fill the CSV template with approved SKUs and verified stock, then use the Products page's read-only dry run and explicit confirmation. The importer validates IDs, prices, stock, and duplicate SKUs; its Firebase update changes only `sku`, `stockQuantity`, and `updatedAt`, then syncs rows to the backend and creates a downloadable audit log. Ordinary catalog sync remains available and does not write Firebase. Do not infer inventory from a text availability label.

Website orders are saved separately from Flipkart-synchronized orders and appear in the backend Orders page. Public order details require the unguessable `X-Order-Access-Token` issued at order creation. Do not log access tokens or payment payloads.

## Payments

`PAYMENT_PROVIDER=mock` is for non-production only and simulates outcomes; it does not perform a bank transaction. Production mode refuses mock checkout. Razorpay configuration is server-only: `PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Configure the Razorpay webhook endpoint and events as listed in `PAYMENT_API_DOCUMENTATION.md`; test in Razorpay test mode before enabling production.

Raw card data, CVV, UPI PINs, and other payment credentials are not collected or stored. The backend verifies Razorpay signatures and provider status before confirming payment.

## Migrations and tests

Run the schema migration after initializing/updating the database:

```powershell
alembic upgrade head
```

Run the backend tests with:

```powershell
python -m pytest -q tests
```

The tests use SQLite and mock provider behavior. They do not verify a PostgreSQL deployment or live Razorpay transaction.

Backend admin authentication uses Argon2 password hashes, HTTP-only `SameSite=Lax` session cookies, and session-bound CSRF tokens on state-changing authenticated requests. Operations order list/detail responses omit customer contact/address and payment-provider references. The Flipkart client covers documented shipment and return read paths and does not call them until `FLIPKART_ACCESS_TOKEN` is configured. Settlement/report access may require separate partner entitlement.

## Windows production deployment

Production startup validates PostgreSQL connectivity and the expected Alembic revision; it does not call `create_all`. Back up and rehearse the migration against a separate production-like database first. Run Uvicorn as a Windows service bound to `127.0.0.1` behind an HTTPS reverse proxy. Keep API, PostgreSQL, and Redis ports private. Configure TLS, firewall rules, exact allowed origins, secret storage, monitoring, and log rotation before accepting traffic. See `PRE_DEPLOYMENT_REPORT.md` for the migration and rollback checklist.

For laptop-to-Xeon transfer, exact transfer contents, pre-install checks, no-overwrite behavior, Windows service identity, backup restore, and rollback steps, follow the repository's [XEON_DEPLOYMENT_GUIDE.md](../XEON_DEPLOYMENT_GUIDE.md) and [TRANSFER_MANIFEST.md](../TRANSFER_MANIFEST.md). The backend package deliberately excludes `.env`, `.venv`, database files, backups, logs, and provider credentials.
