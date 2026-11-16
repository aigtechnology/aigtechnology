# AIG Technology – Service Login, Order ID & Frontend Symbol Audit

Date: 16 November 2026

## Architecture inspected

- Frontend: static HTML/CSS/ES modules, Firebase-backed catalogue, backend API client.
- Backend: FastAPI, SQLAlchemy, Alembic, PostgreSQL, Redis/rate limiting, Razorpay provider integration.
- Business tables: website customers/orders/items/payments, inventory, offline purchases, service requests, admin sessions.
- Existing authentication: admin session cookies and Firebase administration integration; purchase verification remains separate from guest checkout.

## Changes implemented

- Added backend models for `offline_purchases` and `service_requests` so the existing service frontend has matching PostgreSQL models.
- Added `POST /api/customer/verify-purchase`.
  - Matches the registered mobile number and invoice/order reference.
  - Detects `GST`, `NON_GST`, or `ONLINE` from the trusted record source.
  - Returns all matching records, product lines, warranty status, and service eligibility.
  - Does not infer GST status from a name or mobile number.
- Added `POST /api/service-requests` with server-side purchase verification before saving a request.
- Added admin service request list and status update endpoints.
- New website order IDs are generated server-side as `NAME-SKU-4DIGIT`; multi-item orders use `ITEM`, missing names use `CUS`, and missing SKU uses `ITEM`.
- Existing order IDs are not changed. Database uniqueness remains enforced by the existing unique order-ID constraint and a server-side collision check.
- Updated payment request schemas to accept the new order-ID length without changing payment verification logic.
- Updated customer purchase verification UI to auto-detect invoice type and display multiple matching purchases.
- Updated the service form to use the verified purchase record automatically when available.
- Corrected confirmed customer-facing mojibake such as `©`, `â€™`, `…`, and `â€“` in the audited pages.
- Preserved INR formatting and existing payment/authentication integrations.

## Database migration

Created and applied `backend/migrations/versions/20261116_04_purchase_service_consistency.py`.

Verified local PostgreSQL revision: `20261116_04 (head)`.

The migration is additive: it widens the order reference column and adds purchase-reference fields/indexing to service requests. It does not delete customer, product, order, or payment records.

## Validation

| Check | Result |
|---|---|
| Python compilation of changed backend modules | PASS |
| Order-ID helper fallback and sanitization check | PASS |
| PostgreSQL migration upgrade | PASS |
| Alembic current revision | PASS – `20261116_04` |
| Git whitespace check | PASS |
| Existing full pytest suite | FAIL – 4 pre-existing/configuration-sensitive tests fail because the suite expects mock-payment response behavior while the current configuration/API is Razorpay-only; 10 tests pass |
| Live Razorpay transaction | NOT TESTED – no real payment was initiated |
| Production browser deployment | NOT TESTED – deployment requires publishing the changed files and restarting the API |

## Remaining manual checks

1. Publish the changed frontend and backend files together.
2. Restart the API after applying the migration in the production database.
3. Verify one GST offline record, one non-GST offline record, and one captured website order through `/customer-login.html`.
4. Confirm the admin service-request page is using the new API routes.
5. Investigate the four legacy mock-payment test failures separately; they are not caused by invoice detection or the new ID helper.
