# AIG Technology — Project Audit and Repair Report

Date: 15 November 2026 (IST)

## Scope and restoration baseline

The audit was performed against the restored pre-1:47 PM baseline at Git commit `cc5ab21` (`git diff 0906f5c HEAD` was empty). A non-destructive backup branch was created before the repair: `backup-before-audit-repair-2026-11-15`.

No production records were deleted, no database reset was performed, and no environment file or secret value was printed or overwritten.

## Architecture

- Frontend: static HTML, CSS, and vanilla ES-module JavaScript; no Node build pipeline.
- Public data/integrations: Firebase/Firestore catalog and enquiry data, Firebase browser authentication configuration, and Cloudinary browser uploads.
- Backend: FastAPI with Uvicorn, SQLAlchemy, Alembic, PostgreSQL in production, and SQLite/mock-provider support for tests and local development.
- Authentication: backend Argon2 admin passwords with HTTP-only session cookies and CSRF checks; Firebase authentication is used by the browser-side admin/catalog flow.
- Payments: mock provider for development and Razorpay provider endpoints for server-side order creation, signature verification, provider status checks, refunds, and webhook processing.
- Operations: website orders and payments are stored in backend relational tables; Flipkart data is represented separately and synchronized only when credentials are configured.

### Dependency flow

`HTML pages → frontend ES modules → Firebase/Firestore and backend API → FastAPI routes → SQLAlchemy → PostgreSQL`

`Checkout → backend inventory reservation → payment provider → server-side verification/webhook → order/payment state`

`Admin browser session → protected FastAPI admin routes → order/product/payment operations`

## Inventory inspected

- 110 repository files, excluding virtual environments, runtime folders, backups, and Git metadata.
- 18 Python files.
- 26 JavaScript files.
- 26 HTML files.
- Alembic migrations, deployment scripts, configuration examples, documentation, frontend assets, backend tests, and the live local services were inspected.

## Repairs applied

Audit outcome: 2 confirmed code defects repaired, 1 database/deployment blocker identified, and 7 external/browser validation areas remain untested or credential-blocked. No destructive issue was silently ignored.

### PASS — Collection query safety repaired

Changed:

- `backend/app/checkout.py`
- `backend/app/main.py`

Collection relationships (`WebsiteOrder.items`, `WebsiteOrder.payments`, `WebsitePayment.attempts`, and `WebsitePayment.refunds`) now use `selectinload()` when loaded through `Session.scalar()`. The previous `joinedload()` pattern can produce duplicate parent rows and fail or behave incorrectly when an order contains multiple items, payments, attempts, or refunds. Scalar customer loading remains joined where appropriate.

### PASS — Admin customer details restored

The authenticated admin order-detail serializer now includes the stored customer name, email, mobile number, shipping address, billing address, and payment reference. The normal order list remains summary-only, while the protected detail endpoint supplies private fulfillment information. A regression test now verifies these fields.

### PASS — No unrelated redesign or feature removal

The repair did not change the frontend design, public routes, database records, environment secrets, payment security, or external integrations.

## Validation results

| Area | Result | Evidence / limitation |
|---|---|---|
| Python syntax compilation | PASS | All Python modules under `backend/app` compiled successfully. |
| Automated backend tests | PASS | `14 passed`; warnings are dependency deprecations only. |
| Git whitespace validation | PASS | `git diff --check` passed. |
| Local API health | PASS | `GET http://127.0.0.1:8000/api/health` returned 200. |
| Local API readiness | PASS | `GET http://127.0.0.1:8000/api/health/ready` returned 200. |
| Local frontend serving | PASS | `GET http://127.0.0.1:5500/index.html` returned 200. |
| CORS preflight | PASS | Preview-origin OPTIONS request returned 200 with an explicit allowed origin. |
| Checkout and inventory behavior | PASS | Automated tests cover database-price validation, idempotent order creation, stock reservation/release/commit, terms validation, and order access tokens. |
| Mock payment success/failure | PASS | Automated tests cover captured and failed mock payment flows. |
| Razorpay signature/webhook logic | PASS | Automated tests cover invalid webhook signatures and duplicate webhook processing. Live Razorpay was not used. |
| Admin authentication and protected routes | PASS | Automated tests cover authenticated admin order access and security headers/origin restriction. |
| Database migration state | BLOCKED | The configured PostgreSQL database reports revision `20261114_03`, but this restored codebase contains only `20261107_01_website_checkout.py`; `alembic current` cannot locate the database revision. No force-stamp or destructive migration was attempted. |
| PostgreSQL data integrity | NOT TESTED | Readiness verified connectivity only; no data mutation or destructive inspection was performed. |
| Firebase catalog/enquiries | NOT TESTED | Requires external Firebase project access and browser-side configuration. |
| Cloudinary uploads | NOT TESTED | Requires an external upload smoke test; unsigned upload preset security remains a deployment concern. |
| Live/test Razorpay transaction | NOT TESTED | Running a provider transaction would require an intentional user test and external credentials; tests use the mock provider. |
| SMTP/email delivery | NOT TESTED | Delivery requires provider credentials and a real recipient; no email was sent by this audit. |
| Flipkart synchronization | NOT TESTED | Requires valid partner credentials and entitlement. |
| Browser end-to-end/mobile testing | NOT TESTED | Static asset and API checks were run; no reliable automated browser session was available for a complete customer/admin flow. |
| Node lint/type/build | NOT TESTED | The project has no Node package/build configuration; it is a static HTML/ES-module site. |

## Security review summary

Observed protections include explicit CORS origins, origin rejection middleware, security headers, HTTPS-only production validation, HTTP-only session cookies, CSRF validation for authenticated state changes, Argon2 password verification, rate limiting, backend-side price/stock validation, idempotency keys, server-side Razorpay signature verification, webhook signature verification, and payment/order uniqueness checks.

Secrets were not added to source control or included in this report. The production environment must continue to keep Razorpay secret keys, webhook secrets, Firebase admin credentials, SMTP/Mailjet credentials, and Flipkart credentials server-side only.

## Database blocker and safe next step

The local PostgreSQL database is ahead of the restored migration history. This is evidence of a later schema being present in the database, not evidence that it should be removed. Before production startup or further migrations:

1. Back up the database.
2. Recover the missing migration file(s) from the backup/Git reference that created revision `20261114_03`, or compare the database schema to the intended restored revision.
3. Review the migration chain and data impact.
4. Only then run Alembic against a rehearsal copy and apply the approved migration plan.

Do not run `alembic stamp head`, drop tables, or reset the database to hide this mismatch.

## Remaining issues and recommendations

- Restore the missing Alembic migration history before enabling production validation.
- Configure and verify exact production CORS origins for every deployed storefront/admin origin.
- Use PostgreSQL plus persistent rate-limit storage in production; keep the local mock provider disabled in production.
- Run a deliberate Razorpay test-mode transaction and webhook rehearsal after the migration chain is reconciled.
- Run a real email test with a customer address and team address, then verify provider delivery logs.
- Publish and verify Firebase rules; do not treat browser admin checks as a substitute for Firestore rules.
- Validate Cloudinary unsigned preset restrictions and rotate any previously exposed provider secrets.
- Add a browser-based end-to-end suite before public cutover.
- Configure log rotation and monitoring for the Windows-hosted API.

## Final classification

The restored local application is syntactically valid, starts, passes its available backend test suite, and has two safe repairs applied. It is **not yet production-ready** because the configured PostgreSQL database references a migration revision absent from the restored codebase, and several external integrations and browser workflows remain untested. The database mismatch is intentionally left for controlled recovery rather than altered automatically.
