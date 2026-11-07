# AIG Technology Pre-Deployment Validation Report

**Validation date:** 2026-11-07
**Overall decision:** **NOT PRODUCTION READY**

The local checkout implementation and an isolated PostgreSQL migration were validated, but the live storefront is not serving the checkout UI, the published Firebase products lack checkout SKU/stock data, and no Razorpay test transaction or production HTTPS deployment was verified. Do not enable live payments or accept website orders until the blockers below are closed.

Status meanings: **PASS** = verified; **FAIL** = observed requirement is not met; **NOT TESTED** = evidence was unavailable or testing was intentionally not performed; **BLOCKED** = an unmet dependency prevents completion.

## 1. Browser end-to-end testing

| Check | Status | Result |
|---|---|---|
| Current live product detail and purchase controls | **FAIL** | Read-only inspection of `https://www.aigtechnology.in/product.html?id=CsquduQykJemOzfnfbu4` found enquiry/WhatsApp actions but no cart or Buy Now action. The live page therefore cannot complete the requested live purchase journey. |
| Updated workspace customer flow | **PASS** | Playwright tested the workspace storefront against the local API and isolated PostgreSQL, using a synthetic Firebase catalogue fixture. Added an existing cart item, used Buy Now on a second item, retained both items, showed the server-priced INR 12,750 total, refreshed checkout, and retained the cart/summary. |
| Customer validation and repeat clicks | **PASS** | Invalid phone details were blocked by browser validation. Two rapid Place order clicks resulted in one order-create request. An invalid customer payload returned HTTP 422. |
| Mock payment success and admin visibility | **PASS** | Mock success led to a captured order confirmation. Signing into the disposable local admin showed the order in Admin Orders. |
| Mock payment failure | **PASS** | Mock failure displayed an unpaid message and left the order `Cancelled` / `Failed`; it did not show a paid confirmation. |
| Empty cart and unavailable products | **PASS** | Empty checkout was disabled; out-of-stock and zero-price SKUs returned HTTP 409. A hidden Continue to checkout link remained visible because of CSS precedence; this was fixed with `.button[hidden]` and rechecked in the browser. |
| Browser exercise against live Firebase catalog and live payment | **BLOCKED** | The live catalog products are not purchasable in the current data state (see Section 2). No production order or payment was attempted. |

The successful local browser run used test-only catalog documents and mock payments. It verifies the current workspace UI/API path, not a deployed production transaction.

## 2. Firebase catalog synchronization

The live public catalogue was read through the site's existing Firestore client. No Firebase data was changed. All 11 returned documents were published, had positive prices, and had 1–5 HTTPS Cloudinary images. Every record lacked both a `sku` and `stockQuantity`; the public `availability` field said “available,” but does not provide a numeric stock quantity.

| Firebase document ID | Product | Price (INR) | Published | SKU | Stock quantity | Images |
|---|---|---:|---|---|---|---:|
| `CsquduQykJemOzfnfbu4` | ACER AMD A8 6TH GEN DESKTOP | 4,999 | Yes | Missing | Missing | 4 |
| `xvG7WdUJn1uXLsHjjTku` | ACER I3 6TH GEN DESKTOP | 8,999 | Yes | Missing | Missing | 4 |
| `9yRINZkpwVQ6OyQK2x34` | ACER I3 7TH GEN DESKTOP | 11,999 | Yes | Missing | Missing | 4 |
| `mMHXKBVHGr3PJBEgBo3B` | DELL AMD A8 6TH GEN DESKTOP | 5,999 | Yes | Missing | Missing | 4 |
| `fXugqfvXcJTKsTnQePLC` | DELL I5 4TH GEN DESKTOP | 10,999 | Yes | Missing | Missing | 4 |
| `E6qZ87Ttmgik4UUmAosy` | HP 285 G3 MT DESKTOP RYZEN 3 | 7,999 | Yes | Missing | Missing | 1 |
| `b14hNoJYQDAIJsB3SinY` | HP AMD A10 DESKTOP | 6,500 | Yes | Missing | Missing | 4 |
| `EQPRU82eDtMx1eetstMl` | HP i3 4TH GEN DESKTOP | 6,999 | Yes | Missing | Missing | 4 |
| `rD9AGDpMEZZhV2JHoXo7` | HP I3 6TH GEN DESKTOP | 9,999 | Yes | Missing | Missing | 3 |
| `MZZx8RDak4oN91UJTu19` | HP i5 6TH GEN DESKTOP | 14,999 | Yes | Missing | Missing | 4 |
| `pTHxN0omhtsGXjRK4IkZ` | HP PRO - I5 4TH GEN DESKTOP | 9,999 | Yes | Missing | Missing | 5 |

