# Product specifications and hardware upgrades

## Implemented

- Added structured product specification fields for Processor, RAM, HDD, and SSD in the existing admin product form. The original `Label: Value` specification textarea remains available for custom fields.
- Added per-product RAM, HDD, SSD, and combined RAM + SSD upgrade configuration. Each option supports an ID, label, additional price, included flag, and availability flag.
- Added a product-detail configurator that hides itself when a product has no configured options, calculates the displayed price immediately, supports reset-to-default, and prevents individual selections from being combined with a package.
- Extended cart lines to retain separate configurations for the same SKU.
- Extended checkout validation and order creation to send configuration IDs only. The backend resolves option labels and prices from PostgreSQL and never trusts browser-submitted prices.
- Added configuration details to backend order serializers and order notification text.

## Database

Migration `20261116_05_product_upgrades` was applied successfully. It adds JSON configuration columns to `business_products` and nullable/backward-compatible pricing/configuration columns to `website_order_items`. Existing products and orders retain their current values.

## Admin workflow

Open the existing Products admin page. The structured specification and hardware upgrade controls are inserted into the existing product form. Add one option per line using the displayed format, save the product, then use the existing catalog sync button so checkout PostgreSQL has the same configuration.

## Validation

- Python compilation: PASS.
- PostgreSQL migration to `20261116_05`: PASS.
- Upgrade calculation smoke test (RAM + SSD): PASS; a 500 + 700 configuration produced 1,200 additional amount.
- `git diff --check`: PASS.
- Existing focused checkout suite: 10 passed, 4 failed. The failures are existing live-only payment/Redis expectation mismatches (`test_mode`, mock payment verification, Redis readiness/refund behavior), not upgrade failures.
- JavaScript syntax check: NOT TESTED because Node.js is not installed on this PC.
- Browser end-to-end upgrade checkout: NOT TESTED; it requires syncing a real configured product through the admin UI.

## Remaining manual verification

1. Configure one product in the admin panel and sync the catalog.
2. Open that product detail page and select an individual upgrade and a combined package.
3. Confirm the cart and checkout totals, then use a payment test environment before production payments.
