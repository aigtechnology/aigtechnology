# AIG Technology – Admin, Configuration, Delivery and Inventory Repair Report

## Scope

This repair extended the existing FastAPI/PostgreSQL and static HTML/JavaScript application. Existing orders, payment records, product records, Firebase, Cloudinary, Razorpay and Mailjet integrations were preserved.

## Root causes found

- Products did not have a backend category field, so category-based delivery rules could not be applied reliably.
- Delivery calculation only supported the legacy PIN-based charge and had no admin-managed category rules.
- RAM/HDD/SSD upgrade stock was stored in product JSON but was not validated, decremented, or restored transactionally.
- Inventory movements were not recorded for website order reservation/release or manual adjustments.
- The dashboard was a placeholder summary and did not expose payment, order-status, inventory, and customer aggregates.
- Operations navigation referenced Inventory, Analytics, and Settings screens that were missing from the source tree.

## Implemented

- Added `Product.category` and catalog-sync support.
- Added additive PostgreSQL migration `20261118_01_admin_inventory_delivery`.
- Added `DeliveryChargeRule` with fixed/per-item, free-delivery minimum, and enabled controls.
- Added admin delivery-rule APIs and an operations settings page.
- Added backend category-aware delivery calculation with legacy PIN fallback when no category rule is configured.
- Added upgrade stock validation, decrement on order creation, and idempotent restoration on cancellation/expiry.
- Added inventory movement records for website reservation/release and admin add/remove adjustments.
- Added inventory dashboard APIs, manual stock adjustment UI, movement history, filtering, and low-stock threshold API.
- Added live dashboard and analytics pages backed by database aggregates and date filtering.
- Replaced dead custom upgrade selects with editable text/datalist inputs and stock fields for RAM/HDD/SSD/combined options.

## Files changed

- `backend/app/business_models.py`
- `backend/app/checkout.py`
- `backend/app/main.py`
- `backend/app/schemas.py`
- `backend/migrations/versions/20261118_01_admin_inventory_delivery.py`
- `assets/js/admin.js`
- `assets/js/backend-api.js`
- `admin/assets/js/common.js`
- `admin/operations.html`
- `admin/assets/js/dashboard-live.js`
- `admin/assets/js/inventory.js`
- `admin/assets/js/analytics.js`
- `admin/assets/js/operations-settings.js`
- `admin/inventory.html`
- `admin/analytics.html`
- `admin/operations-settings.html`

## Database status

- Migration applied successfully.
- Current Alembic revision: `20261118_01 (head)`.
- Migration is additive and does not delete historical orders or products.

## Validation results

| Check | Result |
|---|---|
| Backup created before edits | PASS |
| Python compilation of modified backend modules | PASS |
| Backend application import | PASS |
| Alembic migration upgrade | PASS |
| Alembic current revision | PASS – `20261118_01` |
| `git diff --check` | PASS |
| Existing checkout test suite | FAIL/REQUIRES TEST CONFIG |
| Browser end-to-end tests | NOT TESTED |
| JavaScript syntax check | BLOCKED – Node.js is not installed |

The existing checkout suite reported 7 failures and 7 passes. The failures are caused by the test run loading the current production-like environment (live payment/Redis settings), old mock-payment expectations, and an old expected total that does not include the configured legacy PIN delivery charge. These should be rerun with an isolated test `.env` and updated expected delivery behavior before production release.

## Operational steps

1. Configure category names on products through the catalog/admin product flow, then save/sync products so `Product.category` is populated.
2. Open Admin Operations → Settings and configure delivery rules for the exact product categories.
3. Use Admin Operations → Inventory for manual stock adjustments and movement history.
4. Run the backend with `config/backend.env` and restart it after code changes.
5. Verify a staging checkout with multiple categories before enabling the rules for live customers.

## Remaining limitations

- Existing products with no category continue using the legacy PIN-based charge until categorized.
- Upgrade options remain JSON-backed for compatibility; a future normalized option table is not required for this repair.
- Full browser/E2E testing and live payment testing were not performed.
- The current test suite needs an isolated test environment so it does not exercise production credentials or production Redis settings.