| Check | Status | Result |
|---|---|---|
| Product IDs, displayed prices, published status, image counts/hosts | **PASS** | Read-only catalogue inspection completed. |
| Checkout-ready SKU and stock data | **FAIL** | All 11 published products are missing both fields. Do not infer SKUs or stock from product names or “available” labels. |
| Firebase-to-backend synchronization against real admin credentials | **BLOCKED** | No Firebase admin token was used. No sync request or Firebase write was made. Add verified SKUs and real stock quantities, then sync through the authenticated admin workflow. |
| Server-authoritative prices and quantities | **PASS** | Checkout APIs accept SKU/quantity input, reject browser-supplied price fields (HTTP 422), and use backend database price/stock. Local browser/API validation confirmed this behavior. |

With the current catalogue data, the workspace's purchase controls correctly remain unavailable for these products; syncing does not create checkout inventory for records without a SKU.

## 3. PostgreSQL migration and data integrity

| Check | Status | Result |
|---|---|---|
| Migration on a separate PostgreSQL database | **PASS** | Started a disposable local PostgreSQL 18 cluster on port 55439 and ran `alembic upgrade head` on a separate validation database, starting from a representative pre-existing `business_products` table. Revision `20261107_01` reached head. |
| Tables, foreign keys, and relationships | **PASS** | The migration created all nine checkout-related tables. After loading the remaining current model metadata in the test database, 17 foreign keys were present. Order, item, payment, attempt, webhook, reservation, and refund relationships were inserted and read successfully. |
| Unique payment references and webhook IDs | **PASS** | Duplicate `provider_payment_id`, `provider_order_id`, webhook event ID, and order/product reservation inserts were rejected by PostgreSQL uniqueness constraints. |
| Backup and restore | **PASS** | A custom-format `pg_dump` was restored into a separate database. The restored database retained the migration revision, three validation orders/payments, and checkout tables. |
| Production schema compatibility | **NOT TESTED** | The production/configured application database was not contacted. The validation database used a representative baseline, not a production schema snapshot. |

The test database and its fixtures were isolated from production. The migration is the only Alembic revision and has `down_revision = None`; verify the deployed database's existing `business_products` schema and migration history before applying it. The application also calls `Base.metadata.create_all()` at startup, so production startup/schema-management behavior should be reviewed and migrations should remain the controlled schema-change mechanism.

## 4. Razorpay test readiness

| Check | Status | Result |
|---|---|---|
| Mock mode | **PASS** | `PAYMENT_PROVIDER=mock` was used only in the local test environment. Mock success/failure paths were browser-tested; mock mode is rejected when `APP_ENV=production`. |
| Razorpay test credentials and transaction | **BLOCKED** | No Razorpay Key ID, Key Secret, or webhook secret was configured. No Razorpay order, test transaction, webhook delivery, refund, or provider reconciliation call was made. |
| Server-side order creation and public key exposure | **PASS (code review)** | The backend creates Razorpay orders using server credentials and returns the Key ID, order reference, amount, and currency. The Key Secret and webhook secret are not returned to the frontend. |
| Payment signature and provider status verification | **PASS (code review/unit tests only)** | The backend verifies the HMAC callback signature and fetches the provider payment to verify its order, amount, and currency. This was not exercised against Razorpay. |
| Webhook signature and duplicate handling | **PASS (unit tests only)** | Raw-body signature verification and event-ID deduplication are covered by tests. No provider webhook was delivered to this validation environment. |
| Provider failure/reconciliation behavior | **PASS (mocked/unit tests only)** | Failed-payment and provider-reconciliation tests passed with mocks; real Razorpay behavior remains unverified. |
| Razorpay test-mode reporting | **NOT TESTED** | Razorpay is not configured. The API currently returns `test_mode: false` for Razorpay responses; confirm test-key labeling and ensure only `rzp_test_` credentials are used during the test transaction. |

Before enabling Razorpay, configure test credentials only on the backend, set up the webhook URL/events, and verify successful and failed test payments plus webhook reconciliation/refund paths. Do not use live credentials for this validation.

## 5. API deployment readiness

| Check | Status | Result |
|---|---|---|
| Public API base URL | **BLOCKED** | The frontend now accepts an explicit public API URL through `PRODUCTION_API_BASE_URL` (or `globalThis.AIG_API_BASE_URL`) and uses localhost only on a local hostname. The production API URL has not been supplied or deployed. |
| HTTPS, DNS, and TLS termination | **NOT TESTED** | The API is intended to run behind a separate HTTPS host/reverse proxy, but no production host, certificate, or TLS termination was configured or tested. |
| CORS | **PASS (implementation), NOT TESTED (production)** | CORS now uses only configured exact origins; development origins are not added implicitly. Production startup rejects wildcard or non-HTTPS origins. Set the exact production admin/storefront origins and verify through the deployed proxy. |
| Admin session cookie | **PASS (implementation), NOT TESTED (production)** | Cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` only when `APP_ENV=production`. Production cookie behavior was not tested over HTTPS. |
| CSRF protection | **PASS (local tests), NOT TESTED (production)** | Cookie-authenticated mutations now require a session-bound HMAC CSRF token in `X-CSRF-Token`; browser requests are origin-checked. A missing-token admin mutation returns HTTP 403 in tests. Verify the deployed cross-origin admin flow over HTTPS. |
| Authentication | **PASS (code review/local test)** | Admin authentication uses Argon2 password hashes and session cookies; Firebase catalog synchronization verifies Firebase ID tokens. Admin Orders was tested with a disposable local account. |
| Rate limiting | **PASS (implementation), BLOCKED (deployment configuration)** | SlowAPI can use Redis through `RATE_LIMIT_STORAGE_URI`; a Redis client dependency was added. No production Redis endpoint is configured or tested. Do not run multiple workers until a shared store is reachable. |
| Environment variables and secret handling | **BLOCKED for production** | The local test configuration had database/session settings and mock mode. Razorpay credentials are absent. Production `APP_ENV`, strong session secret, database, exact origins, and backend-only payment secrets must be set and verified without exposing values. |
| Error handling | **PASS (code review/unit tests)** | Provider/network errors return explicit API errors; checkout validation errors are returned rather than treated as success. |

## 6. Final deployment blockers

1. **Deploy the current workspace storefront changes.** The live product page inspected during this validation does not include the cart/Buy Now experience.
2. **Prepare the Firebase catalogue for checkout.** Assign unique verified SKUs and actual stock quantities to eligible products; do not invent stock. Confirm prices and published status, then perform and verify authenticated sync.
3. **Configure and deploy the API over HTTPS.** Replace the localhost API URL; set exact production CORS origins; verify TLS, DNS, reverse-proxy headers, and `APP_ENV=production`.
4. **Configure deployment settings.** Provide a strong session secret, exact HTTPS origins, PostgreSQL, Redis-backed rate limits, secure cookies, and the public API URL. Production startup now rejects mock payments and unverified schema state.
5. **Run Razorpay test-mode transactions** with test-only credentials, including success, failure, webhook deduplication/reconciliation, and refund verification.
6. **Validate the production migration path** against a protected schema-only backup/snapshot and confirm a tested restore/rollback procedure before applying any production migration.
7. **Run PostgreSQL migration/backup/restore checks against a production-like copy.** No production database was accessed in this audit.

No production database was connected to, no production order was submitted, and no Firebase or payment-provider data was modified. Do not treat this report as production-readiness approval.

## 7. Latest admin-restoration and production-readiness audit

The following implementation changes supersede earlier findings where noted above. No live Firebase writes, production database calls, deployments, or Razorpay calls were performed.

| Check | Status | Result |
|---|---|---|
| Firebase admin entry points and authentication separation | **PASS (code review)** | `admin/index.html` / `admin/login.html` remain the Firebase admin; `admin/operations.html` / `admin/operations-login.html` remain the backend session-authenticated operations panel. Navigation links distinguish both dashboards. |
| Product, enquiry, and settings code paths | **PASS (code review), NOT TESTED (authenticated live workflows)** | Existing Firebase/Cloudinary code paths remain. Viewing Products no longer automatically writes category settings. No Firebase admin credentials were used for authenticated workflow testing. |
| Operations order privacy | **PASS (local API tests/code review)** | Operations list/detail responses omit customer contact/address and provider payment references. Operations UI does not render these fields. Customer order lookup remains separate and token-protected. |
| Firebase mapping report | **PASS (read-only evidence)** | Added `FIREBASE_PRODUCT_MAPPING_REPORT.md` for the 11 previously inspected published products. Candidate SKUs are clearly marked as proposals; no stock quantity is invented. A fresh export/report reconciliation was **NOT TESTED** during this audit; refresh and compare IDs/prices before import. |
| Controlled Firebase mapping import | **PASS (implementation review), NOT TESTED against Firebase** | Dry run validates exact document IDs, unchanged prices, numeric stock, SKU syntax/uniqueness, duplicates, and input bounds. Only an authenticated explicit confirmation writes `sku` and `stockQuantity`; backend sync and an audit-log download follow. The blank-stock template intentionally cannot pass until operators enter verified inventory. |
| Backend production configuration | **PASS (implementation), BLOCKED (deployment)** | Production startup requires PostgreSQL, current Alembic revision, strong session secret, explicit HTTPS origins, Redis rate-limit storage, test-key Razorpay credentials, and non-mock provider mode. No production configuration or database was supplied. |
| CSRF, origin checking, and security headers | **PASS (local tests)** | Added session-bound CSRF validation for cookie-authenticated state changes, exact Origin allowlisting, secure-production HSTS, and standard security headers. Production HTTPS/proxy behavior remains **NOT TESTED**. |
| PostgreSQL migration, backup, restore | **PASS (prior isolated validation only), NOT TESTED (production-like copy in this audit)** | The prior isolated PostgreSQL 18 migration/backup/restore remains the only evidence. Do not apply a migration to production from this report. |
| Razorpay test credentials/transaction | **BLOCKED** | No test credentials or provider account access are available. Startup refuses live Razorpay keys for the current production validation configuration; no provider transaction/webhook was attempted. |
| Automated validation in this audit | **PASS** | Backend tests: 13 passed, including CSRF rejection/acceptance, PII-minimized operations responses, origin restriction, and security headers. Python compilation and changed JavaScript syntax checks passed. Catalog importer validation passed for valid, stale-price, duplicate-SKU, and missing-stock cases. |
| Browser checks of admin login routes/navigation | **PASS** | Both login pages render separately and link to the other panel. The protected product/enquiry/settings and operations workflows remain **NOT TESTED**; no credentials were entered and no live writes were performed. |
| Browser tests of authenticated admin workflows | **NOT TESTED** | Use authorized non-production test accounts to verify Firebase product/enquiry/settings operations and backend order operations without changing production data. |

### Remaining blockers

1. Deploy the current storefront and configure `PRODUCTION_API_BASE_URL` in `assets/js/api-config.js` with the actual HTTPS API `/api` URL.
2. Audit and approve all SKUs and actual stock counts, then run the Firebase import in the authenticated admin using the dry-run and explicit confirmation flow. No product is checkout-ready based on missing stock.
3. Configure the production PostgreSQL database and Redis endpoint, run the migration on a protected production-like copy, and test restore before any production change.
4. Configure exact HTTPS admin/storefront origins, TLS termination, Windows service/proxy, secure cookies, monitoring, and verify CSRF through the real deployment topology.
5. Obtain Razorpay **test-only** credentials and verify server-created orders, success/failure, callback signatures, webhook idempotency, reconciliation, and refunds. Do not use live credentials.
6. Use authorized test accounts to verify Firebase product/enquiry/settings workflows and the operations panel in a browser. Do not use production account credentials in a test harness.

### Exact files changed for this audit

- `assets/js/admin.js`, `assets/js/catalog-import.js`, `assets/js/firestore.js`
- `assets/js/api-config.js`, `assets/js/backend-api.js`, `assets/js/checkout.js`
- `admin/assets/js/api.js`, `admin/assets/js/config.js`, `admin/assets/js/login.js`, `admin/assets/js/orders.js`, `admin/assets/js/dashboard.js`, `admin/assets/js/returns.js`
- `admin/index.html`, `admin/login.html`, `admin/products.html`, `admin/enquiries.html`, `admin/settings.html`, `admin/orders.html`, `admin/operations-login.html`
- `backend/app/auth.py`, `backend/app/config.py`, `backend/app/main.py`, `backend/app/schemas.py`
- `backend/requirements.txt`, `backend/.env.example`, `backend/tests/test_checkout.py`
- `FIREBASE_PRODUCT_MAPPING_REPORT.md`, `FIREBASE_PRODUCT_MAPPING_IMPORT_TEMPLATE.csv`
- `PRE_DEPLOYMENT_REPORT.md`, `DEPLOYMENT.md`, `backend/README.md`

### Migration and rollback instructions

1. On a separate PostgreSQL test database, take a custom-format backup, restore it to a second disposable database, run `alembic upgrade head`, verify `alembic current`, constraints and test flows, then repeat backup/restore after migration.
2. For an approved deployment, stop API writes, take and verify a protected `pg_dump -Fc` backup, check that the database is PostgreSQL and its existing `business_products` schema is compatible, then run `alembic upgrade head` from `backend/`.
3. Do not use `alembic downgrade` as a routine rollback: this migration's downgrade drops checkout tables and their order/payment data. For an application-only rollback, restore the previous application build while retaining the additive schema. If schema rollback is unavoidable, stop writes and restore the pre-migration backup; orders created after that backup will not exist in the restored database.
4. Firebase imports affect only two product fields plus `updatedAt`; use the downloaded import audit's `previous_sku` and `previous_stock` values for an explicit, reviewed Firebase correction. Do not run an automatic rollback or overwrite other product fields.

### Windows deployment outline (not executed)

1. Provision PostgreSQL and Redis on private interfaces; allow the Windows API host to reach them, but do not publish their database/cache ports to the internet.
2. Create a dedicated Windows service account and virtual environment in `backend\`; install `requirements.txt`; copy `.env.example` to a protected `.env` and set values using the deployment secret manager. Do not place secrets in the repository or storefront.
3. Set `APP_ENV=production`, `DATABASE_URL`, a random `SESSION_SECRET` of at least 32 characters, exact HTTPS `ADMIN_ORIGIN`/`STOREFRONT_ORIGIN` and `CORS_ALLOWED_ORIGINS`, a private Redis `RATE_LIMIT_STORAGE_URI`, and Razorpay test-only configuration. `PAYMENT_PROVIDER=mock` is rejected in production.
4. From `backend\`, run `alembic upgrade head` only after a tested backup and production-like rehearsal. The API checks database connectivity/revision at startup and will not create production tables automatically.
5. Run Uvicorn as a Windows service bound only to `127.0.0.1` (for example `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1`) behind IIS or another maintained HTTPS reverse proxy. Restrict inbound firewall access to HTTPS at the proxy; do not expose port 8000, PostgreSQL, or Redis publicly.
6. Configure proxy TLS, request size/time limits, forwarded headers only from the trusted proxy, health monitoring, rotated logs, and restart policy. Set `PRODUCTION_API_BASE_URL` to the public HTTPS API base ending in `/api`; that URL is public configuration, not a secret.
7. In Firebase Product & Site Management, dry-run the reviewed CSV, verify all rows, explicitly confirm the write, and retain the generated audit log. Verify backend sync before enabling purchase controls.
8. Test login, CSRF, checkout, a Razorpay test payment/webhook, order listing, backup/restore, and rollback procedure before considering any production change.
